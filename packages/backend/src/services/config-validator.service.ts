import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('ConfigValidatorService');

type ConfigToken =
  | { type: 'statement'; text: string; line: number }
  | { type: 'blockOpen'; text: string; line: number }
  | { type: 'blockClose'; line: number };

export class ConfigValidatorService {
  private static readonly HANDLEBARS_EXPR_RE = /{{{[\s\S]*?}}}|{{[\s\S]*?}}/g;

  private static stripHandlebarsExpressions(snippet: string): string {
    return snippet.replace(ConfigValidatorService.HANDLEBARS_EXPR_RE, (match) =>
      match.replace(/[^\n]/g, ' ')
    );
  }

  /**
   * Directives that must never appear anywhere in user-supplied advanced config snippets.
   * Each entry is checked as a case-insensitive prefix of a trimmed line.
   */
  private static readonly ALWAYS_FORBIDDEN_DIRECTIVES: readonly string[] = [
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
    'internal',
    'satisfy',
    'auth_basic_user_file',
    'content_by_lua',
  ];

  /**
   * Directives that are forbidden only at the top level of the advanced snippet
   * (server scope). They are allowed inside custom non-root location blocks.
   */
  private static readonly TOP_LEVEL_FORBIDDEN_DIRECTIVES: readonly string[] = [
    'proxy_pass',
    'root',
    'alias',
    'fastcgi_pass',
    'uwsgi_pass',
    'scgi_pass',
    'grpc_pass',
  ];

  private static readonly LOCATION_OPEN_RE = /^location\b(?<rest>.*)$/i;

  private static readonly ROOT_LOCATION_PATTERNS: readonly RegExp[] = [
    /^\/$/,
    /^=\s*\/$/,
    /^\^~\s*\/$/,
  ];

  private static isRootLocation(rest: string): boolean {
    const normalized = rest.trim().replace(/\s+/g, ' ');
    return ConfigValidatorService.ROOT_LOCATION_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  private static tokenize(snippet: string): ConfigToken[] {
    const tokens: ConfigToken[] = [];
    let buffer = '';
    let line = 1;
    let tokenLine = 1;
    let inComment = false;
    let quote: '"' | "'" | null = null;

    const flushBuffer = (type: 'statement' | 'blockOpen') => {
      const text = buffer.trim();
      if (text !== '') {
        tokens.push({ type, text, line: tokenLine });
      }
      buffer = '';
    };

    const appendChar = (char: string) => {
      if (buffer === '') {
        tokenLine = line;
      }
      buffer += char;
    };

    for (let i = 0; i < snippet.length; i++) {
      const char = snippet[i];

      if (inComment) {
        if (char === '\n') {
          inComment = false;
          line++;
        }
        continue;
      }

      if (quote) {
        appendChar(char);
        if (char === quote && snippet[i - 1] !== '\\') {
          quote = null;
        }
        continue;
      }

      if (char === '#') {
        inComment = true;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        appendChar(char);
        continue;
      }

      if (char === ';') {
        flushBuffer('statement');
        continue;
      }

      if (char === '{') {
        flushBuffer('blockOpen');
        continue;
      }

      if (char === '}') {
        flushBuffer('statement');
        tokens.push({ type: 'blockClose', line });
        continue;
      }

      if (char === '\n') {
        if (buffer !== '' && !/\s$/.test(buffer)) {
          buffer += ' ';
        }
        line++;
        continue;
      }

      appendChar(char);
    }

    flushBuffer('statement');
    return tokens;
  }

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
  validate(snippet: string, rawMode = false): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const nginxSnippet = rawMode
      ? snippet
      : ConfigValidatorService.stripHandlebarsExpressions(snippet);

    // 1. Null byte check
    if (snippet.includes('\0')) {
      errors.push('Config snippet contains null bytes');
    }

    // 2. Maximum length check (64 KB for advanced, 256 KB for raw)
    const maxLen = rawMode ? 262144 : 65536;
    if (snippet.length > maxLen) {
      errors.push(`Config exceeds maximum length of ${maxLen / 1024} KB`);
    }

    // 3. Forbidden directives (skip in raw mode — user controls the entire config)
    const lines = snippet.split('\n');
    if (!rawMode) {
      const tokens = ConfigValidatorService.tokenize(nginxSnippet);
      const blockStack: Array<{ type: 'location'; root: boolean } | { type: 'other' }> = [];

      for (const token of tokens) {
        if (token.type === 'blockClose') {
          blockStack.pop();
          continue;
        }

        const trimmed = token.text.trim().toLowerCase();
        if (trimmed === '') {
          continue;
        }

        const isTopLevel = blockStack.length === 0;

        for (const directive of ConfigValidatorService.ALWAYS_FORBIDDEN_DIRECTIVES) {
          if (trimmed.startsWith(directive.toLowerCase())) {
            errors.push(`Forbidden directive "${directive.trim()}" found on line ${token.line}`);
          }
        }

        if (isTopLevel) {
          for (const directive of ConfigValidatorService.TOP_LEVEL_FORBIDDEN_DIRECTIVES) {
            if (trimmed.startsWith(directive.toLowerCase())) {
              errors.push(`Forbidden top-level directive "${directive.trim()}" found on line ${token.line}`);
            }
          }
        }

        if (token.type === 'blockOpen') {
          const locationMatch = trimmed.match(ConfigValidatorService.LOCATION_OPEN_RE);
          if (locationMatch?.groups?.rest) {
            const isRoot = ConfigValidatorService.isRootLocation(locationMatch.groups.rest);
            if (isTopLevel && isRoot) {
              errors.push(`Forbidden root location block found on line ${token.line}`);
            }
            blockStack.push({ type: 'location', root: isRoot });
          } else {
            blockStack.push({ type: 'other' });
          }
        }
      }
    }

    // 4. Excessively long line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 4096) {
        errors.push(`Line ${i + 1} exceeds maximum length of 4096 characters`);
      }
    }

    // 5. Balanced braces
    let braceDepth = 0;
    for (let i = 0; i < nginxSnippet.length; i++) {
      if (nginxSnippet[i] === '{') braceDepth++;
      if (nginxSnippet[i] === '}') braceDepth--;
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
