import { describe, expect, it } from 'vitest';
import { FileBrowseSchema, FileMoveSchema, FileUploadCompleteSchema, FileUploadInitSchema } from './docker.schemas.js';

describe('docker file path schemas', () => {
  it('accepts absolute file paths with dots inside a filename', () => {
    expect(FileBrowseSchema.parse({ path: '/tmp/file..txt' })).toEqual({ path: '/tmp/file..txt' });
  });

  it('rejects relative paths and parent traversal segments', () => {
    for (const schema of [FileBrowseSchema, FileUploadInitSchema, FileUploadCompleteSchema]) {
      expect(schema.safeParse({ path: '../file.txt', totalBytes: 0 }).success).toBe(false);
      expect(schema.safeParse({ path: '/../file.txt', totalBytes: 0 }).success).toBe(false);
      expect(schema.safeParse({ path: '/nested/../file.txt', totalBytes: 0 }).success).toBe(false);
    }
  });

  it('rejects parent traversal in move paths', () => {
    expect(FileMoveSchema.safeParse({ fromPath: '/../file.txt', toPath: '/safe.txt' }).success).toBe(false);
    expect(FileMoveSchema.safeParse({ fromPath: '/safe.txt', toPath: '/nested/../file.txt' }).success).toBe(false);
  });
});
