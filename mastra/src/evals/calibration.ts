/**
 * Judge calibration: 10 approval cards with a human label each.
 *
 * Five are complete. Five are each broken in one clear way. The experiment
 * reports how often the LLM judge agrees with these labels. The labels were
 * written by hand while building this set; re-check them yourself before
 * quoting the agreement number, since the point is agreement with *your*
 * judgement.
 *
 * The cards use the same layout as approvalCard() and the real figures from the
 * seed history (SUP-02 score 93.6, 93.6% on time, 2.3% defects; SUP-03 88.2,
 * 89.1%, 4.6%; SUP-01 69.9, 72.7%, 10.1%), so a good card here looks like a
 * good card in production.
 */

export interface CalibrationCard {
  id: string;
  request: string;
  card: string;
  /** 1: an owner could decide from this at a glance. 0: they couldn't. */
  label: 0 | 1;
  why: string;
}

const MOTOR_REQ = 'L-03 is down, the main drive motor burned out. Need a replacement motor today.';
const GRIP_REQ = 'Buy 8 gripper sets for L-11 for planned maintenance next month.';
const REED_REQ = 'Order 4 spare 80 dent reeds for loom L-11, routine restock.';
const SENSOR_REQ = 'Order 62 M18 proximity sensors for the L-03 retrofit this week.';

const PRECISION = 'score 93.6, 93.6% on time, 2.3% defects';
const NATIONAL = 'score 88.2, 89.1% on time, 4.6% defects';
const COIMBATORE = 'score 69.9, 72.7% on time, 10.1% defects';

