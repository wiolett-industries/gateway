import { describe, expect, it } from 'vitest';
import { isMinorCompatible } from './semver.js';

describe('isMinorCompatible', () => {
  it('treats patch differences within the same minor as compatible', () => {
    expect(isMinorCompatible('2.2.3', '2.2.0')).toBe(true);
  });

  it('treats versions one minor apart as compatible', () => {
    expect(isMinorCompatible('2.2.3', '2.1.6')).toBe(true);
    expect(isMinorCompatible('2.2.3', '2.3.0')).toBe(true);
  });

  it('treats versions two or more minors apart as incompatible', () => {
    expect(isMinorCompatible('2.2.3', '2.0.9')).toBe(false);
    expect(isMinorCompatible('2.2.3', '2.4.0')).toBe(false);
  });

  it('treats different major versions as incompatible', () => {
    expect(isMinorCompatible('2.2.3', '3.2.3')).toBe(false);
  });

  it('treats dev or unparsable versions as compatible', () => {
    expect(isMinorCompatible('dev', '2.2.3')).toBe(true);
    expect(isMinorCompatible('2.2.3', 'main')).toBe(true);
  });
});
