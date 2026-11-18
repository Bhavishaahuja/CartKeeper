/**
 * The eval dataset: 30 labeled purchase requests for the textile pack.
 *
 * Each item is a request as a technician would type it, plus the setup the run
 * needs (spend already on the books, people missing, spend that lands while the
 * request waits, and what the approver will say). Labels say what the system
 * should do: the need it should read, the first policy decision, the approver,
 * whether it should replan, and how it should end.
 *
 * Labels are about correct behavior, not about what the code happens to do: an
 * "oracle" model that reads every need correctly and picks the most reliable
 * eligible supplier must score 1.0 on every code scorer (test/evals/dataset.test.ts).
 */

import { z } from 'zod';

export const SetupSchema = z.object({
  /** Orders already this month, before the request. */
  pre_orders: z.array(z.object({ scope_key: z.string(), total: z.number() })).default([]),
  /** Orders that land while the request waits for approval. */
  orders_while_waiting: z.array(z.object({ scope_key: z.string(), total: z.number() })).default([]),
  /** Roles nobody holds for this run. */
  remove_roles: z.array(z.string()).default([]),
  /** What the routed approver answers if the run pauses. */
  decision: z.enum(['approved', 'rejected']).default('approved'),
});

export const EvalInputSchema = z.object({ raw_request: z.string(), setup: SetupSchema });

export const EvalLabelSchema = z.object({
  need: z.object({
    /** Any of these is a correct reading. Empty: nothing in the catalog fits. */
    skus: z.array(z.string()),
    qty: z.int(),
    urgency: z.array(z.string()).min(1),
    machine_id: z.array(z.string().nullable()).min(1),
  }),
  /** Decision of the first policy check, or null when nothing was proposed (storeroom, no match). */
  first_decision: z.enum(['auto_approve', 'needs_approval', 'blocked']).nullable(),
  /** Role that should be asked to approve, or null when the run shouldn't pause. */
  approver_role: z.string().nullable(),
  replanned: z.boolean(),
  status: z.enum(['reserved', 'executed', 'rejected', 'blocked', 'no_match']),
});

export type EvalInput = z.infer<typeof EvalInputSchema>;
export type EvalLabel = z.infer<typeof EvalLabelSchema>;
export interface EvalItem {
  id: string;
  category: string;
  input: z.input<typeof EvalInputSchema>;
  label: EvalLabel;
}

const LD = ['line_down'];
const NOT_LD = ['this_week', 'restock'];
const ANY = ['line_down', 'this_week', 'restock'];

const done = { first_decision: 'auto_approve', approver_role: null, replanned: false, status: 'executed' } as const;
const manager = { first_decision: 'needs_approval', approver_role: 'maintenance_manager', replanned: false, status: 'executed' } as const;
const owner = { first_decision: 'needs_approval', approver_role: 'owner', replanned: false, status: 'executed' } as const;
const reserved = { first_decision: null, approver_role: null, replanned: false, status: 'reserved' } as const;