export const CALIBRATION_CARDS: CalibrationCard[] = [
  {
    id: 'good-motor', label: 1, why: 'Complete: what, cost, arrival, why approval, why the pricier supplier with figures, urgency.',
    request: MOTOR_REQ,
    card: `Approve 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00, arriving in 3 days.
Why you: $890.00 needs maintenance manager approval (up to $1,500.00).
Context: L-03 (Picanol OMNIplus-i, line 2): Machine stopped.
Why this supplier: The loom is stopped, so delivery matters more than the $30 saving. Precision arrives 3 days sooner and is more reliable (93.6% vs 89.1% on time).
Quotes:
- Precision Loom Parts Co (chosen): $890.00 each, 3 days, ${PRECISION}
- National Bearings & Belts: $860.00 each, 6 days, ${NATIONAL}`,
  },
  {
    id: 'good-grippers', label: 1, why: 'Complete; cheapest pick for a routine order, says so.',
    request: GRIP_REQ,
    card: `Approve 8 x Rapier gripper set (left + right) from Coimbatore Textile Spares for $1,680.00, arriving in 4 days.
Why you: $1,680.00 needs owner approval (above every lower tier).
Context: L-11 (Picanol OptiMax-i, line 1): Routine restock.
Why this supplier: Planned maintenance a month out, so price matters most. Coimbatore is $280 cheaper in total; its 72.7% on-time rate is acceptable with weeks of slack.
Quotes:
- Coimbatore Textile Spares (chosen): $210.00 each, 4 days, ${COIMBATORE}
- Precision Loom Parts Co: $245.00 each, 2 days, ${PRECISION}`,
  },
  {
    id: 'good-reeds', label: 1, why: 'Complete and short.',
    request: REED_REQ,
    card: `Approve 4 x Stainless reed, 80 dents/10 cm from Coimbatore Textile Spares for $472.00, arriving in 3 days.
Why you: $472.00 needs maintenance manager approval (up to $1,500.00).
Context: L-11 (Picanol OptiMax-i, line 1): Routine restock.
Why this supplier: Routine spares with no machine down, so the cheaper quote wins ($118 vs $135 each).
Quotes:
- Coimbatore Textile Spares (chosen): $118.00 each, 3 days, ${COIMBATORE}
- Precision Loom Parts Co: $135.00 each, 2 days, ${PRECISION}`,
  },
  {
    id: 'good-motor-replan', label: 1, why: 'Complete; explains the switch after a budget block.',
    request: MOTOR_REQ,
    card: `Approve 1 x Loom main drive motor 7.5 kW (SUMO) from National Bearings & Belts for $860.00, arriving in 6 days.
Why you: $860.00 needs maintenance manager approval (up to $1,500.00).
Context: L-03 (Picanol OMNIplus-i, line 2): Machine stopped.
Why this supplier: The more reliable Precision motor ($890.00) was blocked: it is more than the $870.00 left in line 2's budget. National Bearings & Belts is the best option that fits.
Quotes:
- National Bearings & Belts (chosen): $860.00 each, 6 days, ${NATIONAL}
- Precision Loom Parts Co: $890.00 each, 3 days, ${PRECISION}`,
  },
  {
    id: 'good-sensors', label: 1, why: 'Complete; single supplier, says so.',
    request: SENSOR_REQ,
    card: `Approve 62 x Inductive proximity sensor M18 from Precision Loom Parts Co for $1,488.00, arriving in 1 day.
Why you: $1,488.00 needs maintenance manager approval (up to $1,500.00).
Context: L-03 (Picanol OMNIplus-i, line 2): Needed this week.
Why this supplier: The only approved supplier quoting this sensor.
Quotes:
- Precision Loom Parts Co (chosen): $24.00 each, 1 day, ${PRECISION}`,
  },
  {
    id: 'bad-no-reason', label: 0, why: 'Never says why approval is needed.',
    request: MOTOR_REQ,
    card: `Approve 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00, arriving in 3 days.
Context: L-03 (Picanol OMNIplus-i, line 2): Machine stopped.
Why this supplier: The loom is stopped, so delivery matters more than the $30 saving. Precision arrives 3 days sooner and is more reliable (93.6% vs 89.1% on time).
Quotes:
- Precision Loom Parts Co (chosen): $890.00 each, 3 days, ${PRECISION}
- National Bearings & Belts: $860.00 each, 6 days, ${NATIONAL}`,
  },
  {
    id: 'bad-unjustified-pricier', label: 0, why: 'Picks the pricier supplier with no evidence why.',
    request: GRIP_REQ,
    card: `Approve 8 x Rapier gripper set (left + right) from Precision Loom Parts Co for $1,960.00, arriving in 2 days.
Why you: $1,960.00 needs owner approval (above every lower tier).
Context: L-11 (Picanol OptiMax-i, line 1): Routine restock.
Why this supplier: Best option.
Quotes:
- Precision Loom Parts Co (chosen): $245.00 each, 2 days, ${PRECISION}
- Coimbatore Textile Spares: $210.00 each, 4 days, ${COIMBATORE}`,
  },
  {
    id: 'bad-wrong-total', label: 0, why: 'Total contradicts quantity x price ($890 x 2 is not $890).',
    request: 'Buy 2 spare drive motors for L-03 to keep on the shelf.',
    card: `Approve 2 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00, arriving in 3 days.
Why you: $890.00 needs maintenance manager approval (up to $1,500.00).
Context: L-03 (Picanol OMNIplus-i, line 2): Routine restock.
Why this supplier: Precision is more reliable (93.6% vs 89.1% on time) for $30 more per motor.
Quotes:
- Precision Loom Parts Co (chosen): $890.00 each, 3 days, ${PRECISION}
- National Bearings & Belts: $860.00 each, 6 days, ${NATIONAL}`,
  },
  {
    id: 'bad-what-missing', label: 0, why: 'Never says what is being bought or how many.',
    request: REED_REQ,
    card: `Approve an order from Coimbatore Textile Spares for $472.00.
Why you: $472.00 needs maintenance manager approval (up to $1,500.00).
Context: Routine restock.
Why this supplier: Cheaper quote for a routine restock.
Quotes:
- Coimbatore Textile Spares (chosen): ${COIMBATORE}
- Precision Loom Parts Co: ${PRECISION}`,
  },
  {
    id: 'bad-wall-of-text', label: 0, why: 'Buries the decision in irrelevant detail.',
    request: MOTOR_REQ,
    card: `Approve 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts Co for $890.00, arriving in 3 days.
Why you: $890.00 needs maintenance manager approval (up to $1,500.00).
Context: L-03 (Picanol OMNIplus-i, line 2): Machine stopped.
Why this supplier: ${'Air-jet looms such as the Picanol OMNIplus-i rely on a synchronous main drive whose torque profile, insulation class and bearing arrangement have evolved across several generations, and the history of the SUMO drive goes back to the early 2000s when direct drive replaced belt drives; '.repeat(4)}Precision is more reliable.
Quotes:
- Precision Loom Parts Co (chosen): $890.00 each, 3 days, ${PRECISION}
- National Bearings & Belts: $860.00 each, 6 days, ${NATIONAL}`,
  },
];
