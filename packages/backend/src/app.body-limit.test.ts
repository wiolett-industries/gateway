import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ||= 'http://localhost/db';
  process.env.REDIS_URL ||= 'redis://localhost:6379';
  process.env.OIDC_ISSUER ||= 'http://localhost/oidc';
  process.env.OIDC_CLIENT_ID ||= 'test';
  process.env.OIDC_CLIENT_SECRET ||= 'test';
  process.env.OIDC_REDIRECT_URI ||= 'http://localhost/auth/callback';
  process.env.PKI_MASTER_KEY ||= '0000000000000000000000000000000000000000000000000000000000000000';
});

describe('request body limits', () => {
  async function expectPayloadTooLarge(path: string, method: string, body: string, contentType = 'application/json') {
    const { app } = createApp();
    const response = await app.request(path, {
      method,
      headers: {
        'content-type': contentType,
        'content-length': String(Buffer.byteLength(body)),
      },
      body,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  }

  it('rejects oversized OAuth token bodies before route parsing', async () => {
    const body = `grant_type=authorization_code&code=${'x'.repeat(40_000)}`;
    await expectPayloadTooLarge('/api/oauth/token', 'POST', body, 'application/x-www-form-urlencoded');
  });

  it('rejects oversized logging ingest bodies before route parsing', async () => {
    await expectPayloadTooLarge('/api/logging/ingest', 'POST', 'x'.repeat(1_100_000));
  });

  it('rejects oversized Docker file write bodies before route parsing', async () => {
    await expectPayloadTooLarge(
      '/api/docker/nodes/node-1/containers/container-1/files/write',
      'PUT',
      'x'.repeat(1_600_000)
    );
  });
});
