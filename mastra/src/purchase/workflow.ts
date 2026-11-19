/**
 * CartKeeper purchase workflow. Port of backend/core/graph.py.
 *
 *   intake -> resolve-items -> parallel[check-inventory, quote-suppliers (foreach supplier)]
 *          -> merge-quotes -> branch
 *               in stock -> reserve-from-storeroom                       (nothing to buy)
 *               else     -> buy:
 *                   score-quotes
 *                   -> dountil(propose-and-check: propose -> policy-check -> replan), max 2 rounds
 *                   -> branch
 *                        no option     -> close-no-match
 *                        auto_approve  -> pay: execute -> confirm-and-log
 *                        needs_approval-> approval: route-approver -> branch
 *                             approver found -> decide: await-approval (suspend) -> branch
 *                                  approved -> pay: execute -> confirm-and-log
 *                                  rejected -> close-rejected
 *                             nobody        -> explain-and-close
 *                        blocked       -> explain-and-close
 *
 * Every step takes the purchase record and returns it with its own fields
 * filled in, so each branch has the same input and output schema.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  type Purchase,
  PurchaseSchema,
  QuoteSchema,
  StartInputSchema,
} from './schema';
import * as S from './steps';
import type { PurchaseDeps } from './steps';

export const PURCHASE_WORKFLOW_ID = 'purchase';
export const MAX_PROPOSE_ROUNDS = S.MAX_REPLANS + 1;

type StepFn = (s: Purchase, deps: PurchaseDeps, ctx: S.StepContext) => Partial<Purchase> | Promise<Partial<Purchase>>;

/** The one branch that ran, from a `.branch()` output keyed by step id. */
async function takenBranch({ inputData }: { inputData: Record<string, Purchase | undefined> }): Promise<Purchase> {
  const taken = Object.values(inputData).filter((v): v is Purchase => v !== undefined);
  if (taken.length !== 1) throw new Error(`expected exactly one branch to run, got ${taken.length}`);
  return taken[0];
}

const decided = (s: Purchase) => s.policy_result?.decision ?? null;

