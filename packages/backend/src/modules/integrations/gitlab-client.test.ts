import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GitLabClient } from './gitlab-client.js';

const servers: http.Server[] = [];

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a port');
  return `http://127.0.0.1:${address.port}`;
}

describe('GitLabClient', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('downloads binary responses without using fetch when no fetch override is injected', async () => {
    const baseUrl = await listen((request, response) => {
      expect(request.url).toBe('/api/v4/projects/28/repository/archive.tar.gz?sha=main');
      expect(request.headers['private-token']).toBe('glpat-token');
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.from([0x1f, 0x8b, 0x08]));
    });

    const client = new GitLabClient(baseUrl, 'glpat-token');
    const archive = await client.requestBuffer('/projects/28/repository/archive.tar.gz', {
      query: { sha: 'main' },
      maxBytes: 1024,
    });

    expect(archive).toEqual({
      buffer: Buffer.from([0x1f, 0x8b, 0x08]),
      contentType: 'application/octet-stream',
    });
  });
});
