const POSTGRES_RESULT_MAX_BYTES = 512 * 1024;
export const REDIS_COMMAND_MAX_BYTES = 256 * 1024;
const REDIS_COMMAND_MAX_ITEMS = 500;

export function truncateUtf8(value: string, maxBytes: number) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return { value, truncated: false };
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { value: value.slice(0, low), truncated: true };
}

function stringifyForPreview(value: unknown) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function estimateJsonBytes(value: unknown) {
  return Buffer.byteLength(stringifyForPreview(value), 'utf8');
}

export function compactCommandResult(value: unknown): { result: unknown; truncated: boolean } {
  let result = value;
  let truncated = false;
  if (Array.isArray(result) && result.length > REDIS_COMMAND_MAX_ITEMS) {
    result = result.slice(0, REDIS_COMMAND_MAX_ITEMS);
    truncated = true;
  }
  if (estimateJsonBytes(result) > REDIS_COMMAND_MAX_BYTES) {
    const preview = truncateUtf8(stringifyForPreview(result), REDIS_COMMAND_MAX_BYTES);
    result = {
      preview: preview.value,
      truncated: true,
    };
    truncated = true;
  }
  return { result, truncated };
}

export function compactForJsonBudget(
  value: unknown,
  maxBytes: number,
  depth = 0
): { value: unknown; truncated: boolean } {
  if (maxBytes <= 0) return { value: null, truncated: true };
  if (estimateJsonBytes(value) <= maxBytes) return { value, truncated: false };
  if (typeof value === 'string') return truncateUtf8(value, maxBytes);
  if (depth >= 4 || value == null || typeof value !== 'object') {
    const preview = truncateUtf8(stringifyForPreview(value), maxBytes);
    return { value: { preview: preview.value, truncated: true }, truncated: true };
  }
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (const item of value) {
      const remaining = maxBytes - estimateJsonBytes(output) - 2;
      if (remaining <= 0) {
        break;
      }
      const compact = compactForJsonBudget(item, remaining, depth + 1);
      output.push(compact.value);
      if (estimateJsonBytes(output) > maxBytes) {
        output.pop();
        break;
      }
    }
    return { value: output, truncated: true };
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const remaining = maxBytes - estimateJsonBytes(output) - Buffer.byteLength(key, 'utf8') - 8;
    if (remaining <= 0) {
      break;
    }
    const compact = compactForJsonBudget(item, remaining, depth + 1);
    output[key] = compact.value;
    if (estimateJsonBytes(output) > maxBytes) {
      delete output[key];
      break;
    }
  }
  return { value: output, truncated: true };
}

export function compactPostgresRows(rows: Record<string, unknown>[], maxRows: number) {
  const output: Record<string, unknown>[] = [];
  let truncated = rows.length > maxRows;
  for (const row of rows.slice(0, maxRows)) {
    const remaining = POSTGRES_RESULT_MAX_BYTES - estimateJsonBytes(output) - 2;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const compact = compactForJsonBudget(row, remaining) as { value: Record<string, unknown>; truncated: boolean };
    output.push(compact.value);
    if (estimateJsonBytes(output) > POSTGRES_RESULT_MAX_BYTES) {
      output.pop();
      truncated = true;
      break;
    }
    truncated ||= compact.truncated;
  }
  return { rows: output, truncated };
}
