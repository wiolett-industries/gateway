import { beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '@/services/crypto.service.js';
import { ExportService } from './export.service.js';

describe('ExportService', () => {
  let exportService: ExportService;
  let cryptoService: CryptoService;

  beforeAll(() => {
    cryptoService = new CryptoService('a'.repeat(64));
    exportService = new ExportService(cryptoService);
  });

  describe('exportPEM', () => {
    it('should return trimmed PEM certificate', () => {
      const certPem = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n';
      const result = exportService.exportPEM(certPem);
      expect(result).toBe(certPem.trim());
    });

    it('should concatenate chain PEMs', () => {
      const certPem = '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----';
      const chain = [
        '-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----',
        '-----BEGIN CERTIFICATE-----\nroot\n-----END CERTIFICATE-----',
      ];

      const result = exportService.exportPEM(certPem, chain);
      expect(result).toContain('leaf');
      expect(result).toContain('intermediate');
      expect(result).toContain('root');
      // Verify order: leaf first, then chain
      const leafIdx = result.indexOf('leaf');
      const intIdx = result.indexOf('intermediate');
      const rootIdx = result.indexOf('root');
      expect(leafIdx).toBeLessThan(intIdx);
      expect(intIdx).toBeLessThan(rootIdx);
    });
  });

  describe('exportDER', () => {
    it('should convert PEM to DER Buffer', () => {
      // Simple base64 content
      const base64Content = Buffer.from('test certificate binary data').toString('base64');
      const certPem = `-----BEGIN CERTIFICATE-----\n${base64Content}\n-----END CERTIFICATE-----`;

      const der = exportService.exportDER(certPem);
      expect(Buffer.isBuffer(der)).toBe(true);
      expect(der.length).toBeGreaterThan(0);

      // Verify DER content matches the base64
      expect(der.toString()).toBe('test certificate binary data');
    });

    it('should handle multi-line PEM', () => {
      const data = 'A'.repeat(100);
      const base64 = Buffer.from(data).toString('base64');
      // Split into 64-char lines like real PEM
      const lines = base64.match(/.{1,64}/g)?.join('\n') || base64;
      const certPem = `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;

      const der = exportService.exportDER(certPem);
      expect(der.toString()).toBe(data);
    });
  });
});
