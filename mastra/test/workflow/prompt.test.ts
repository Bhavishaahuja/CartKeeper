// The propose prompt writes for the approver: names and card figures, no internal ids or weights.
import { expect, it } from 'vitest';
import { PROPOSE_SYSTEM } from '../../src/purchase/steps';
import { harness, HEALD } from './harness';

it('tells the model its rationale is read by the approver, with only the card figures', async () => {
  expect(PROPOSE_SYSTEM).toContain('Refer to suppliers by name');
  expect(PROPOSE_SYSTEM).toContain('Do not mention option ids, supplier ids, urgency weights or order counts.');
  const h = harness(HEALD);
  await h.service.start('heald wires');
  expect(h.model.calls.find(([n]) => n === 'Choice')![1].system).toContain('shown to the person who approves');
});
