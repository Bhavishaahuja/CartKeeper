# CartKeeper eval results

2026-11-19T00:50:43.981Z · 30 labeled requests · 3 runs per model · judge: anthropic/claude-opus-5-5

Mean score per scorer with a 95% bootstrap interval (items resampled; each item averaged over runs first). n = items scored.

| Model | intake-accuracy | supplier-choice | hitl-invariants | decision-path | approver-explanation |
| --- | --- | --- | --- | --- | --- |
| sonnet | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=7 | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=30 | 55.6% [33.3%, 77.8%] n=12 |
| haiku | 97.5% [94.2%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=7 | 100.0% [100.0%, 100.0%] n=30 | 100.0% [100.0%, 100.0%] n=30 | 41.7% [19.4%, 63.9%] n=12 |

sonnet, approver-explanation: 36 cards judged; unmet criteria: consistent 14, concise 3, why-approval 2.

haiku, approver-explanation: 36 cards judged; unmet criteria: consistent 20, urgency 9, concise 2, why-approval 2.

## sonnet

0 item run(s) failed. Experiments: 8a62963f-626d-41d3-a114-4299a51b3a78, 477b6a2c-c722-45c2-9d4b-7c3eb702d241, 0954de40-9f0c-441e-bf25-f2df9a78f684.

| Scorer | Item | Run | Score | Reason |
| --- | --- | --- | --- | --- |
| approver-explanation | block-replan-motor | 1 | 0.00 | Unmet: consistent, concise.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the it |
| approver-explanation | tier-owner-grippers | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line names 8 x Rapier grip |
| approver-explanation | tier-owner-motors | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line names the item (2 x L |
| approver-explanation | wait-owner-budget | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 8 x Rapier grip |
| approver-explanation | reject-grippers | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line states 8 x Rapier gri |
| approver-explanation | tier-manager-reeds | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives all five: 4 x s |
| approver-explanation | block-replan-motor | 2 | 0.00 | Unmet: consistent, concise.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line states 1 x L |
| approver-explanation | tier-owner-grippers | 2 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives all five elemen |
| approver-explanation | tier-manager-edge | 2 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (induc |
| approver-explanation | reject-grippers | 2 | 0.00 | Unmet: why-approval.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 8 x Rapier gr |
| approver-explanation | tier-manager-reeds | 2 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives all five: 4 x s |
| approver-explanation | block-replan-motor | 3 | 0.00 | Unmet: consistent, concise.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the it |
| approver-explanation | wait-budget-spent | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives quantity 1, the |
| approver-explanation | tier-owner-grippers | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Rapie |
| approver-explanation | escalate-to-owner | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (stain |
| approver-explanation | reject-grippers | 3 | 0.00 | Unmet: why-approval.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line states 8 x Rapier g |

## haiku

0 item run(s) failed. Experiments: 76890dc5-265e-4066-9610-c8b9e0129999, e825017b-1892-420d-968f-1f67befaeee4, 95507cca-af49-4dbd-b454-6a15e16ffec2.

| Scorer | Item | Run | Score | Reason |
| --- | --- | --- | --- | --- |
| intake-accuracy | tier-owner-grippers | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | wait-owner-budget | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 1 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | wait-owner-budget | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 2 | 0.75 | Wrong: urgency. |
| intake-accuracy | tier-owner-grippers | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | wait-owner-budget | 3 | 0.75 | Wrong: urgency. |
| intake-accuracy | reject-grippers | 3 | 0.75 | Wrong: urgency. |
| approver-explanation | block-replan-motor | 1 | 0.00 | Unmet: consistent, concise.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 1 x Lo |
| approver-explanation | tier-owner-grippers | 1 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the it |
| approver-explanation | tier-owner-motors | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Loom  |
| approver-explanation | wait-owner-budget | 1 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line covers all f |
| approver-explanation | ld-motor-l03 | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Loom  |
| approver-explanation | reject-grippers | 1 | 0.00 | Unmet: why-approval, urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first lin |
| approver-explanation | tier-manager-reeds | 1 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line names the item (stain |
| approver-explanation | block-replan-motor | 2 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Loom  |
| approver-explanation | tier-owner-grippers | 2 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the it |
| approver-explanation | wait-owner-budget | 2 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 8 x Ra |
| approver-explanation | reject-grippers | 2 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 8 x Ra |
| approver-explanation | tier-manager-reeds | 2 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Stain |
| approver-explanation | block-replan-motor | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Loom  |
| approver-explanation | tier-owner-grippers | 3 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the it |
| approver-explanation | ld-gripper-l11 | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Rapie |
| approver-explanation | tier-owner-motors | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (Loom  |
| approver-explanation | tier-manager-edge | 3 | 0.00 | Unmet: concise.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (inductiv |
| approver-explanation | wait-owner-budget | 3 | 0.00 | Unmet: why-approval, urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first lin |
| approver-explanation | escalate-to-owner | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 4 x Stainless r |
| approver-explanation | reject-grippers | 3 | 0.00 | Unmet: urgency, consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives 8 x Ra |
| approver-explanation | tier-manager-reeds | 3 | 0.00 | Unmet: consistent.  ❌ Rubric not yet satisfied.  ✅ [required] States what is being bought, how many, from which supplier, the total cost, and when it arrives.    → The first line gives the item (stain |

## Judge agreement

The rubric judge agreed with the hand labels on 9 of 10 calibration cards (90.0%).

- good-grippers: label 1, judge 0, unmet: why-approval (Complete; cheapest pick for a routine order, says so.)