export function createPurchaseWorkflow(deps: PurchaseDeps) {
  const step = (id: string, description: string, fn: StepFn) =>
    createStep({
      id,
      description,
      inputSchema: PurchaseSchema,
      outputSchema: PurchaseSchema,
      execute: async ({ inputData, tracingContext }) => ({ ...inputData, ...(await fn(inputData, deps, { tracingContext })) }),
    });

  // --- sourcing ----------------------------------------------------------------

  const intake = createStep({
    id: 'intake',
    description: 'LLM: read the request into a structured need (pack urgencies and machines only).',
    inputSchema: StartInputSchema,
    outputSchema: PurchaseSchema,
    execute: async ({ inputData, runId, tracingContext }) => {
      // The run id is the request id, so the payment idempotency key is tied to this run.
      const s: Purchase = { ...inputData, request_id: runId, replan_count: 0 };
      return { ...s, ...(await S.intake(s, deps, { tracingContext })) };
    },
  });

  const resolveItems = step('resolve-items', 'Match the need to catalog items that fit the machine.', S.resolveItems);

  const checkInventory = createStep({
    id: 'check-inventory',
    description: 'Is the one matching part already in the storeroom?',
    inputSchema: PurchaseSchema,
    outputSchema: z.object({ inventory_hit: PurchaseSchema.shape.inventory_hit }),
    execute: async ({ inputData }) => S.checkInventory(inputData, deps),
  });

  const QuoteRequestSchema = z.object({ supplier_id: z.string(), skus: z.array(z.string()), qty: z.int() });
  const quoteSupplier = createStep({
    id: 'quote-supplier',
    description: 'Ask one supplier for a quote (simulated latency).',
    inputSchema: QuoteRequestSchema,
    outputSchema: z.object({ quotes: z.array(QuoteSchema) }),
    execute: async ({ inputData }) => ({ quotes: await S.quoteSupplier(inputData, deps) }),
  });

  const quoteSuppliers = createWorkflow({
    id: 'quote-suppliers',
    description: 'Fan out one quote request per approved supplier that carries a candidate.',
    inputSchema: PurchaseSchema,
    outputSchema: z.object({ quotes: z.array(QuoteSchema) }),
  })
    .map(async ({ inputData }) => S.quoteRequests(inputData, deps), { id: 'quote-requests' })
    .foreach(quoteSupplier, { concurrency: 16 })
    .map(async ({ inputData }) => ({ quotes: inputData.flatMap((r) => r.quotes) }), { id: 'collect-quotes' })
    .commit();

  const mergeQuotes = step('merge-quotes', 'Combine the storeroom check and supplier quotes; time the round.', S.mergeQuotes);
  const reserve = step('reserve-from-storeroom', 'In stock: reserve it, buy nothing.', S.reserveFromStoreroom);

  // --- propose, check, replan (looped at most twice) ----------------------------

  const proposeAndCheck = createWorkflow({
    id: 'propose-and-check',
    description: 'LLM picks an option, the policy gate decides, and a block narrows the options for one retry.',
    inputSchema: PurchaseSchema,
    outputSchema: PurchaseSchema,
  })
    .then(step('propose', 'LLM: pick one option id. The proposal is rebuilt from the catalog.', S.propose))
    .then(step('policy-check', 'Plain code: auto_approve, needs_approval, or blocked.', S.policyCheck))
    .then(step('replan', 'If blocked and no retry used: keep only options that pass policy.', S.replan))
    .commit();

  // --- after the decision ------------------------------------------------------

  const pay = (id: string) =>
    createWorkflow({
      id,
      description: 'Re-check policy, pay once (idempotency key per request), record the order.',
      inputSchema: PurchaseSchema,
      outputSchema: PurchaseSchema,
    })
      .then(step('execute', 'The only step that moves money. Re-checks policy first.', S.execute))
      .then(step('confirm-and-log', 'Record the order against the budget.', S.confirmAndLog))
      .commit();

  const explain = (id: string) => step(id, 'Not purchased: say why.', S.explainAndClose);

  const awaitApproval = createStep({
    id: 'await-approval',
    description: 'Durable pause until the approver answers.',
    inputSchema: PurchaseSchema,
    outputSchema: PurchaseSchema,
    suspendSchema: ApprovalRequestSchema,
    resumeSchema: ApprovalDecisionSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      if (!resumeData) {
        return await suspend({
          request_id: inputData.request_id,
          approver_id: inputData.approver_id!,
          approver_role: inputData.approver_role!,
          proposal: inputData.proposal!,
          policy_result: inputData.policy_result!,
          purchase: inputData,
        });
      }
      const answer = ApprovalDecisionSchema.parse(resumeData);
      return { ...inputData, approval: answer.approval, decided_by: answer.decided_by };
    },
  });

  const decide = createWorkflow({
    id: 'decide',
    description: 'Wait for the approver, then pay or close.',
    inputSchema: PurchaseSchema,
    outputSchema: PurchaseSchema,
  })
    .then(awaitApproval)
    .branch([
      [async ({ inputData }) => inputData.approval === 'approved', pay('pay-approved')],
      [async ({ inputData }) => inputData.approval === 'rejected', step('close-rejected', 'Rejected: nothing bought.', S.closeRejected)],
    ])
    .map(takenBranch, { id: 'after-decision' })
    .commit();

  const approval = createWorkflow({
    id: 'approval',
    description: 'Route to the right approver (escalating if the role is empty) and wait.',
    inputSchema: PurchaseSchema,
    outputSchema: PurchaseSchema,
  })
    .then(step('route-approver', 'Find who signs off: the required role or the next one up.', S.routeApprover))
    .branch([
      [async ({ inputData }) => Boolean(inputData.approver_id), decide],
      [async ({ inputData }) => !inputData.approver_id, explain('no-approver')],
    ])
    .map(takenBranch, { id: 'after-routing' })
    .commit();

  const buy = createWorkflow({
    id: 'buy',
    description: 'Score quotes, propose within policy, then pay, ask, or explain.',
    inputSchema: PurchaseSchema,
    outputSchema: PurchaseSchema,
  })
    .then(step('score-quotes', 'Attach CartLens reliability scores to every quote.', S.scoreQuotes))
    .dountil(
      proposeAndCheck,
      async ({ inputData, iterationCount }) => !inputData.retry || iterationCount >= MAX_PROPOSE_ROUNDS,
    )
    .branch([
      [async ({ inputData }) => !inputData.proposal, step('close-no-match', 'No option to buy.', (s) => s)],
      [async ({ inputData }) => Boolean(inputData.proposal) && decided(inputData) === 'auto_approve', pay('pay-auto')],
      [async ({ inputData }) => Boolean(inputData.proposal) && decided(inputData) === 'needs_approval', approval],
      [async ({ inputData }) => Boolean(inputData.proposal) && decided(inputData) === 'blocked', explain('blocked')],
    ])
    .map(takenBranch, { id: 'after-policy' })
    .commit();

  return createWorkflow({
    id: PURCHASE_WORKFLOW_ID,
    description: 'Turn a floor request into a purchase, inside policy, with a human sign-off when the policy requires one.',
    inputSchema: StartInputSchema,
    outputSchema: PurchaseSchema,
  })
    .then(intake)
    .then(resolveItems)
    .parallel([checkInventory, quoteSuppliers])
    .map(
      async ({ inputData, getStepResultAsync }) => {
        const resolved = (await getStepResultAsync(resolveItems)) as Purchase;
        return {
          ...resolved,
          inventory_hit: inputData['check-inventory'].inventory_hit ?? null,
          quotes: inputData['quote-suppliers'].quotes,
        };
      },
      { id: 'join-sourcing' },
    )
    .then(mergeQuotes)
    .branch([
      [async ({ inputData }) => Boolean(inputData.inventory_hit), reserve],
      [async ({ inputData }) => !inputData.inventory_hit, buy],
    ])
    .map(takenBranch, { id: 'result' })
    .commit();
}

export type PurchaseWorkflow = ReturnType<typeof createPurchaseWorkflow>;
