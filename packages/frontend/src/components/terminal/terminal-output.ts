const CLEAR_VIEWPORT = Uint8Array.from([0x1b, 0x5b, 0x48, 0x1b, 0x5b, 0x4a]);
const CLEAR_SCROLLBACK = Uint8Array.from([0x1b, 0x5b, 0x33, 0x4a]);

function matchesAt(data: Uint8Array, pattern: Uint8Array, offset: number): boolean {
  if (offset + pattern.length > data.length) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (data[offset + index] !== pattern[index]) return false;
  }
  return true;
}

function matchingPrefixSuffixLength(data: Uint8Array, pattern: Uint8Array): number {
  const maxLength = Math.min(data.length, pattern.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    let matches = true;
    for (let index = 0; index < length; index += 1) {
      if (data[data.length - length + index] !== pattern[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }
  return 0;
}

export class TerminalOutputNormalizer {
  private pending = new Uint8Array();

  push(chunk: Uint8Array): Uint8Array {
    const data = new Uint8Array(this.pending.length + chunk.length);
    data.set(this.pending);
    data.set(chunk, this.pending.length);

    const output: number[] = [];
    let offset = 0;
    while (offset <= data.length - CLEAR_VIEWPORT.length) {
      if (matchesAt(data, CLEAR_VIEWPORT, offset)) {
        output.push(...CLEAR_SCROLLBACK, ...CLEAR_VIEWPORT);
        offset += CLEAR_VIEWPORT.length;
      } else {
        output.push(data[offset]);
        offset += 1;
      }
    }

    const remainder = data.subarray(offset);
    const pendingLength = matchingPrefixSuffixLength(remainder, CLEAR_VIEWPORT);
    output.push(...remainder.subarray(0, remainder.length - pendingLength));
    this.pending = remainder.slice(remainder.length - pendingLength);

    return Uint8Array.from(output);
  }
}
