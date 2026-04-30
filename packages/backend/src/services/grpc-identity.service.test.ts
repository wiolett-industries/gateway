import { describe, expect, it } from 'vitest';
import { GrpcIdentityService } from './grpc-identity.service.js';

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDDzCCAfegAwIBAgIUPJ9QZSZ8RsM7j4S1caOkw6l2moUwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMZ2F0ZXdheS10ZXN0MB4XDTI2MDQzMDIyMDkxMVoXDTI2
MDUwMTIyMDkxMVowFzEVMBMGA1UEAwwMZ2F0ZXdheS10ZXN0MIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEArelepQmlcdBvUBF2jiNGYQqdNR0xNUevpVOD
cefWwKUsUzjbYtXaJV1cPM6icSgVih2AWvdqjlshPwP/0vhVdag2NAs1wiQbAVz5
wZlzWB+5nBDoCPviyqgminQpfQoW3iy6N//jgyTsRZ5rVhGrU9keiO/oZMElKnGk
jI6ulQnnOOxGQFeQQ7CGb3SKMA2RVGV2/8Mw8BiMeqlx0o1JG4gzHrIGcXuW1SJn
jZk0R67d8NbQeb6NzNaTDjCQn4bqt6nWK5eG1juzOeWvCmxD8DMXAHOM9/Ae6ZEn
rv+55CqRJKpP0eJPttkzGv7KU0n5VOclwlUjL/Rty/MFTvu0xQIDAQABo1MwUTAd
BgNVHQ4EFgQUP5K56xgR96eU6esZDGEij/6UBDYwHwYDVR0jBBgwFoAUP5K56xgR
96eU6esZDGEij/6UBDYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOC
AQEASzhOsntwv7NsZ69mt3MmU351nV247loOb90kZq4vlwd2Msnf3c4ygUlp61qp
kffbZ/11Xu/jiUI3tbNDGn9X3UigZuOTPRuwN3LIDlPmW+8j7s+IKgwqWakSYbtF
DlcImTDsru1Ie5MpS0zddFjTHwRaLi1R49JpQmGSB625oqs/hizZj+IwsXUvccWb
MHXr0RLyciF6ZNhxUsaNpieDvnlAohnChkMhRF9Wq31QIAtZZtnQDqRzw3uVvV4t
xCpoMT/UAaLKU9twJ0mxAqrxb1eHj66tcC/GDTUIlghn5I42QxS2nE+/5/RHHSrc
oD3IhAwaI3ht9c+zdQt5HFAXSA==
-----END CERTIFICATE-----`;

describe('GrpcIdentityService', () => {
  it('formats the SHA-256 fingerprint of the leaf certificate DER', () => {
    expect(GrpcIdentityService.computeCertificateSha256(TEST_CERT_PEM)).toBe(
      'sha256:46efa7e585760db43184ef4b490741451dd3b62fe50de10e12cd465bf850d9b0'
    );
  });

  it('throws a descriptive error for invalid PEM content', () => {
    expect(() => GrpcIdentityService.computeCertificateSha256('not a certificate')).toThrow(
      'Invalid gRPC TLS certificate PEM'
    );
  });
});
