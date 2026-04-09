import crypto from 'node:crypto';
import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(crypto.webcrypto as any);

export { x509 };
