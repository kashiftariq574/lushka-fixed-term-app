import test from 'node:test';
import assert from 'node:assert/strict';

function discountedMinor(baseMinor, pct) { return Math.round(baseMinor * (1 - pct / 100)); }
function assertBillableCycle(i) {
  if (!Number.isInteger(i) || i < 1) throw new Error('Invalid billing cycle index');
  if (i > 3) throw new Error('LUSHKA_FIXED_TERM_COMPLETE: cycle 4+ is forbidden');
}
function key(contractId, i) { assertBillableCycle(i); return `lushka:${contractId}:cycle:${i}`; }
function completeAdjustments(cycle) {
  if (cycle < 1 || cycle > 3) throw new Error('Invalid Complete Recovery cycle');
  return cycle === 1 ? 6 : 5;
}

test('Complete Recovery: £108 less 25% = £81', () => {
  assert.equal(discountedMinor(10800, 25), 8100);
});

test('Serum Ritual: £35 less 20% = £28', () => {
  assert.equal(discountedMinor(3500, 20), 2800);
});

test('cycles 1-3 are billable', () => {
  [1,2,3].forEach(assertBillableCycle);
});

test('cycle 4 is blocked before API call', () => {
  assert.throws(() => assertBillableCycle(4), /cycle 4\+ is forbidden/);
});

test('billing idempotency key is deterministic', () => {
  assert.equal(key('gid://shopify/SubscriptionContract/123', 2), key('gid://shopify/SubscriptionContract/123', 2));
});

test('Complete Recovery has massager only on cycle 1', () => {
  assert.equal(completeAdjustments(1), 6);
  assert.equal(completeAdjustments(2), 5);
  assert.equal(completeAdjustments(3), 5);
});
