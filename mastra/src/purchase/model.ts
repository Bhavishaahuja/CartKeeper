/**
 * The only two things the model does: read a request into a Need, and pick one
 * option id. Port of need_schema / choice_schema in backend/core/nodes.py.
 *
 * Neither schema can carry a price, a total, a decision or an approver, so the
 * model has no way to influence the policy gate except by which listed option
 * it picks.
 */

import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Pack } from '../core/packs';

export function needSchema(pack: Pack) {
  const urgencies = Object.keys(pack.config.urgency_levels) as [string, ...string[]];
  const machineIds = pack.machines.map((m) => m.machine_id) as [string, ...string[]];
  const machine = machineIds.length ? z.enum(machineIds).nullable() : z.string().nullable();
  return z.object({
    item_need: z.string().describe('What needs to be bought, in plain words.'),
    search_terms: z.array(z.string()).describe('1 to 6 short catalog search terms, e.g. part names.'),
    machine_id: machine.describe('Machine the part is for, if the request names one in the registry.'),
    urgency: z.enum(urgencies).describe('How urgent the request is.'),
    qty: z.int().describe("Quantity requested in the catalog's unit. 1 if not stated."),
  });
}

export function choiceSchema(optionIds: string[]) {
  return z.object({
    option_id: z.enum(optionIds as [string, ...string[]]).describe('The option to buy.'),
    qty: z.int().describe('How many units to buy.'),
    rationale: z.string().describe('1 to 3 sentences on why this option, in plain words.'),
  });
}

export interface ModelCall {
  /** Instructions for this call (built from the pack). */
  system: string;
  /** The user message: the raw request, or the JSON context of options. */
  user: string;
}

/**
 * How steps reach a model. Production uses Mastra agents; tests use a fake
 * that records calls. Implementations must return data matching `schema`;
 * the caller validates it again regardless.
 */
export interface PurchaseModel {
  extractNeed(call: ModelCall, schema: ReturnType<typeof needSchema>): Promise<unknown>;
  chooseOption(call: ModelCall, schema: ReturnType<typeof choiceSchema>): Promise<unknown>;
}

/** Route both calls through Mastra agents with native structured output. */
export function agentModel(intakeAgent: Agent, proposeAgent: Agent): PurchaseModel {
  const run = async (agent: Agent, call: ModelCall, schema: z.ZodType) => {
    const response = await agent.generate(call.user, {
      instructions: call.system,
      structuredOutput: { schema, errorStrategy: 'strict' },
    });
    return response.object;
  };
  return {
    extractNeed: (call, schema) => run(intakeAgent, call, schema),
    chooseOption: (call, schema) => run(proposeAgent, call, schema),
  };
}
