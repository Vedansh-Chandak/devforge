import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, multiply, divide } from '../src/math.js';

test('add should work', () => {
  assert.equal(add(2, 3), 5);
});

test('multiply should work - BROKEN', () => {
  // This test will fail because multiply has a bug (adds instead of multiplies)
  assert.equal(multiply(3, 4), 12);
});

test('divide should work', () => {
  assert.equal(divide(10, 2), 5);
});

test('divide by zero should throw', () => {
  assert.throws(() => divide(1, 0), /Division by zero/);
});