import { describe, expect, it } from 'vitest';
import { ConfigValidatorService } from './config-validator.service.js';

describe('ConfigValidatorService', () => {
  const service = new ConfigValidatorService();

  it('rejects top-level upstream directives in advanced mode', () => {
    const result = service.validate(
      `
proxy_pass http://127.0.0.1:3000;
`.trim()
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Forbidden top-level directive "proxy_pass" found on line 1');
  });

  it('allows upstream directives inside custom non-root location blocks', () => {
    const result = service.validate(
      `
location /api/ {
  proxy_pass http://127.0.0.1:3000/api/;
  proxy_http_version 1.1;
}
`.trim()
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('allows inline custom non-root location blocks', () => {
    const result = service.validate(
      'location /api/ { proxy_http_version 1.1; proxy_pass http://127.0.0.1:3000/api/; }'
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects forbidden directives even when chained after safe directives on one line', () => {
    const result = service.validate('proxy_http_version 1.1; proxy_pass http://127.0.0.1:3000;');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Forbidden top-level directive "proxy_pass" found on line 1');
  });

  it('rejects custom root location blocks', () => {
    const result = service.validate(
      `
location / {
  proxy_pass http://127.0.0.1:3000;
}
`.trim()
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Forbidden root location block found on line 1');
  });

  it('keeps dangerous directives blocked even inside nested blocks', () => {
    const result = service.validate(
      `
location /api/ {
  include /etc/nginx/conf.d/shared.conf;
}
`.trim()
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Forbidden directive "include" found on line 2');
  });

  it('skips directive blacklist in raw mode', () => {
    const result = service.validate(
      `
location / {
  proxy_pass http://127.0.0.1:3000;
}
`.trim(),
      true
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
