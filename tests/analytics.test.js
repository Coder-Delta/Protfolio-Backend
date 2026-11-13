import assert from 'node:assert/strict';
import test from 'node:test';
import { validationResult } from 'express-validator';
import { rangeFilter, sessionReferrerValidator } from '../routes/analytics.js';

test('custom analytics dates include the complete end date', () => {
  const range = rangeFilter({ query: { start: '2026-11-12', end: '2026-11-13' } });

  assert.equal(range.days, null);
  assert.equal(range.start.toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-14T00:00:00.000Z');
});

test('custom analytics dates reject impossible and reversed dates', () => {
  assert.equal(rangeFilter({ query: { start: '2026-02-30', end: '2026-03-01' } }).invalid, true);
  assert.equal(rangeFilter({ query: { start: '2026-11-14', end: '2026-11-13' } }).invalid, true);
});

test('analytics day filters use the supported range and default to 30 days', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const week = rangeFilter({ query: { days: '7' } }, now);
  const fallback = rangeFilter({ query: { days: '14' } }, now);

  assert.equal(week.days, 7);
  assert.equal(week.start.toISOString(), '2026-11-06T12:00:00.000Z');
  assert.equal(fallback.days, 30);
});

test('session validation accepts a missing referrer sent as null', async () => {
  const request = {
    body: { referrer: null },
    cookies: {},
    headers: {},
    params: {},
    query: {},
  };
  await sessionReferrerValidator.run(request);

  assert.equal(validationResult(request).isEmpty(), true);
});
