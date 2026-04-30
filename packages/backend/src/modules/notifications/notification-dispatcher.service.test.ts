import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchWithPinnedAddress } from './notification-dispatcher.service.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
});

describe('fetchWithPinnedAddress', () => {
  it('connects to the validated address while preserving the original host header', async () => {
    let receivedHost = '';
    let receivedBody = '';

    server = createServer((req, res) => {
      receivedHost = req.headers.host ?? '';
      req.on('data', (chunk: Buffer) => {
        receivedBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server address');

    const response = await fetchWithPinnedAddress(`http://webhook.example.test:${address.port}/hook`, '127.0.0.1', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'payload',
      signal: new AbortController().signal,
    });

    await expect(response.text()).resolves.toBe('ok');
    expect(response.status).toBe(200);
    expect(receivedHost).toBe(`webhook.example.test:${address.port}`);
    expect(receivedBody).toBe('payload');
  });

  it('sets content length for string request bodies', async () => {
    let receivedContentLength = '';

    server = createServer((req, res) => {
      receivedContentLength = req.headers['content-length'] ?? '';
      req.resume();
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server address');

    await fetchWithPinnedAddress(`http://webhook.example.test:${address.port}/hook`, '127.0.0.1', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'payload',
      signal: new AbortController().signal,
    });

    expect(receivedContentLength).toBe('7');
  });
});
