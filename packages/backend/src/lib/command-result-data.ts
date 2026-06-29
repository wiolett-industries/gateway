export function commandResultDataToBuffer(data: unknown): Buffer {
  if (data == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'base64');
  return Buffer.alloc(0);
}
