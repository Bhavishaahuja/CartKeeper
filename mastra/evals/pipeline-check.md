> **Pipeline check, not model results.** Scripted models (no API calls): `oracle` reads every need as labeled and buys carefully, `cheapest` always takes the lowest price, `sloppy` misreads urgency and quantity. It shows the scorers separate them. Real results go in `evals/results/` after `npm run evals` with a key.

# CartKeeper eval results

2026-11-18T23:44:07.010Z · 30 labeled requests · 3 runs per model · judge: not run

Mean score per scorer with a 95% bootstrap interval (items resampled; each item averaged over runs first). n = items scored.

| Model | intake-accuracy | supplier-choice | hitl-invariants | decision-path |
| --- | --- | --- | --- | --- |
| oracle | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=8 | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=30 |
| cheapest | 100.0% [100.0%, 100.0%] n=30 | 0.0% [0.0%, 0.0%] n=9 | 100.0% [100.0%, 100.0%] n=30 | 98.3% [95.0%, 100.0%] n=30 |
| sloppy | 70.0% [65.8%, 75.0%] n=30 | n/a | 100.0% [100.0%, 100.0%] n=30 | 81.7% [73.3%, 90.0%] n=30 |

## oracle

0 item run(s) failed. Experiments: b6b51185-7fbd-4798-9f03-214825070fdb, de95dfcb-e533-4095-ae76-87adc58d5017, 2690178a-b37f-45a0-8f01-4fcedf378753.

No misses.

## cheapest

0 item run(s) failed. Experiments: daabded0-dcc5-4abf-8ac9-44fe01ae2455, 33c62164-b7d9-435d-8e6a-7aad6cedd774, 7315cf67-3e02-4504-ae66-ab7b3f1db1bd.

| Scorer | Item | Run | Score | Reason |
| --- | --- | --- | --- | --- |
| supplier-choice | reject-motor | 1 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-motor-l03 | 1 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | wait-budget-spent | 1 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | nobody-to-approve | 1 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-heald-l07 | 1 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | block-replan-motor | 1 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-reed-l07 | 1 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ambiguous-optimax-heddles | 1 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-gripper-l11 | 1 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | reject-motor | 2 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-motor-l03 | 2 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | wait-budget-spent | 2 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | nobody-to-approve | 2 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-heald-l07 | 2 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | block-replan-motor | 2 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-reed-l07 | 2 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ambiguous-optimax-heddles | 2 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-gripper-l11 | 2 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | reject-motor | 3 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-motor-l03 | 3 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | wait-budget-spent | 3 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | nobody-to-approve | 3 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-heald-l07 | 3 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | block-replan-motor | 3 | 0.00 | Picked SUP-03 (score 88.2) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-reed-l07 | 3 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ambiguous-optimax-heddles | 3 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| supplier-choice | ld-gripper-l11 | 3 | 0.00 | Picked SUP-01 (score 69.9) over a score-93.6 supplier: the cheapest, not the most reliable. |
| decision-path | block-replan-motor | 1 | 0.50 | first_decision: expected blocked, got needs_approval; replanned: expected true, got false |
| decision-path | block-replan-motor | 2 | 0.50 | first_decision: expected blocked, got needs_approval; replanned: expected true, got false |
| decision-path | block-replan-motor | 3 | 0.50 | first_decision: expected blocked, got needs_approval; replanned: expected true, got false |

## sloppy

0 item run(s) failed. Experiments: c5bf0b6b-9955-4d96-acf4-fd39f92b853d, 28d412dd-201d-43bd-8ac3-f2e4a7fbe287, 9610189d-540a-49dd-92ee-e92fca1209b0.

