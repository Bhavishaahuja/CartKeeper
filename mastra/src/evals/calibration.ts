/**
 * Judge calibration: 10 approval cards with a human label each.
 *
 * Five are complete. Five are each broken in one clear way. The experiment
 * reports how often the LLM judge agrees with these labels. The labels were
 * written by hand while building this set; re-check them yourself before
 * quoting the agreement number, since the point is agreement with *your*
 * judgement.
 */

export interface CalibrationCard {
  id: string;
  request: string;
  card: string;
  /** 1: an owner could decide from this in 10 seconds. 0: they couldn't. */
  label: 0 | 1;
  why: string;
}

const MOTOR_REQ = 'L-03 is down, the main drive motor burned out. Need a replacement motor today.';
const GRIP_REQ = 'Buy 8 gripper sets for L-11 for planned maintenance next month.';
const REED_REQ = 'Order 4 spare 80 dent reeds for loom L-11, routine restock.';

export const CALIBRATION_CARDS: CalibrationCard[] = [
  {
    id: 'good-motor', label: 1, why: 'Complete: what, cost, why approval, why the pricier supplier with both scores, urgency.',
    request: MOTOR_REQ,
    card: `Approve: 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00 (3 days).
Request: "${MOTOR_REQ}" (machine L-03, line_down).
Why approval: $890.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: L-03 is stopped, so delivery certainty matters more than the $30 difference. Precision Loom Parts scores 93.6 with 95% on-time; National Bearings & Belts is cheaper at $860 but scores 88.2 and takes 6 days.
Other quotes: National Bearings & Belts: $860.00 each, 6d, reliability 88.2, on time 89%.`,
  },
  {
    id: 'good-grippers', label: 1, why: 'Complete; cheapest pick for a routine order, says so.',
    request: GRIP_REQ,
    card: `Approve: 8 x Rapier gripper set (left + right) from Coimbatore Textile Spares for $1,680.00 (4 days).
Request: "${GRIP_REQ}" (machine L-11, restock).
Why approval: $1,680.00 needs owner approval (above every lower tier).
Why this supplier: This is planned maintenance a month out, so price matters most. Coimbatore is $35 a set cheaper; its 70% on-time rate is acceptable with four weeks of slack.
Other quotes: Precision Loom Parts Co: $245.00 each, 2d, reliability 93.6, on time 95%.`,
  },
  {
    id: 'good-reeds', label: 1, why: 'Complete and short.',
    request: REED_REQ,
    card: `Approve: 4 x Stainless reed, 80 dents/10 cm from Coimbatore Textile Spares for $472.00 (3 days).
Request: "${REED_REQ}" (machine L-11, restock).
Why approval: $472.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: Routine spares with no machine down, so the cheaper quote ($118 vs $135 each) wins.
Other quotes: Precision Loom Parts Co: $135.00 each, 2d, reliability 93.6, on time 95%.`,
  },
  {
    id: 'good-motor-replan', label: 1, why: 'Complete; explains the switch after a budget block.',
    request: MOTOR_REQ,
    card: `Approve: 1 x Loom main drive motor 7.5 kW (SUMO) from National Bearings & Belts for $860.00 (6 days).
Request: "${MOTOR_REQ}" (machine L-03, line_down).
Why approval: $860.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: The more reliable Precision Loom Parts motor ($890) was over the $870 left in Line 2's budget. National Bearings & Belts (score 88.2, 89% on time) is the best option that fits.
Other quotes: Precision Loom Parts Co: $890.00 each, 3d, reliability 93.6, on time 95%.`,
  },
  {
    id: 'good-sensors', label: 1, why: 'Complete; single supplier, says so.',
    request: 'Order 62 M18 proximity sensors for the L-03 retrofit this week.',
    card: `Approve: 62 x Inductive proximity sensor M18 from Precision Loom Parts Co for $1,488.00 (1 day).
Request: "Order 62 M18 proximity sensors for the L-03 retrofit this week." (machine L-03, this_week).
Why approval: $1,488.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: Only approved supplier for this sensor; it scores 93.6 with 95% on-time.
No other quotes for this part.`,
  },
  {
    id: 'bad-no-reason', label: 0, why: 'Never says why approval is needed.',
    request: MOTOR_REQ,
    card: `Approve: 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00 (3 days).
Request: "${MOTOR_REQ}" (machine L-03, line_down).
Why this supplier: L-03 is stopped. Precision Loom Parts scores 93.6 with 95% on-time; National Bearings & Belts scores 88.2.
Other quotes: National Bearings & Belts: $860.00 each, 6d, reliability 88.2, on time 89%.`,
  },
  {
    id: 'bad-unjustified-pricier', label: 0, why: 'Picks the pricier supplier with no evidence why.',
    request: GRIP_REQ,
    card: `Approve: 8 x Rapier gripper set (left + right) from Precision Loom Parts Co for $1,960.00 (2 days).
Request: "${GRIP_REQ}" (machine L-11, restock).
Why approval: $1,960.00 needs owner approval (above every lower tier).
Why this supplier: Best option.
Other quotes: Coimbatore Textile Spares: $210.00 each, 4d, reliability 69.9, on time 70%.`,
  },
  {
    id: 'bad-wrong-total', label: 0, why: 'Total contradicts quantity x price ($890 x 2 is not $890).',
    request: 'Buy 2 spare drive motors for L-03 to keep on the shelf.',
    card: `Approve: 2 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00 (3 days).
Request: "Buy 2 spare drive motors for L-03 to keep on the shelf." (machine L-03, restock).
Why approval: $890.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: Precision Loom Parts scores 93.6 with 95% on-time versus 88.2 for National Bearings & Belts at $860.
Other quotes: National Bearings & Belts: $860.00 each, 6d, reliability 88.2, on time 89%.`,
  },
  {
    id: 'bad-what-missing', label: 0, why: 'Never says what is being bought or how many.',
    request: REED_REQ,
    card: `Approve: order from Coimbatore Textile Spares for $472.00.
Why approval: $472.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: Cheaper quote for a routine restock.
Other quotes: Precision Loom Parts Co: $135.00 each, 2d, reliability 93.6, on time 95%.`,
  },
  {
    id: 'bad-wall-of-text', label: 0, why: 'Buries the decision in irrelevant detail; not readable in 10 seconds.',
    request: MOTOR_REQ,
    card: `Approve: 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00 (3 days).
Why approval: $890.00 needs maintenance manager approval (up to $1,500.00).
Why this supplier: ${'Air-jet looms such as the Picanol OMNIplus-i rely on a synchronous main drive whose torque profile, insulation class and bearing arrangement have evolved across several generations, and the history of the SUMO drive goes back to the early 2000s when direct drive replaced belt drives; '.repeat(4)}Precision Loom Parts scores 93.6.
Other quotes: National Bearings & Belts: $860.00 each, 6d, reliability 88.2, on time 89%.`,
  },
];
