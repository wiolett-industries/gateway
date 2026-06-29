import { describe, expect, it } from 'vitest';
import { commandResultDataToBuffer } from './command-result-data.js';

describe('commandResultDataToBuffer', () => {
  it('keeps binary gRPC bytes as Buffer without conversion', () => {
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    expect(commandResultDataToBuffer(data)).toBe(data);
  });

  it('normalizes alternate protobuf bytes representations', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    expect(commandResultDataToBuffer(new Uint8Array(bytes))).toEqual(bytes);
    expect(commandResultDataToBuffer([...bytes])).toEqual(bytes);
    expect(commandResultDataToBuffer(bytes.toString('base64'))).toEqual(bytes);
  });
});
