import { describe, expect, it, vi } from 'vitest';
import { listNodeFiles, readNodeFile, writeNodeFile } from './node-file-operations.js';

function createContext(dispatchResult: unknown) {
  const nodeDispatch = {
    sendNodeFileCommand: vi.fn().mockResolvedValue(dispatchResult),
  };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: vi.fn() };
  const parseResult = vi.fn((result: { success: boolean; error?: string; detail?: string }) => {
    if (!result.success) throw new Error(result.error ?? 'Command failed on daemon');
    return result.detail ? JSON.parse(result.detail) : null;
  });

  return {
    context: { nodeDispatch, auditService, eventBus, parseResult },
    nodeDispatch,
    auditService,
    eventBus,
    parseResult,
  };
}

describe('node file operations', () => {
  it('lists node root files from daemon detail payload', async () => {
    const entries = [
      { name: 'etc', isDir: true, size: 4096, permissions: 'drwxr-xr-x', modified: 'Jun 23 12:00' },
      { name: 'var', isDir: true, size: 4096, permissions: 'drwxr-xr-x', modified: 'Jun 23 12:00' },
    ];
    const { context, nodeDispatch } = createContext({
      success: true,
      detail: JSON.stringify(entries),
    });

    await expect(listNodeFiles(context as never, 'node-1', '/')).resolves.toEqual(entries);
    expect(nodeDispatch.sendNodeFileCommand).toHaveBeenCalledWith('node-1', 'list', { path: '/' });
  });

  it('reads node files from binary daemon payload, including empty files', async () => {
    const { context, nodeDispatch } = createContext({
      success: true,
      data: Buffer.alloc(0),
    });

    await expect(readNodeFile(context as never, 'node-1', '/tmp/empty.txt')).resolves.toEqual(Buffer.alloc(0));
    expect(nodeDispatch.sendNodeFileCommand).toHaveBeenCalledWith('node-1', 'read', {
      path: '/tmp/empty.txt',
      maxBytes: 104857600,
    });
  });

  it('decodes protobuf bytes strings when reading node files', async () => {
    const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const { context } = createContext({
      success: true,
      data: jpgHeader.toString('base64'),
    });

    await expect(readNodeFile(context as never, 'node-1', '/tmp/image.jpg')).resolves.toEqual(jpgHeader);
  });

  it('passes node file writes through as binary content and emits update events', async () => {
    const { context, nodeDispatch, auditService, eventBus } = createContext({ success: true });
    const content = Buffer.from('hello');

    await writeNodeFile(context as never, 'node-1', '/tmp/hello.txt', content, 'user-1');

    expect(nodeDispatch.sendNodeFileCommand).toHaveBeenCalledWith('node-1', 'write', {
      path: '/tmp/hello.txt',
      content,
    });
    expect(auditService.log).toHaveBeenCalledWith({
      action: 'node.file.write',
      userId: 'user-1',
      resourceType: 'node',
      resourceId: 'node-1',
      details: { path: '/tmp/hello.txt' },
    });
    expect(eventBus.publish).toHaveBeenCalledWith('node.file.changed', {
      nodeId: 'node-1',
      action: 'updated',
      path: '/tmp/hello.txt',
      kind: 'file',
      parentPath: '/tmp',
      fromParentPath: undefined,
      toParentPath: undefined,
    });
  });
});
