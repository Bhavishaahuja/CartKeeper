# CartKeeper eval results

2026-11-19T00:10:15.447Z · 30 labeled requests · 3 runs per model · judge: anthropic/claude-opus-5-5

Mean score per scorer with a 95% bootstrap interval (items resampled; each item averaged over runs first). n = items scored.

| Model | intake-accuracy | supplier-choice | hitl-invariants | decision-path | approver-explanation |
| --- | --- | --- | --- | --- | --- |
| sonnet | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=7 | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=30 | 0.0% [0.0%, 0.0%] n=12 |
| haiku | 98.1% [95.6%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=7 | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=30 | 0.0% [0.0%, 0.0%] n=12 |

## sonnet

0 item run(s) failed. Experiments: 07adbcae-f6d2-4e57-be0a-df59922ff131, 36edf74d-cc86-4886-8e07-158431b4861f, f0691ab3-ad59-45b5-9b5b-0d4745582c6b.

| Scorer | Item | Run | Score | Reason |
| --- | --- | --- | --- | --- |
| approver-explanation | block-replan-motor | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → It states 1 x Loom main drive motor 7.5 kW (SUMO) from National Bearings  |
| approver-explanation | wait-budget-spent | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 1 x Loom main drive motor 7.5 kW (SUMO) from Precision  |
| approver-explanation | tier-owner-grippers | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 8 x Rapier gripper set (left + right) from Coimbatore T |
| approver-explanation | ld-gripper-l11 | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 1 x Rapier gripper set (left + right), from Precisi |
| approver-explanation | reject-motor | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives all four: 1 x Loom main drive motor 7.5 kW, from Pre |
| approver-explanation | tier-owner-motors | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives the item (Loom main drive motor 7.5 kW, SUMO), quant |
| approver-explanation | tier-manager-edge | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → It states 62 x inductive proximity sensor M18 from Precision Loom Parts C |
| approver-explanation | wait-owner-budget | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 8 x Rapier gripper set (left + right) from Coimbatore T |
| approver-explanation | ld-motor-l03 | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states the item (Loom main drive motor 7.5 kW, SUMO), quantity |
| approver-explanation | escalate-to-owner | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reed, 80 dents/10 cm, from Precision Loom |
| approver-explanation | reject-grippers | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 8 x Rapier gripper sets from Coimbatore Textile Spa |
| approver-explanation | tier-manager-reeds | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reed, 80 dents/10 cm, from Coimbatore Tex |
| approver-explanation | block-replan-motor | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW (SUMO) from National Bearings & B |
| approver-explanation | wait-budget-spent | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 1 x Loom main drive motor 7.5 kW from Precision Loo |
| approver-explanation | tier-owner-grippers | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 8 x Rapier gripper set (left + right) from Coimbatore Textile Spar |
| approver-explanation | ld-gripper-l11 | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives all four: 1 x Rapier gripper set (left + right), fro |
| approver-explanation | reject-motor | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states the item (1 x Loom main drive motor 7.5 kW), the qu |
| approver-explanation | tier-owner-motors | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names 2 x Loom main drive motor 7.5 kW from Precision Loom Par |
| approver-explanation | tier-manager-edge | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 62 x Inductive proximity sensor M18 from Precision Loom |
| approver-explanation | wait-owner-budget | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 8 x Rapier gripper set (left + right) from Coimbatore T |
| approver-explanation | ld-motor-l03 | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW (SUMO), from Precision Loom Parts |
| approver-explanation | escalate-to-owner | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reeds (80 dents/10 cm) from Coimbatore Te |
| approver-explanation | reject-grippers | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names the item (Rapier gripper set, left + right), the quantit |
| approver-explanation | tier-manager-reeds | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 4 x stainless reed, 80 dents/10 cm, from Coimbatore Textile Spares |
| approver-explanation | block-replan-motor | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → It states 1 x Loom main drive motor 7.5 kW (SUMO), from National Bearings |
| approver-explanation | wait-budget-spent | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW from Precision Loom Parts Co for  |
| approver-explanation | tier-owner-grippers | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states: 8 x Rapier gripper set (left + right), from Coimba |
| approver-explanation | ld-gripper-l11 | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states the item (Rapier gripper set, left + right), the quanti |
| approver-explanation | reject-motor | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names the item (1 x Loom main drive motor 7.5 kW), the quantit |
| approver-explanation | tier-owner-motors | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → It names the item (2 x Loom main drive motor 7.5 kW), the quantity (2), t |
| approver-explanation | tier-manager-edge | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names the item (inductive proximity sensor M18), the quantity  |
| approver-explanation | wait-owner-budget | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 8 x Rapier gripper set from Coimbatore Textile Spar |
| approver-explanation | ld-motor-l03 | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts  |
| approver-explanation | escalate-to-owner | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names 4 x Stainless reed, 80 dents/10 cm, from Coimbatore Text |
| approver-explanation | reject-grippers | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 8 x Rapier gripper set (left + right), from Coimbat |
| approver-explanation | tier-manager-reeds | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states '4 x Stainless reed, 80 dents/10 cm from Precision Loom |

## haiku

0 item run(s) failed. Experiments: 8a6979b4-8e17-44f5-8052-dc8b4bb7c3ef, 25976426-5120-4769-99fc-58c6fa93a5b1, 79b8d3cf-87ac-46f6-b079-97b488420182.

| Scorer | Item | Run | Score | Reason |
| --- | --- | --- | --- | --- |
| intake-accuracy | tier-owner-grippers | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | wait-owner-budget | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | wait-owner-budget | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 3 | 0.75 | Wrong: urgency. |
| approver-explanation | block-replan-motor | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names the item and quantity (1 x Loom main drive motor 7.5 kW) |
| approver-explanation | wait-budget-spent | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states all four: 1 x Loom main drive motor 7.5 kW (SUMO),  |
| approver-explanation | tier-owner-grippers | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names 8 Rapier gripper sets (left + right) from Precision Loom |
| approver-explanation | ld-gripper-l11 | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states '1 x Rapier gripper set (left + right) from Precision L |
| approver-explanation | reject-motor | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 1 x Loom main drive motor 7.5 kW from Precision Loom Pa |
| approver-explanation | tier-owner-motors | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 2 x Loom main drive motor 7.5 kW from National Bear |
| approver-explanation | tier-manager-edge | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 62 x Inductive proximity sensor M18 from Precision Loom |
| approver-explanation | wait-owner-budget | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output names 8 x Rapier gripper sets from Precision Loom Parts Co for |
| approver-explanation | ld-motor-l03 | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW (SUMO) from Precision Loom Parts  |
| approver-explanation | escalate-to-owner | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reed, 80 dents/10 cm, from Coimbatore Tex |
| approver-explanation | reject-grippers | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 8 x Rapier gripper set (left + right) from Precision Loom Parts Co |
| approver-explanation | tier-manager-reeds | 1 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reed, 80 dents/10 cm, from Coimbatore Tex |
| approver-explanation | block-replan-motor | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 1 x Loom main drive motor 7.5 kW from National Bearings |
| approver-explanation | wait-budget-spent | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives the item (Loom main drive motor 7.5 kW, SUMO), quant |
| approver-explanation | tier-owner-grippers | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives 8 x Rapier gripper set (left + right) from Precision |
| approver-explanation | ld-gripper-l11 | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 1 x Rapier gripper set (left + right) from Precisio |
| approver-explanation | reject-motor | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 1 x Loom main drive motor 7.5 kW (SUMO) from Precision  |
| approver-explanation | tier-owner-motors | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives the item (2 x Loom main drive motor 7.5 kW), the qua |
| approver-explanation | tier-manager-edge | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives all four: 62 x inductive proximity sensor M18, from  |
| approver-explanation | wait-owner-budget | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives all four: 8 x Rapier gripper set (left + right), fro |
| approver-explanation | ld-motor-l03 | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW (SUMO), from Precision Loom Parts |
| approver-explanation | escalate-to-owner | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reed, 80 dents/10 cm, from Coimbatore Tex |
| approver-explanation | reject-grippers | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 8 x Rapier gripper set (left + right), from Coimbat |
| approver-explanation | tier-manager-reeds | 2 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 4 x stainless reed, 80 dents/10 cm, from Coimbatore Textile Spares |
| approver-explanation | block-replan-motor | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states '1 x Loom main drive motor 7.5 kW (SUMO) from National  |
| approver-explanation | wait-budget-spent | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives the item (1 x Loom main drive motor 7.5 kW), the qua |
| approver-explanation | tier-owner-grippers | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives all four: 8 x Rapier gripper set, from Precision Loo |
| approver-explanation | ld-gripper-l11 | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output says '1 x Rapier gripper set (left + right) from Precision Loo |
| approver-explanation | reject-motor | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 1 x Loom main drive motor 7.5 kW (SUMO) from Precis |
| approver-explanation | tier-owner-motors | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 2 x Loom main drive motor 7.5 kW (SUMO) from National B |
| approver-explanation | tier-manager-edge | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → It states 62 x Inductive proximity sensor M18 from Precision Loom Parts C |
| approver-explanation | wait-owner-budget | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line states 8 x Rapier gripper sets from Precision Loom Parts C |
| approver-explanation | ld-motor-l03 | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → States 1 x Loom main drive motor 7.5 kW from Precision Loom Parts Co for  |
| approver-explanation | escalate-to-owner | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The output states 4 x stainless reed, 80 dents/10 cm, from Coimbatore Tex |
| approver-explanation | reject-grippers | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → The first line gives the item (Rapier gripper set), the quantity (8), the |
| approver-explanation | tier-manager-reeds | 3 | 0.00 | ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, and the total cost.    → It states 4 x stainless reed, 80 dents/10 cm, from Coimbatore Textile Spa |

## Judge agreement

The rubric judge agreed with the hand labels on 7 of 10 calibration cards (70.0%).

- good-motor: label 1, judge 0 (Complete: what, cost, why approval, why the pricier supplier with both scores, urgency.)
- good-motor-replan: label 1, judge 0 (Complete; explains the switch after a budget block.)
- good-sensors: label 1, judge 0 (Complete; single supplier, says so.)
