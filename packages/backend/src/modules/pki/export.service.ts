import { CryptoService } from '@/services/crypto.service.js';
import { createChildLogger } from '@/lib/logger.js';
import forge from 'node-forge';

const logger = createChildLogger('ExportService');

export class ExportService {
  constructor(private readonly cryptoService: CryptoService) {}

  exportPEM(certPem: string, chainPems?: string[]): string {
    const parts = [certPem.trim()];
    if (chainPems) {
      parts.push(...chainPems.map(p => p.trim()));
    }
    return parts.join('\n');
  }

  exportDER(certPem: string): Buffer {
    const base64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    return Buffer.from(base64, 'base64');
  }

  exportPKCS12(certPem: string, privateKeyPem: string, passphrase: string, chainPems?: string[]): Buffer {
    const cert = forge.pki.certificateFromPem(certPem);
    const key = forge.pki.privateKeyFromPem(privateKeyPem);
    const chain = chainPems?.map(p => forge.pki.certificateFromPem(p)) || [];

    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert, ...chain], passphrase, {
      algorithm: '3des',
      friendlyName: cert.subject.getField('CN')?.value || 'certificate',
    });

    const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
    return Buffer.from(p12Der, 'binary');
  }

  exportJKS(certPem: string, privateKeyPem: string | null, passphrase: string, alias: string): Buffer {
    // JKS is Java-specific. Export as PKCS#12 which Java can import:
    // keytool -importkeystore -srckeystore file.p12 -srcstoretype PKCS12
    if (privateKeyPem) {
      return this.exportPKCS12(certPem, privateKeyPem, passphrase);
    }
    return this.exportDER(certPem);
  }

  exportCAKey(privateKeyPem: string, certPem: string, passphrase: string): Buffer {
    return this.exportPKCS12(certPem, privateKeyPem, passphrase);
  }
}
