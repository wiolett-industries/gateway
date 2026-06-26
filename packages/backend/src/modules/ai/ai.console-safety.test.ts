import { describe, expect, it } from 'vitest';
import { inspectConsoleCommand, normalizeConsoleCommand, parseConsoleCommandResult } from './ai.console-safety.js';

describe('AI console command safety', () => {
  it('normalizes argv commands and rejects invalid shapes', () => {
    expect(normalizeConsoleCommand(['sh', '-lc', 'echo ok'])).toEqual(['sh', '-lc', 'echo ok']);
    expect(() => normalizeConsoleCommand('echo ok')).toThrow('command must be an array of strings');
    expect(() => normalizeConsoleCommand([])).toThrow('command is required');
    expect(() => normalizeConsoleCommand(['sh', ''])).toThrow('command argument 1 must not be empty');
  });

  it('marks risky commands without blocking ordinary safe reads', () => {
    expect(inspectConsoleCommand(['ls', '-la', '/tmp'])).toMatchObject({ risky: false, blocked: false });
    expect(inspectConsoleCommand(['systemctl', 'restart', 'nginx'])).toMatchObject({ risky: true, blocked: false });
    expect(inspectConsoleCommand(['sh', '-lc', 'rm -rf /tmp/build-cache'])).toMatchObject({
      risky: true,
      blocked: false,
    });
  });

  it('hard-blocks catastrophic host or container breaking commands', () => {
    expect(inspectConsoleCommand(['rm', '-rf', '/'])).toMatchObject({ risky: true, blocked: true });
    expect(inspectConsoleCommand(['sh', '-lc', 'dd if=/dev/zero of=/dev/sda bs=1M'])).toMatchObject({
      risky: true,
      blocked: true,
    });
    expect(inspectConsoleCommand(['bash', '-lc', ':(){ :|:& };:'])).toMatchObject({ risky: true, blocked: true });
  });

  it('parses daemon command results defensively', () => {
    expect(parseConsoleCommandResult(JSON.stringify({ stdout: 'ok', stderr: 'warn', exitCode: 0 }))).toEqual({
      stdout: 'ok',
      stderr: 'warn',
      exitCode: 0,
      truncated: false,
    });
    expect(parseConsoleCommandResult('raw output')).toEqual({ stdout: 'raw output' });
  });
});
