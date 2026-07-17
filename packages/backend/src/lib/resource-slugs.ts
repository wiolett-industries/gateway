import { AppError } from '@/middleware/error-handler.js';

export const RESOURCE_SLUG_MAX_LENGTH = 60;
const RESOURCE_SLUG_MAX_ATTEMPTS = 10_000;

const CYRILLIC_CHARACTERS = [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюяіїєґў'];
const CYRILLIC_REPLACEMENTS = [
  'a',
  'b',
  'v',
  'g',
  'd',
  'e',
  'yo',
  'zh',
  'z',
  'i',
  'y',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'r',
  's',
  't',
  'u',
  'f',
  'kh',
  'ts',
  'ch',
  'sh',
  'shch',
  '',
  'y',
  '',
  'e',
  'yu',
  'ya',
  'i',
  'yi',
  'ye',
  'g',
  'u',
] as const;
const CYRILLIC = new Map(CYRILLIC_CHARACTERS.map((character, index) => [character, CYRILLIC_REPLACEMENTS[index]!]));
const EXTRA_LATIN = new Map<string, string>([
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['ø', 'o'],
  ['ł', 'l'],
  ['đ', 'd'],
  ['ð', 'd'],
  ['þ', 'th'],
  ['ħ', 'h'],
  ['ı', 'i'],
  ['ß', 'ss'],
]);

export interface ResourceSlugPolicy {
  fallback: string;
  reserved?: readonly string[];
  maxLength?: number;
}

export interface WriteWithAllocatedSlugOptions<T> extends ResourceSlugPolicy {
  source: string;
  constraint: string;
  write: (slug: string) => Promise<T>;
  maxAttempts?: number;
}

function transliterate(value: string): string {
  let result = '';
  for (const character of value.normalize('NFC').replaceAll('İ', 'I').toLowerCase()) {
    const cyrillic = CYRILLIC.get(character);
    if (cyrillic !== undefined) {
      result += cyrillic;
      continue;
    }
    for (const decomposed of character.normalize('NFKD')) {
      if (/^\p{Mark}$/u.test(decomposed)) continue;
      result += EXTRA_LATIN.get(decomposed) ?? decomposed;
    }
  }
  return result;
}

export function resourceSlugBase(source: string, fallback: string, maxLength = RESOURCE_SLUG_MAX_LENGTH): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new RangeError('Slug maxLength must be positive');
  const normalize = (value: string) =>
    transliterate(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/g, '');
  return normalize(source) || normalize(fallback) || 'resource'.slice(0, maxLength);
}

export function resourceSlugCandidate(
  base: string,
  collisionIndex: number,
  maxLength = RESOURCE_SLUG_MAX_LENGTH
): string {
  if (!Number.isInteger(collisionIndex) || collisionIndex < 0) throw new RangeError('Invalid collision index');
  const suffix = collisionIndex === 0 ? '' : `-${collisionIndex}`;
  const prefix = base.slice(0, maxLength - suffix.length).replace(/-+$/g, '');
  if (!prefix) throw new RangeError('Slug suffix exceeds maxLength');
  return `${prefix}${suffix}`;
}

export function firstResourceSlugCollisionIndex(base: string, reserved: readonly string[] = []): number {
  return reserved.includes(base) ? 1 : 0;
}

export function isMatchingUniqueConstraintViolation(error: unknown, constraint: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object' && !seen.has(current); depth += 1) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

export async function writeWithAllocatedSlug<T>(options: WriteWithAllocatedSlugOptions<T>): Promise<T> {
  const maxLength = options.maxLength ?? RESOURCE_SLUG_MAX_LENGTH;
  const base = resourceSlugBase(options.source, options.fallback, maxLength);
  const firstIndex = firstResourceSlugCollisionIndex(base, options.reserved);
  const maxAttempts = options.maxAttempts ?? RESOURCE_SLUG_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slug = resourceSlugCandidate(base, firstIndex + attempt, maxLength);
    try {
      return await options.write(slug);
    } catch (error) {
      if (!isMatchingUniqueConstraintViolation(error, options.constraint)) throw error;
    }
  }
  throw new AppError(409, 'SLUG_ALLOCATION_FAILED', 'Could not allocate a unique resource slug');
}
