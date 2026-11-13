import assert from 'node:assert/strict';
import test from 'node:test';
import { getRequestErrorResponse } from '../middleware/error-handler.js';

test('invalid request bodies return an actionable client error', () => {
  assert.deepEqual(
    getRequestErrorResponse({ type: 'entity.parse.failed', message: 'Unexpected token' }),
    { status: 400, message: 'The request contains invalid JSON. Please check the submitted data.' },
  );
  assert.equal(getRequestErrorResponse({ type: 'entity.too.large' }).status, 413);
});

test('disallowed origins receive a clear forbidden response', () => {
  assert.deepEqual(
    getRequestErrorResponse(new Error('Origin is not allowed by CORS')),
    { status: 403, message: 'This website is not allowed to access the API.' },
  );
});

test('unexpected server errors do not expose internal messages', () => {
  assert.deepEqual(
    getRequestErrorResponse(new Error('private database connection detail')),
    { status: 500, message: 'The server encountered an unexpected error. Please try again later.' },
  );
});
