export const LICENSE_SERVER_URL = 'https://gw-license-server.wiolett.net';
export const LICENSE_OFFLINE_GRACE_DAYS = 30;
export const LICENSE_HEARTBEAT_INTERVAL_MS = 12 * 60 * 60 * 1000;

export type LicenseTier = 'community' | 'homelab' | 'enterprise';

export type LicenseStatus =
  | 'community'
  | 'valid'
  | 'valid_with_warning'
  | 'unreachable_grace_expired'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'replaced';

export interface EncryptedLicenseKey {
  encryptedKey: string;
  encryptedDek: string;
}

export interface CachedLicenseState {
  status: Exclude<LicenseStatus, 'community'>;
  tier: Exclude<LicenseTier, 'community'> | null;
  licenseName: string | null;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  lastValidAt: string | null;
  activeInstallationId: string | null;
  activeInstallationName: string | null;
  errorMessage: string | null;
}

export interface LicenseStatusView {
  status: LicenseStatus;
  tier: LicenseTier;
  licensed: boolean;
  hasKey: boolean;
  keyLast4: string | null;
  licenseName: string | null;
  installationId: string;
  installationName: string;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  lastValidAt: string | null;
  graceUntil: string | null;
  activeInstallationId: string | null;
  activeInstallationName: string | null;
  errorMessage: string | null;
  serverUrl: string;
}

export interface LicenseServerResponse {
  status: 'valid' | 'invalid' | 'expired' | 'revoked' | 'replaced';
  tier?: 'homelab' | 'enterprise';
  licenseName?: string;
  expiresAt?: string | null;
  activeInstallationId?: string;
  activeInstallationName?: string;
  activatedAt?: string | null;
  lastHeartbeatAt?: string | null;
  replacedAt?: string | null;
  message?: string;
}
