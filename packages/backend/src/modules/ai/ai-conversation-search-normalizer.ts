const MAX_TOKEN_LENGTH = 128;
const MAX_TOKENS = 256;

export interface NormalizedSearchText {
  normalizedText: string;
  tokens: string[];
}

export function normalizeSearchText(input: string): NormalizedSearchText {
  const normalizedText = replaceControlCharacters(input)
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[._/:#\\|()[\]{}<>,;!?'"`~+=*&^%$@]+/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const tokens = dedupeTokens(
    normalizedText
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 0 && token.length <= MAX_TOKEN_LENGTH)
  );

  return {
    normalizedText,
    tokens,
  };
}

export function tokenizeSearchQuery(query: string): string[] {
  return normalizeSearchText(query).tokens;
}

export function relaxedTokenWindows(tokens: string[]): string[][] {
  const unique = dedupeTokens(tokens);
  const windows: string[][] = [];
  if (unique.length === 0) return windows;
  windows.push(unique);
  if (unique.length > 1) windows.push(unique.slice(0, -1));
  if (unique.length > 2) windows.push(unique.slice(0, -2));
  if (unique.length >= 4) {
    for (let size = Math.min(4, unique.length); size >= 2; size -= 1) {
      for (let start = 0; start + size <= unique.length; start += 1) {
        windows.push(unique.slice(start, start + size));
      }
    }
  }
  return uniqueWindows(windows);
}

export function trigramSimilarity(left: string, right: string): number {
  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return 0;
  let intersection = 0;
  for (const trigram of leftTrigrams) {
    if (rightTrigrams.has(trigram)) intersection += 1;
  }
  return (2 * intersection) / (leftTrigrams.size + rightTrigrams.size);
}

function dedupeTokens(tokens: string[]): string[] {
  return [...new Set(tokens)].slice(0, MAX_TOKENS);
}

function replaceControlCharacters(input: string): string {
  let result = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0) ?? 0;
    result += codePoint < 32 || codePoint === 127 ? ' ' : char;
  }
  return result;
}

function uniqueWindows(windows: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const window of windows) {
    const key = window.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(window);
  }
  return result;
}

function trigrams(input: string): Set<string> {
  const normalized = normalizeSearchText(input).normalizedText;
  if (!normalized) return new Set();
  const padded = `  ${normalized}  `;
  const result = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}
