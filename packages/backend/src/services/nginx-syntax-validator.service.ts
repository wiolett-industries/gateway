import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('NginxSyntaxValidator');

const CONFIG_WRAPPER = `worker_processes 1;
error_log /dev/null;
pid /tmp/nginx-test.pid;
events { worker_connections 1024; }
http {
%CONFIG%
}`;

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class NginxSyntaxValidatorService {
  private nginxBin: string | null = null;

  /** Check if nginx binary is available */
  async isAvailable(): Promise<boolean> {
    if (this.nginxBin) return true;
    try {
      const path = await this.findNginx();
      if (path) {
        this.nginxBin = path;
        return true;
      }
    } catch {
      // not available
    }
    return false;
  }

  /**
   * Validate a full server block (or entire http-level config) using nginx -t.
   * The config is wrapped in a minimal http {} skeleton.
   */
  async validate(config: string): Promise<ValidationResult> {
    if (!await this.isAvailable()) {
      // Fallback: can't validate syntax without nginx binary
      return { valid: true, errors: [] };
    }

    const dir = await mkdtemp(join(tmpdir(), 'nginx-validate-'));
    const confPath = join(dir, 'test.conf');

    try {
      const fullConfig = CONFIG_WRAPPER.replace('%CONFIG%', config);
      await writeFile(confPath, fullConfig, 'utf-8');

      const result = await this.runNginxTest(confPath);

      if (result.exitCode === 0) {
        return { valid: true, errors: [] };
      }

      // Parse errors — nginx outputs to stderr
      const errors = this.parseErrors(result.stderr, config);
      return { valid: false, errors };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Validate a full nginx.conf (no wrapper needed).
   */
  async validateFull(config: string): Promise<ValidationResult> {
    if (!await this.isAvailable()) {
      return { valid: true, errors: [] };
    }

    const dir = await mkdtemp(join(tmpdir(), 'nginx-validate-'));
    const confPath = join(dir, 'test.conf');

    try {
      await writeFile(confPath, config, 'utf-8');
      const result = await this.runNginxTest(confPath);

      if (result.exitCode === 0) {
        return { valid: true, errors: [] };
      }

      const errors = this.parseErrors(result.stderr, config, 0);
      return { valid: false, errors };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async runNginxTest(confPath: string): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        this.nginxBin!,
        ['-t', '-c', confPath],
        { timeout: 5000 },
        (error, _stdout, stderr) => {
          const exitCode = error && 'code' in error ? (error as any).code ?? 1 : error ? 1 : 0;
          resolve({ exitCode, stderr: stderr || '' });
        }
      );
    });
  }

  /**
   * Parse nginx -t stderr output into user-friendly errors.
   * Nginx reports line numbers relative to the full wrapped config,
   * so we adjust them to be relative to the user's config.
   */
  private parseErrors(stderr: string, _userConfig: string, lineOffset?: number): string[] {
    const wrapperLinesBefore = lineOffset ?? (CONFIG_WRAPPER.split('%CONFIG%')[0].split('\n').length - 1);
    logger.debug('nginx -t stderr', { stderr, wrapperLinesBefore });

    const errors: string[] = [];
    const lines = stderr.split('\n');

    for (const line of lines) {
      if (!line.includes('[emerg]') && !line.includes('[error]')) continue;

      // Extract line number from end: .../test.conf:42
      const lineNumMatch = line.match(/:(\d+)\s*$/);
      const rawLineNum = lineNumMatch ? Number.parseInt(lineNumMatch[1], 10) : null;

      // Extract message after [emerg] or [error]
      const msgMatch = line.match(/\[(?:emerg|error)\]\s*(.+)/);
      if (msgMatch) {
        // Remove the trailing "in /path:num" from the message
        const message = msgMatch[1].replace(/\s+in\s+\S+:\d+\s*$/, '').trim();

        if (rawLineNum !== null) {
          const userLine = rawLineNum - wrapperLinesBefore;
          if (userLine > 0) {
            errors.push(`${message} on line ${userLine}`);
          } else {
            errors.push(message);
          }
        } else {
          errors.push(message);
        }
      }
    }

    if (errors.length === 0) {
      // Check for actual failure indicators not caught by emerg/error parsing
      const remaining = stderr
        .split('\n')
        .filter((l) => l.trim())
        .filter((l) => !l.includes('syntax is ok'))
        .filter((l) => !l.includes('test is successful'))
        .filter((l) => !l.includes('[warn]'))
        .filter((l) => !l.includes('[notice]'));

      for (const line of remaining) {
        // Only include lines that look like actual errors
        if (line.includes('failed') || line.includes('invalid') || line.includes('unknown')) {
          errors.push(line.trim());
        }
      }
    }

    return errors;
  }

  private findNginx(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('which', ['nginx'], (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout.trim() || null);
        }
      });
    });
  }
}
