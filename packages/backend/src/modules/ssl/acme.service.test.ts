import { describe, expect, it } from 'vitest';
import { dns01RecordNameForDomain } from './acme.service.js';

describe('dns01RecordNameForDomain', () => {
  it('builds the expected ACME TXT name for normal domains', () => {
    expect(dns01RecordNameForDomain('app.example.com')).toBe('_acme-challenge.app.example.com');
  });

  it('removes wildcard prefixes before building the ACME TXT name', () => {
    expect(dns01RecordNameForDomain('*.example.com')).toBe('_acme-challenge.example.com');
  });
});