| Scorer | Item | Run | Score | Reason |
| --- | --- | --- | --- | --- |
| intake-accuracy | escalate-to-owner | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-tape-s05 | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | reject-motor | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-motor-l03 | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | store-short-6206 | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | wait-budget-spent | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | nobody-to-approve | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-motors | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | tier-manager-edge | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | ld-heald-l07 | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | unapproved-not-offered | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | block-replan-motor | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-nozzle-l03 | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | block-nothing-fits | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-reed-l07 | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | ambiguous-optimax-heddles | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-needles-k02 | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | tier-auto-edge | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | store-soda-ash | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | store-vbelt | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | tier-manager-reeds | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-weft-l07 | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | block-general | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-gripper-l11 | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | store-bearings-s04 | 1 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | wait-owner-budget | 1 | 0.75 | Wrong: qty. |
| intake-accuracy | escalate-to-owner | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-tape-s05 | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | reject-motor | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-motor-l03 | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | store-short-6206 | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | wait-budget-spent | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | nobody-to-approve | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-motors | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | tier-manager-edge | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | ld-heald-l07 | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | unapproved-not-offered | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | block-replan-motor | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-nozzle-l03 | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | block-nothing-fits | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-reed-l07 | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | ambiguous-optimax-heddles | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-needles-k02 | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | tier-auto-edge | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | store-soda-ash | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | store-vbelt | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | tier-manager-reeds | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-weft-l07 | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | block-general | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-gripper-l11 | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | store-bearings-s04 | 2 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | wait-owner-budget | 2 | 0.75 | Wrong: qty. |
| intake-accuracy | escalate-to-owner | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-tape-s05 | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | reject-motor | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-motor-l03 | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | store-short-6206 | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | wait-budget-spent | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | nobody-to-approve | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-motors | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | tier-manager-edge | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | ld-heald-l07 | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | unapproved-not-offered | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | block-replan-motor | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-nozzle-l03 | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | block-nothing-fits | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | ld-reed-l07 | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | ambiguous-optimax-heddles | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-needles-k02 | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | tier-auto-edge | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | store-soda-ash | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | store-vbelt | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | tier-manager-reeds | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-weft-l07 | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | block-general | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | ld-gripper-l11 | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 3 | 0.75 | Wrong: qty. |
| intake-accuracy | store-bearings-s04 | 3 | 0.50 | Wrong: qty, urgency. |
| intake-accuracy | wait-owner-budget | 3 | 0.75 | Wrong: qty. |
| decision-path | escalate-to-owner | 1 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected owner, got null |
| decision-path | store-short-6206 | 1 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | tier-owner-grippers | 1 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | tier-owner-motors | 1 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | tier-manager-edge | 1 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected maintenance_manager, got null |
| decision-path | ld-heald-l07 | 1 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | block-replan-motor | 1 | 0.50 | first_decision: expected blocked, got needs_approval; replanned: expected true, got false |
| decision-path | tier-auto-edge | 1 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | tier-manager-reeds | 1 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected maintenance_manager, got null |
| decision-path | block-general | 1 | 0.25 | first_decision: expected blocked, got auto_approve; replanned: expected true, got false; status: expected blocked, got executed |
| decision-path | reject-grippers | 1 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | wait-owner-budget | 1 | 0.50 | approver_role: expected owner, got maintenance_manager; status: expected blocked, got executed |
| decision-path | escalate-to-owner | 2 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected owner, got null |
| decision-path | store-short-6206 | 2 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | tier-owner-grippers | 2 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | tier-owner-motors | 2 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | tier-manager-edge | 2 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected maintenance_manager, got null |
| decision-path | ld-heald-l07 | 2 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | block-replan-motor | 2 | 0.50 | first_decision: expected blocked, got needs_approval; replanned: expected true, got false |
| decision-path | tier-auto-edge | 2 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | tier-manager-reeds | 2 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected maintenance_manager, got null |
| decision-path | block-general | 2 | 0.25 | first_decision: expected blocked, got auto_approve; replanned: expected true, got false; status: expected blocked, got executed |
| decision-path | reject-grippers | 2 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | wait-owner-budget | 2 | 0.50 | approver_role: expected owner, got maintenance_manager; status: expected blocked, got executed |
| decision-path | escalate-to-owner | 3 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected owner, got null |
| decision-path | store-short-6206 | 3 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | tier-owner-grippers | 3 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | tier-owner-motors | 3 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | tier-manager-edge | 3 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected maintenance_manager, got null |
| decision-path | ld-heald-l07 | 3 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | block-replan-motor | 3 | 0.50 | first_decision: expected blocked, got needs_approval; replanned: expected true, got false |
| decision-path | tier-auto-edge | 3 | 0.50 | first_decision: expected auto_approve, got null; status: expected executed, got reserved |
| decision-path | tier-manager-reeds | 3 | 0.50 | first_decision: expected needs_approval, got auto_approve; approver_role: expected maintenance_manager, got null |
| decision-path | block-general | 3 | 0.25 | first_decision: expected blocked, got auto_approve; replanned: expected true, got false; status: expected blocked, got executed |
| decision-path | reject-grippers | 3 | 0.75 | approver_role: expected owner, got maintenance_manager |
| decision-path | wait-owner-budget | 3 | 0.50 | approver_role: expected owner, got maintenance_manager; status: expected blocked, got executed |
