import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { settings } from '@/db/schema/index.js';

const SETTINGS_KEY = 'general:settings';
const BODY_LIMIT_OVERHEAD_RATIO = 1.5;
const BODY_LIMIT_OVERHEAD_BYTES = 4096;

export const FILE_UPLOAD_MIN_BYTES = 1 * 1024 * 1024;
export const FILE_UPLOAD_DEFAULT_BYTES = 100 * 1024 * 1024;
export const FILE_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

export interface GeneralSettings {
  fileUploadMaxBytes: number;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  fileUploadMaxBytes: FILE_UPLOAD_DEFAULT_BYTES,
};

export function fileUploadBodyLimitBytes(fileUploadMaxBytes: number): number {
  return Math.ceil(fileUploadMaxBytes * BODY_LIMIT_OVERHEAD_RATIO) + BODY_LIMIT_OVERHEAD_BYTES;
}

export class GeneralSettingsService {
  private cached: GeneralSettings | null = null;
  private cachedAt = 0;

  constructor(private readonly db: DrizzleClient) {}

  async getConfig(): Promise<GeneralSettings> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < 5000) return this.cached;

    const [row] = await this.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
    const config = this.normalize(row?.value);
    this.cached = config;
    this.cachedAt = now;
    return config;
  }

  async updateConfig(updates: Partial<GeneralSettings>): Promise<GeneralSettings> {
    const current = await this.getConfig();
    const next = this.normalize({ ...current, ...updates });
    await this.db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: next, updatedAt: new Date() },
      });
    this.cached = next;
    this.cachedAt = Date.now();
    return next;
  }

  async getFileUploadMaxBodyBytes(): Promise<number> {
    const config = await this.getConfig();
    return fileUploadBodyLimitBytes(config.fileUploadMaxBytes);
  }

  private normalize(value: unknown): GeneralSettings {
    const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const rawFileUploadMaxBytes = Number(record.fileUploadMaxBytes);
    const fileUploadMaxBytes = Number.isInteger(rawFileUploadMaxBytes)
      ? rawFileUploadMaxBytes
      : DEFAULT_GENERAL_SETTINGS.fileUploadMaxBytes;

    if (fileUploadMaxBytes < FILE_UPLOAD_MIN_BYTES || fileUploadMaxBytes > FILE_UPLOAD_MAX_BYTES) {
      throw new Error(`File upload limit must be between ${FILE_UPLOAD_MIN_BYTES} and ${FILE_UPLOAD_MAX_BYTES} bytes`);
    }

    return { fileUploadMaxBytes };
  }
}