export const EVAL_ITEMS: EvalItem[] = [
  // --- line down: reliability should win over price -------------------------------
  { id: 'ld-heald-l07', category: 'line_down', input: { raw_request: 'Loom L-07 stopped, heald wires snapped. Need 500 heald wires now.', setup: {} },
    label: { need: { skus: ['HW-330-OMNI'], qty: 500, urgency: LD, machine_id: ['L-07'] }, ...done } },
  { id: 'ld-motor-l03', category: 'line_down', input: { raw_request: 'L-03 is down, the main drive motor burned out. Need a replacement motor today.', setup: {} },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 1, urgency: LD, machine_id: ['L-03'] }, ...manager } },
  { id: 'ld-gripper-l11', category: 'line_down', input: { raw_request: 'Rapier loom L-11 stopped, gripper set worn out. Need one set urgently.', setup: {} },
    label: { need: { skus: ['GRIP-OPTI-SET'], qty: 1, urgency: LD, machine_id: ['L-11'] }, ...manager } },
  { id: 'ld-weft-l07', category: 'line_down', input: { raw_request: 'Weft detector on L-07 failed and the loom is stopped.', setup: {} },
    label: { need: { skus: ['SNS-WEFT-OMNI'], qty: 1, urgency: LD, machine_id: ['L-07'] }, ...done } },
  { id: 'ld-needles-k02', category: 'line_down', input: { raw_request: 'Knitting machine K-02 down, need 200 latch needles 28 gauge.', setup: {} },
    label: { need: { skus: ['NDL-LATCH-28G'], qty: 200, urgency: LD, machine_id: ['K-02'] }, ...done } },
  { id: 'ld-tape-s05', category: 'line_down', input: { raw_request: 'Spinning frame S-05 stopped, spindle tape broke. Need 10 spindle tapes.', setup: {} },
    label: { need: { skus: ['TAPE-SPN-12'], qty: 10, urgency: LD, machine_id: ['S-05'] }, ...done } },
  { id: 'ld-nozzle-l03', category: 'line_down', input: { raw_request: 'Air nozzle cracked on L-03 and the loom is down, need 2 main nozzles.', setup: {} },
    label: { need: { skus: ['NOZ-MAIN-OMNI'], qty: 2, urgency: LD, machine_id: ['L-03'] }, ...done } },
  { id: 'ld-reed-l07', category: 'line_down', input: { raw_request: 'Line 2 is down: the reed on L-07 is damaged, need a new 80 dent reed.', setup: {} },
    label: { need: { skus: ['REED-80D'], qty: 1, urgency: LD, machine_id: ['L-07'] }, ...done } },

  // --- storeroom ----------------------------------------------------------------
  { id: 'store-bearings-s04', category: 'storeroom', input: { raw_request: 'Need 2 x 6205 bearings for spinning frame S-04, it has stopped.', setup: {} },
    label: { need: { skus: ['BRG-6205-2RS'], qty: 2, urgency: LD, machine_id: ['S-04'] }, ...reserved } },
  { id: 'store-vbelt', category: 'storeroom', input: { raw_request: 'Grab 3 V-belts B52 for the workshop sometime this week.', setup: {} },
    label: { need: { skus: ['VB-B52'], qty: 3, urgency: ['this_week'], machine_id: [null] }, ...reserved } },
  { id: 'store-soda-ash', category: 'storeroom', input: { raw_request: 'Restock request: 50 kg soda ash for the chemical store.', setup: {} },
    label: { need: { skus: ['SODA-ASH-KG'], qty: 50, urgency: ['restock'], machine_id: [null] }, ...reserved } },
  { id: 'store-short-6206', category: 'storeroom', input: { raw_request: 'Please order 30 ball bearings 6206 for the store, routine restock.', setup: {} },
    label: { need: { skus: ['BRG-6206-2RS'], qty: 30, urgency: ['restock'], machine_id: [null] }, ...done } },

  // --- approval tiers -------------------------------------------------------------
  { id: 'tier-manager-reeds', category: 'approval_tier', input: { raw_request: 'Order 4 spare 80 dent reeds for loom L-11, routine restock.', setup: {} },
    label: { need: { skus: ['REED-80D'], qty: 4, urgency: ['restock'], machine_id: ['L-11'] }, ...manager } },
  { id: 'tier-owner-motors', category: 'approval_tier', input: { raw_request: 'Buy 2 spare drive motors for L-03 to keep on the shelf.', setup: {} },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 2, urgency: ['restock'], machine_id: ['L-03'] }, ...owner } },
  { id: 'tier-owner-grippers', category: 'approval_tier', input: { raw_request: 'Buy 8 gripper sets for L-11 for planned maintenance next month.', setup: {} },
    label: { need: { skus: ['GRIP-OPTI-SET'], qty: 8, urgency: ['restock'], machine_id: ['L-11'] }, ...owner } },
  { id: 'tier-manager-edge', category: 'approval_tier', input: { raw_request: 'Order 62 M18 proximity sensors for the L-03 retrofit this week.', setup: {} },
    label: { need: { skus: ['SNS-PROX-M18'], qty: 62, urgency: ['this_week'], machine_id: ['L-03'] }, ...manager } },
  { id: 'tier-auto-edge', category: 'approval_tier', input: { raw_request: 'Need 20 V-belts B52 this week.', setup: {} },
    label: { need: { skus: ['VB-B52'], qty: 20, urgency: ['this_week'], machine_id: [null] }, ...done } },

  // --- rejection ------------------------------------------------------------------
  { id: 'reject-motor', category: 'rejection', input: { raw_request: 'L-03 drive motor failed, loom down, need a new one.', setup: { decision: 'rejected' } },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 1, urgency: LD, machine_id: ['L-03'] }, ...manager, status: 'rejected' } },
  { id: 'reject-grippers', category: 'rejection', input: { raw_request: 'Buy 8 gripper sets for L-11 for planned maintenance next month.', setup: { decision: 'rejected' } },
    label: { need: { skus: ['GRIP-OPTI-SET'], qty: 8, urgency: ['restock'], machine_id: ['L-11'] }, ...owner, status: 'rejected' } },

  // --- budget blocks and replanning -------------------------------------------------
  { id: 'block-replan-motor', category: 'budget_block', input: { raw_request: 'L-03 drive motor failed, loom down, need a new one.', setup: { pre_orders: [{ scope_key: 'line_2', total: 2130 }] } },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 1, urgency: LD, machine_id: ['L-03'] }, first_decision: 'blocked', approver_role: 'maintenance_manager', replanned: true, status: 'executed' } },
  { id: 'block-nothing-fits', category: 'budget_block', input: { raw_request: 'L-03 drive motor failed, loom down, need a new one.', setup: { pre_orders: [{ scope_key: 'line_2', total: 2500 }] } },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 1, urgency: LD, machine_id: ['L-03'] }, first_decision: 'blocked', approver_role: null, replanned: true, status: 'blocked' } },
  { id: 'block-general', category: 'budget_block', input: { raw_request: 'Need 4 ball bearings 6305 for the store, routine restock.', setup: { pre_orders: [{ scope_key: 'general', total: 1490 }] } },
    label: { need: { skus: ['BRG-6305-ZZ'], qty: 4, urgency: ['restock'], machine_id: [null] }, first_decision: 'blocked', approver_role: null, replanned: true, status: 'blocked' } },

  // --- suppliers and approvers that aren't there --------------------------------------
  { id: 'unapproved-not-offered', category: 'unapproved_supplier', input: { raw_request: '5 inductive proximity sensors M18 for the store, restock.', setup: {} },
    label: { need: { skus: ['SNS-PROX-M18'], qty: 5, urgency: ['restock'], machine_id: [null] }, ...done } },
  { id: 'nobody-to-approve', category: 'missing_approver', input: { raw_request: 'L-03 drive motor failed, loom down, need a new one.', setup: { remove_roles: ['maintenance_manager', 'owner'] } },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 1, urgency: LD, machine_id: ['L-03'] }, first_decision: 'needs_approval', approver_role: null, replanned: false, status: 'blocked' } },
  { id: 'escalate-to-owner', category: 'missing_approver', input: { raw_request: 'Order 4 spare 80 dent reeds for loom L-11, routine restock.', setup: { remove_roles: ['maintenance_manager'] } },
    label: { need: { skus: ['REED-80D'], qty: 4, urgency: ['restock'], machine_id: ['L-11'] }, ...owner } },

  // --- policy changes during the wait ------------------------------------------------
  { id: 'wait-budget-spent', category: 'stale_approval', input: { raw_request: 'L-03 drive motor failed, loom down, need a new one.', setup: { orders_while_waiting: [{ scope_key: 'line_2', total: 2500 }] } },
    label: { need: { skus: ['MTR-DRV-OMNI'], qty: 1, urgency: LD, machine_id: ['L-03'] }, ...manager, status: 'blocked' } },
  { id: 'wait-owner-budget', category: 'stale_approval', input: { raw_request: 'Buy 8 gripper sets for L-11 for planned maintenance next month.', setup: { orders_while_waiting: [{ scope_key: 'line_1', total: 1000 }] } },
    label: { need: { skus: ['GRIP-OPTI-SET'], qty: 8, urgency: ['restock'], machine_id: ['L-11'] }, ...owner, status: 'blocked' } },

  // --- ambiguous and impossible --------------------------------------------------------
  { id: 'no-match-espresso', category: 'ambiguous', input: { raw_request: 'We need an espresso machine for the break room.', setup: {} },
    label: { need: { skus: [], qty: 1, urgency: NOT_LD, machine_id: [null] }, first_decision: null, approver_role: null, replanned: false, status: 'no_match' } },
  { id: 'ambiguous-belts', category: 'ambiguous', input: { raw_request: 'Need a belt.', setup: {} },
    label: { need: { skus: ['VB-B52', 'VB-B60'], qty: 1, urgency: ANY, machine_id: [null] }, ...done } },
  { id: 'ambiguous-optimax-heddles', category: 'ambiguous', input: { raw_request: 'Heddles for the OptiMax loom, 300 pieces.', setup: {} },
    label: { need: { skus: ['HW-280-OPTI'], qty: 300, urgency: ANY, machine_id: ['L-11', null] }, ...done } },
];
