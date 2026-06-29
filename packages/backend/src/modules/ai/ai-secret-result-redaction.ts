const ONE_TIME_SECRET_REDACTION = '[REDACTED_ONE_TIME_SECRET]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactOneTimeSecretToolResult(toolName: string, value: unknown): unknown {
  if (toolName !== 'manage_api_token' || !isRecord(value) || typeof value.token !== 'string') {
    return value;
  }

  return {
    ...value,
    token: ONE_TIME_SECRET_REDACTION,
    tokenRedacted: true,
  };
}

