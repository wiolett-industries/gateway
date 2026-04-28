import type {
  LoggingFieldDefinition,
  LoggingMetadata,
  LoggingSearchExpression,
  LoggingSearchRequest,
  LoggingSeverity,
} from "@/types";

const SEVERITIES: LoggingSeverity[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const TIME_PRESETS = ["15m", "30m", "1h", "6h", "24h", "7d"];
type AttributeExpressionType = "service" | "source" | "traceId" | "spanId" | "requestId";

export interface LoggingQueryChip {
  key: string;
  label: string;
  tone: "default" | "muted" | "danger";
}

export interface LoggingQuerySuggestion {
  label: string;
  replacement: string;
  detail?: string;
  incomplete?: boolean;
  noSpace?: boolean;
}

export interface ParsedLoggingQuery {
  request: Pick<LoggingSearchRequest, "from" | "to" | "expression">;
  chips: LoggingQueryChip[];
  errors: string[];
  incomplete: boolean;
}

export function parseLoggingQuery(
  input: string,
  fieldDefinitions: LoggingFieldDefinition[]
): ParsedLoggingQuery {
  const tokens = tokenize(input);
  const chips: LoggingQueryChip[] = [];
  const errors: string[] = [];
  let incomplete = false;
  let timeRange: { from?: string; to?: string } = {};
  let index = 0;

  const parseOr = (): LoggingSearchExpression | null => {
    const children = compact([parseAnd()]);
    while (tokens[index] === "|") {
      index += 1;
      const right = parseAnd();
      if (right) children.push(right);
      else errors.push("Expected expression after |");
    }
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    return { type: "or", children };
  };

  const parseAnd = (): LoggingSearchExpression | null => {
    const children: LoggingSearchExpression[] = [];
    while (index < tokens.length && tokens[index] !== ")" && tokens[index] !== "|") {
      const child = parseUnary();
      if (child) children.push(child);
    }
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    return { type: "and", children };
  };

  const parseUnary = (): LoggingSearchExpression | null => {
    const token = tokens[index];
    if (!token) return null;
    if (token === "-") {
      index += 1;
      const child = parseUnary();
      return child ? { type: "not", child } : null;
    }
    if (token.startsWith("-") && token.length > 1) {
      index += 1;
      const child = parseAtom(token.slice(1));
      return child ? { type: "not", child } : null;
    }
    return parsePrimary();
  };

  const parsePrimary = (): LoggingSearchExpression | null => {
    const token = tokens[index];
    if (!token) return null;
    if (token === "(") {
      index += 1;
      const expression = parseOr();
      if (tokens[index] === ")") index += 1;
      else errors.push("Missing closing )");
      return expression;
    }
    index += 1;
    return parseAtom(token);
  };

  const parseAtom = (token: string): LoggingSearchExpression | null => {
    if (!token) return null;
    if (token.startsWith("@")) {
      const parsed = parseTimeToken(token.slice(1));
      if (parsed) {
        timeRange = parsed;
        chips.push({ key: token, label: token, tone: "muted" });
      } else errors.push(`Invalid time range: ${token}`);
      return null;
    }
    if (token.startsWith("+")) return parseLabelToken(token);
    if (token.startsWith("*")) return parseFieldToken(token);
    if (token.startsWith("!")) return parseSeverityToken(token);
    if (token.startsWith("^")) return parseValueToken(token, "service", "^");
    if (token.startsWith(">")) return parseValueToken(token, "source", ">");
    if (token.startsWith("$")) return parseValueToken(token, "traceId", "$");
    if (token.startsWith("#")) return parseValueToken(token, "spanId", "#");
    if (token.startsWith("%")) return parseValueToken(token, "requestId", "%");
    return parseTextToken(token);
  };

  const parseLabelToken = (token: string): LoggingSearchExpression | null => {
    const parsed = splitFilter(token.slice(1));
    if (!parsed.key) {
      errors.push(`Invalid label filter: ${token}`);
      return null;
    }
    chips.push({ key: token, label: token, tone: "default" });
    if (!parsed.op) return { type: "label", key: parsed.key, op: "exists" };
    if (parsed.op !== "=" && parsed.op !== "!=") {
      errors.push(`Invalid label operator: ${token}`);
      return null;
    }
    const op = parsed.op === "!=" ? "neq" : "eq";
    const values = splitValueList(parsed.value);
    if (values.length > 1) {
      return {
        type: "or",
        children: values.map((value) => ({ type: "label", key: parsed.key, op, value })),
      };
    }
    return { type: "label", key: parsed.key, op, value: parsed.value };
  };

  const parseFieldToken = (token: string): LoggingSearchExpression | null => {
    const parsed = splitFilter(token.slice(1));
    if (!parsed.key || !parsed.op) {
      errors.push(`Invalid field filter: ${token}`);
      return null;
    }
    chips.push({ key: token, label: token, tone: "default" });
    const op = operatorToRequestOp(parsed.op);
    if (!op) {
      errors.push(`Invalid field operator: ${token}`);
      return null;
    }
    const values = splitValueList(parsed.value);
    if (values.length > 1 && op === "eq") {
      return {
        type: "or",
        children: values.map((value) => ({
          type: "field",
          key: parsed.key,
          op,
          value: coerceFieldValue(parsed.key, value, fieldDefinitions),
        })),
      };
    }
    return {
      type: "field",
      key: parsed.key,
      op,
      value: coerceFieldValue(parsed.key, parsed.value, fieldDefinitions),
    };
  };

  const parseSeverityToken = (token: string): LoggingSearchExpression | null => {
    const body = token.slice(1);
    const parsed = splitComparator(body);
    const op = operatorToRequestOp(parsed.op || "=");
    if (!op || op === "neq" || op === "contains") {
      errors.push(`Invalid severity filter: ${token}`);
      return null;
    }
    const values = splitValueList(parsed.value);
    if (!parsed.value) {
      incomplete = true;
      chips.push({ key: token, label: token, tone: "muted" });
      return null;
    }
    const invalid = values.find((value) => !isSeverity(value));
    if (invalid) {
      errors.push(`Invalid severity: ${invalid}`);
      return null;
    }
    chips.push({ key: token, label: token, tone: "default" });
    if (values.length > 1) {
      return {
        type: "or",
        children: values.map((value) => ({
          type: "severity",
          op: "eq",
          value: value as LoggingSeverity,
        })),
      };
    }
    return { type: "severity", op, value: parsed.value as LoggingSeverity };
  };

  const parseValueToken = (
    token: string,
    type: AttributeExpressionType,
    prefix: string
  ): LoggingSearchExpression | null => {
    const body = token.slice(prefix.length);
    const values = splitValueList(body);
    if (!body) {
      errors.push(`Invalid filter: ${token}`);
      return null;
    }
    chips.push({ key: token, label: token, tone: "default" });
    if (values.length > 1) {
      return {
        type: "or",
        children: values.map((value) => ({ type, op: "eq", value })),
      };
    }
    return { type, op: "eq", value: body };
  };

  const parseTextToken = (token: string): LoggingSearchExpression | null => {
    let value = token;
    let match: "contains" | "startsWith" | "endsWith" = "contains";
    if (value.startsWith("~")) {
      value = value.slice(1);
      match = "startsWith";
    } else if (value.endsWith("~")) {
      value = value.slice(0, -1);
      match = "endsWith";
    }
    if (!value) return null;
    chips.push({ key: token, label: token, tone: "muted" });
    return { type: "text", value, match };
  };

  const expression = parseOr();
  if (index < tokens.length) errors.push(`Unexpected token: ${tokens[index]}`);

  return {
    request: {
      ...timeRange,
      ...(expression ? { expression } : {}),
    },
    chips: [
      ...chips,
      ...errors.map((error, errorIndex) => ({
        key: `error-${errorIndex}`,
        label: error,
        tone: "danger" as const,
      })),
    ],
    errors,
    incomplete,
  };
}

export function getLoggingQuerySuggestions(params: {
  input: string;
  cursor: number;
  metadata: LoggingMetadata | null;
  fieldDefinitions: LoggingFieldDefinition[];
}): LoggingQuerySuggestion[] {
  const token = currentToken(params.input, params.cursor);
  const value = token.value;
  const metadata = params.metadata;
  if (!value && isInSeverityGroup(params.input, params.cursor)) {
    return SEVERITIES.map((item) => ({
      label: item,
      replacement: item,
      detail: "severity",
      noSpace: true,
    }));
  }
  if (!value && shouldShowTopLevelSuggestions(params.input, params.cursor)) {
    return [
      { label: "+ label", replacement: "+", detail: "label", incomplete: true },
      { label: "* field", replacement: "*", detail: "field", incomplete: true },
      { label: "! severity", replacement: "!", detail: "severity", incomplete: true },
      { label: "^ service", replacement: "^", detail: "service", incomplete: true },
      { label: "> source", replacement: ">", detail: "source", incomplete: true },
      { label: "@ time", replacement: "@", detail: "time", incomplete: true },
    ];
  }
  if (!value) return [];
  if (value.startsWith("+")) {
    const [key, partialValue] = value.slice(1).split("=");
    if (partialValue !== undefined && key) {
      return (metadata?.labelValues[key] ?? [])
        .filter((item) => item.includes(partialValue))
        .slice(0, 8)
        .map((item) => ({
          label: item,
          replacement: `+${key}=${quoteIfNeeded(item)}`,
          detail: "label value",
        }));
    }
    return unique([
      ...(metadata?.labelKeys ?? []),
      ...params.fieldDefinitions
        .filter((field) => field.location === "label")
        .map((field) => field.key),
    ])
      .filter((item) => item.includes(key))
      .slice(0, 8)
      .map((item) => ({
        label: item,
        replacement: `+${item}=`,
        detail: "label",
        incomplete: true,
      }));
  }
  if (value.startsWith("*")) {
    const partial = value.slice(1);
    return unique([
      ...(metadata?.fieldKeys ?? []),
      ...params.fieldDefinitions
        .filter((field) => field.location === "field")
        .map((field) => field.key),
    ])
      .filter((item) => item.includes(partial))
      .slice(0, 8)
      .map((item) => ({
        label: item,
        replacement: `*${item}=`,
        detail: "field",
        incomplete: true,
      }));
  }
  if (value.startsWith("!")) {
    const comparator = value.slice(1).match(/^[<>]=?/)?.[0] ?? "";
    const partial = value.slice(1 + comparator.length);
    return SEVERITIES.filter((item) => item.includes(partial))
      .slice(0, 8)
      .map((item) => ({ label: item, replacement: `!${comparator}${item}`, detail: "severity" }));
  }
  if (value.startsWith("^")) {
    return (metadata?.services ?? [])
      .filter((item) => item.includes(value.slice(1)))
      .slice(0, 8)
      .map((item) => ({ label: item, replacement: `^${quoteIfNeeded(item)}`, detail: "service" }));
  }
  if (value.startsWith(">")) {
    return (metadata?.sources ?? [])
      .filter((item) => item.includes(value.slice(1)))
      .slice(0, 8)
      .map((item) => ({ label: item, replacement: `>${quoteIfNeeded(item)}`, detail: "source" }));
  }
  if (value.startsWith("@")) {
    return TIME_PRESETS.filter((item) => item.includes(value.slice(1))).map((item) => ({
      label: item,
      replacement: `@${item}`,
      detail: "time",
    }));
  }
  return [];
}

export function applyLoggingQuerySuggestion(
  input: string,
  cursor: number,
  replacement: string,
  options: { noSpace?: boolean } = {}
) {
  const token = currentToken(input, cursor);
  const isBarePrefix = /^[+*!^>$#%@]$/.test(replacement);
  const expectsValue = /^[+*][^=]+=$/.test(replacement);
  const suffix =
    options.noSpace ||
    isBarePrefix ||
    expectsValue ||
    (input[token.end] && !/\s/.test(input[token.end] ?? ""))
      ? ""
      : " ";
  const next = `${input.slice(0, token.start)}${replacement}${suffix}${input.slice(token.end)}`;
  return {
    value: next,
    cursor: token.start + replacement.length + suffix.length,
  };
}

export function applyLoggingStructuredBackspace(input: string, cursor: number) {
  const token = currentToken(input, cursor);
  if (token.start === token.end || cursor !== token.end) return null;
  const value = token.value;
  const replacement = structuredBackspaceReplacement(input, cursor, value);
  if (replacement === null) return null;

  const nextValue = `${input.slice(0, token.start)}${replacement}${input.slice(token.end)}`;
  const nextCursor = token.start + replacement.length;
  return {
    value: nextValue,
    cursor: nextCursor,
  };
}

function structuredBackspaceReplacement(input: string, cursor: number, value: string) {
  if (/^[+*][A-Za-z_][A-Za-z0-9_.-]*(=.*)?$/.test(value)) {
    const equalsIndex = value.indexOf("=");
    if (equalsIndex !== -1 && value.length > equalsIndex + 1)
      return value.slice(0, equalsIndex + 1);
    if (equalsIndex !== -1) return value[0]!;
    if (value.length > 1) return "";
    return null;
  }

  if (/^![<>]=?$/.test(value)) return "!";
  if (/^[!][<>]=?.+$/.test(value)) {
    const comparator = value.match(/^!([<>]=?)/)?.[1] ?? "";
    return comparator ? `!${comparator}` : "!";
  }
  if (/^[!^>$#%@].+$/.test(value)) return value[0]!;
  if (/^[!^>$#%@]$/.test(value)) return "";
  if (isInSeverityGroup(input, cursor) && value) return "";
  return null;
}

function isInSeverityGroup(input: string, cursor: number) {
  const before = input.slice(0, cursor);
  const openIndex = before.lastIndexOf("!(");
  if (openIndex === -1) return false;
  const afterOpen = before.slice(openIndex + 2);
  return !afterOpen.includes(")") && !/[\s(+*^>$#%@-]$/.test(afterOpen);
}

function shouldShowTopLevelSuggestions(input: string, cursor: number) {
  const before = input.slice(0, cursor);
  if (before.trim().length === 0) return true;
  return /[(|-]\s*$/.test(before);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let atomParenDepth = 0;
  const push = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (char === '"') {
      i += 1;
      while (i < input.length && input[i] !== '"') {
        current += input[i];
        i += 1;
      }
      continue;
    }
    if (/\s/.test(char) && atomParenDepth === 0) {
      push();
      continue;
    }
    if (char === "(") {
      if (current) {
        atomParenDepth += 1;
        current += char;
      } else tokens.push(char);
      continue;
    }
    if (char === ")") {
      if (atomParenDepth > 0) {
        atomParenDepth -= 1;
        current += char;
      } else {
        push();
        tokens.push(char);
      }
      continue;
    }
    if (char === "|" && atomParenDepth === 0) {
      push();
      tokens.push(char);
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

function splitFilter(value: string) {
  const match = value.match(/^([^!<>=]+)(!=|>=|<=|=|>|<)(.*)$/);
  if (!match) return { key: value, op: null, value: "" };
  return { key: match[1]!.trim(), op: match[2]!, value: match[3]!.trim() };
}

function splitComparator(value: string) {
  const match = value.match(/^(>=|<=|>|<)(.*)$/);
  if (!match) return { op: "=", value };
  return { op: match[1]!, value: match[2]!.trim() };
}

function splitValueList(value: string) {
  if (!(value.startsWith("(") && value.endsWith(")"))) return [value];
  return value
    .slice(1, -1)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function operatorToRequestOp(
  op: string
): Extract<LoggingSearchExpression, { type: "field" }>["op"] | null {
  return (
    (
      {
        "=": "eq",
        "!=": "neq",
        ">": "gt",
        ">=": "gte",
        "<": "lt",
        "<=": "lte",
      } as Record<string, Extract<LoggingSearchExpression, { type: "field" }>["op"]>
    )[op] ?? null
  );
}

function parseTimeToken(value: string): { from?: string; to?: string } | null {
  if (!value) return null;
  const [fromRaw, toRaw] = value.split("..");
  if (!fromRaw) return null;
  const to = toRaw ? parseTimeBoundary(toRaw) : new Date();
  const from = parseTimeBoundary(fromRaw);
  if (!from || !to) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

function parseTimeBoundary(value: string): Date | null {
  const relative = value.match(/^(\d+)(m|h|d)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - amount * multiplier);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function coerceFieldValue(key: string, value: string, definitions: LoggingFieldDefinition[]) {
  const definition = definitions.find((item) => item.key === key && item.location === "field");
  if (definition?.type === "number") return Number(value);
  if (definition?.type === "boolean") return value === "true";
  return value;
}

function currentToken(input: string, cursor: number) {
  let start = cursor;
  while (start > 0 && !/[\s|()]/.test(input[start - 1] ?? "")) start -= 1;
  let end = cursor;
  while (end < input.length && !/[\s|()]/.test(input[end] ?? "")) end += 1;
  return { start, end, value: input.slice(start, end) };
}

function quoteIfNeeded(value: string) {
  return /[\s|()"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function isSeverity(value: string): value is LoggingSeverity {
  return SEVERITIES.includes(value as LoggingSeverity);
}

function compact<T>(values: Array<T | null>): T[] {
  return values.filter((value): value is T => value !== null);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
