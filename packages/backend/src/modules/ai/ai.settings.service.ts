import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { settings } from '@/db/schema/settings.js';
import { isPrivateUrl } from '@/lib/utils.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { AIConfig, EncryptedValue, MaxTokensField, ReasoningEffort, WebSearchProvider } from './ai.types.js';

const AI_SETTINGS_DEFAULTS: Record<string, unknown> = {
  'ai:enabled': false,
  'ai:provider_url': '',
  'ai:api_key_encrypted': null,
  'ai:model': '',
  'ai:max_completion_tokens': 8192,
  'ai:max_tokens_field': 'max_completion_tokens',
  'ai:reasoning_effort': 'none',
  'ai:custom_system_prompt': '',
  'ai:rate_limit_max': 10,
  'ai:rate_limit_window_seconds': 60,
  'ai:max_tool_rounds': 10,
  'ai:disabled_tools': [],
  'ai:web_search_api_key_encrypted': null,
  'ai:web_search_provider': 'tavily',
  'ai:web_search_base_url': '',
};

export class AISettingsService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly cryptoService: CryptoService
  ) {}

  async getConfig(): Promise<AIConfig> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, settings.key)); // get all

    // Filter to ai: prefixed keys
    const aiRows = rows.filter((r) => r.key.startsWith('ai:'));
    const map = new Map(aiRows.map((r) => [r.key, r.value]));

    const getValue = <T>(key: string): T => {
      const val = map.get(key);
      return (val !== undefined ? val : AI_SETTINGS_DEFAULTS[key]) as T;
    };

    const webSearchEncrypted = getValue<EncryptedValue | null>('ai:web_search_api_key_encrypted');

    return {
      enabled: getValue<boolean>('ai:enabled'),
      providerUrl: getValue<string>('ai:provider_url'),
      model: getValue<string>('ai:model'),
      maxCompletionTokens: getValue<number>('ai:max_completion_tokens'),
      maxTokensField: getValue<MaxTokensField>('ai:max_tokens_field'),
      reasoningEffort: getValue<ReasoningEffort>('ai:reasoning_effort'),
      customSystemPrompt: getValue<string>('ai:custom_system_prompt'),
      rateLimitMax: getValue<number>('ai:rate_limit_max'),
      rateLimitWindowSeconds: getValue<number>('ai:rate_limit_window_seconds'),
      maxToolRounds: getValue<number>('ai:max_tool_rounds'),
      disabledTools: getValue<string[]>('ai:disabled_tools'),
      webSearchProvider: getValue<WebSearchProvider>('ai:web_search_provider'),
      webSearchBaseUrl: getValue<string>('ai:web_search_base_url'),
      webSearchEnabled:
        getValue<WebSearchProvider>('ai:web_search_provider') === 'searxng'
          ? !!getValue<string>('ai:web_search_base_url')
          : !!webSearchEncrypted,
    };
  }

  /**
   * Returns the config with masked API key info for admin display.
   */
  async getConfigForAdmin(): Promise<AIConfig & { hasApiKey: boolean; apiKeyLast4: string; hasWebSearchKey: boolean }> {
    const config = await this.getConfig();
    const encrypted = await this.getSetting<EncryptedValue | null>('ai:api_key_encrypted');
    const webSearchEncrypted = await this.getSetting<EncryptedValue | null>('ai:web_search_api_key_encrypted');

    let apiKeyLast4 = '';
    if (encrypted) {
      try {
        const key = this.cryptoService.decryptString(encrypted);
        apiKeyLast4 = key.slice(-4);
      } catch {
        // corrupted key
      }
    }

    return {
      ...config,
      hasApiKey: !!encrypted,
      apiKeyLast4,
      hasWebSearchKey: !!webSearchEncrypted,
    };
  }

  async updateConfig(updates: Record<string, unknown>): Promise<AIConfig> {
    const keyMap: Record<string, string> = {
      enabled: 'ai:enabled',
      providerUrl: 'ai:provider_url',
      model: 'ai:model',
      customSystemPrompt: 'ai:custom_system_prompt',
      rateLimitMax: 'ai:rate_limit_max',
      rateLimitWindowSeconds: 'ai:rate_limit_window_seconds',
      maxToolRounds: 'ai:max_tool_rounds',
      maxCompletionTokens: 'ai:max_completion_tokens',
      maxTokensField: 'ai:max_tokens_field',
      reasoningEffort: 'ai:reasoning_effort',
      disabledTools: 'ai:disabled_tools',
      webSearchProvider: 'ai:web_search_provider',
      webSearchBaseUrl: 'ai:web_search_base_url',
    };

    for (const [field, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      // Block private/internal URLs for SSRF prevention
      if ((field === 'providerUrl' || field === 'webSearchBaseUrl') && typeof value === 'string' && value !== '') {
        if (isPrivateUrl(value)) {
          throw new Error(`${field} cannot point to a private or internal address`);
        }
      }

      // Handle API key encryption
      if (field === 'apiKey') {
        const plainKey = value as string;
        if (plainKey === '') {
          await this.setSetting('ai:api_key_encrypted', null);
        } else {
          const encrypted = this.cryptoService.encryptString(plainKey);
          await this.setSetting('ai:api_key_encrypted', encrypted);
        }
        continue;
      }

      // Handle web search API key encryption
      if (field === 'webSearchApiKey') {
        const plainKey = value as string;
        if (plainKey === '') {
          await this.setSetting('ai:web_search_api_key_encrypted', null);
        } else {
          const encrypted = this.cryptoService.encryptString(plainKey);
          await this.setSetting('ai:web_search_api_key_encrypted', encrypted);
        }
        continue;
      }

      const settingsKey = keyMap[field];
      if (settingsKey) {
        await this.setSetting(settingsKey, value);
      }
    }

    return this.getConfig();
  }

  async isEnabled(): Promise<boolean> {
    const val = await this.getSetting<boolean>('ai:enabled');
    if (!val) return false;
    // Also require API key to be configured
    const apiKey = await this.getSetting<EncryptedValue | null>('ai:api_key_encrypted');
    return !!apiKey;
  }

  async getDecryptedApiKey(): Promise<string | null> {
    const encrypted = await this.getSetting<EncryptedValue | null>('ai:api_key_encrypted');
    if (!encrypted) return null;
    try {
      return this.cryptoService.decryptString(encrypted);
    } catch {
      return null;
    }
  }

  async getDecryptedWebSearchKey(): Promise<string | null> {
    const encrypted = await this.getSetting<EncryptedValue | null>('ai:web_search_api_key_encrypted');
    if (!encrypted) return null;
    try {
      return this.cryptoService.decryptString(encrypted);
    } catch {
      return null;
    }
  }

  // ── Internal helpers ──

  private async getSetting<T>(key: string): Promise<T> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return (row?.value !== undefined ? row.value : AI_SETTINGS_DEFAULTS[key]) as T;
  }

  private async setSetting(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
