import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('ConfigValidatorService');

export class ConfigValidatorService {
  /**
   * Directives that must never appear in user-supplied advanced config snippets.
   * Each entry is checked as a case-insensitive prefix of a trimmed line.
   */
  private static readonly FORBIDDEN_DIRECTIVES: readonly string[] = [
    'load_module',
    'lua_',
    'perl_',
    'include',
    'access_log',
    'error_log',
    'pid',
    'worker_processes',
    'daemon',
    'master_process',
    'env ',
    'ssl_certificate',
    'ssl_certificate_key',
    'proxy_pass',
    'root',
    'alias',
    'fastcgi_pass',
    'uwsgi_pass',
    'scgi_pass',
    'grpc_pass',
    'internal',
    'satisfy',
    'auth_basic_user_file',
    'content_by_lua',
  ];

  /**
   * Validate a raw Nginx config snippet for safety.
   *
   * Checks performed:
   * 1. No null bytes
   * 2. No forbidden / dangerous directives
   * 3. Balanced curly braces
   * 4. No excessively long lines (> 4096 chars)
   * 5. Maximum snippet length (64 KB)
   */
  validate(snippet: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Null byte check
    if (snippet.includes('\0')) {
      errors.push('Config snippet contains null bytes');
    }

    // 2. Maximum length check (64 KB)
    if (snippet.length > 65536) {
      errors.push('Config snippet exceeds maximum length of 64 KB');
    }

    // 3. Forbidden directives
    const lines = snippet.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim().toLowerCase();

      // Skip comments and empty lines
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      for (const directive of ConfigValidatorService.FORBIDDEN_DIRECTIVES) {
        if (trimmed.startsWith(directive.toLowerCase())) {
          errors.push(`Forbidden directive "${directive.trim()}" found on line ${i + 1}`);
        }
      }

      // 4. Excessively long line
      if (lines[i].length > 4096) {
        errors.push(`Line ${i + 1} exceeds maximum length of 4096 characters`);
      }
    }

    // 5. Balanced braces
    let braceDepth = 0;
    for (let i = 0; i < snippet.length; i++) {
      if (snippet[i] === '{') braceDepth++;
      if (snippet[i] === '}') braceDepth--;
      if (braceDepth < 0) {
        errors.push('Unbalanced curly braces: unexpected closing brace');
        break;
      }
    }
    if (braceDepth > 0) {
      errors.push('Unbalanced curly braces: missing closing brace(s)');
    }

    if (errors.length > 0) {
      logger.debug('Config validation failed', { errorCount: errors.length, errors });
    }

    return { valid: errors.length === 0, errors };
  }
}
