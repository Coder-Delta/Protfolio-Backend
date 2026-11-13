import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminToken, requireAdmin, verifyAdminToken } from '../middleware/admin-auth.js';

test('admin tokens are signed, expire, and reject tampering', () => {
  const previousSecret = process.env.ANALYTICS_ADMIN_TOKEN_SECRET;
  const previousPassword = process.env.ANALYTICS_ADMIN_PASSWORD;
  process.env.ANALYTICS_ADMIN_TOKEN_SECRET = 'test-secret';
  delete process.env.ANALYTICS_ADMIN_PASSWORD;

  try {
    const now = 1_800_000_000_000;
    const token = createAdminToken(now);

    assert.equal(verifyAdminToken(token, now), true);
    assert.equal(verifyAdminToken(token, now + 8 * 60 * 60 * 1000), false);
    assert.equal(verifyAdminToken(`${token}x`, now), false);
    assert.equal(verifyAdminToken('invalid.token', now), false);
  } finally {
    if (previousSecret === undefined) delete process.env.ANALYTICS_ADMIN_TOKEN_SECRET;
    else process.env.ANALYTICS_ADMIN_TOKEN_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.ANALYTICS_ADMIN_PASSWORD;
    else process.env.ANALYTICS_ADMIN_PASSWORD = previousPassword;
  }
});

test('admin middleware blocks missing tokens and accepts a valid bearer token', () => {
  const previousSecret = process.env.ANALYTICS_ADMIN_TOKEN_SECRET;
  process.env.ANALYTICS_ADMIN_TOKEN_SECRET = 'test-secret';
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let continued = false;

  try {
    requireAdmin({ get: () => undefined }, response, () => { continued = true; });
    assert.equal(response.statusCode, 401);
    assert.equal(continued, false);

    const token = createAdminToken();
    requireAdmin({ get: () => `Bearer ${token}` }, response, () => { continued = true; });
    assert.equal(continued, true);
  } finally {
    if (previousSecret === undefined) delete process.env.ANALYTICS_ADMIN_TOKEN_SECRET;
    else process.env.ANALYTICS_ADMIN_TOKEN_SECRET = previousSecret;
  }
});
