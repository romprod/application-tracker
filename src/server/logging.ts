type JsonLogValue =
  | boolean
  | null
  | number
  | string
  | JsonLogValue[]
  | { [key: string]: JsonLogValue };

export type LogContext = Record<string, unknown>;

export interface ApplicationLogger {
  error(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
}

export interface LogDestination {
  error(line: string): void;
  info(line: string): void;
}

interface JsonLoggerOptions {
  destination?: LogDestination;
  now?: () => Date;
}

const redactedKeyFragments = [
  "address",
  "authorization",
  "backuppath",
  "body",
  "cause",
  "cookie",
  "credential",
  "databasepath",
  "displayname",
  "email",
  "host",
  "hostname",
  "inputpath",
  "message",
  "outputpath",
  "passphrase",
  "password",
  "path",
  "phone",
  "query",
  "querystring",
  "secret",
  "setcookie",
  "setuptoken",
  "stack",
  "token",
  "url",
  "username",
];

const consoleDestination: LogDestination = {
  error: (line) => console.error(line),
  info: (line) => console.info(line),
};

export const noOpLogger: ApplicationLogger = {
  error: () => undefined,
  info: () => undefined,
};

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isRedactedKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return redactedKeyFragments.some((fragment) => normalized.includes(fragment));
}

function safeErrorName(error: Error): string {
  return /^[A-Za-z][A-Za-z0-9]*Error$/.test(error.name) ? error.name : "Error";
}

function jsonLogValue(
  value: unknown,
  seen: WeakSet<object>,
): JsonLogValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.length <= 512 ? value : `${value.slice(0, 512)}…`;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: safeErrorName(value) };
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => jsonLogValue(item, seen))
      .filter((item): item is JsonLogValue => item !== undefined);
  }

  const sanitized: Record<string, JsonLogValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isRedactedKey(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    const nested = jsonLogValue(nestedValue, seen);
    if (nested !== undefined) sanitized[key] = nested;
  }
  return sanitized;
}

function sanitizedContext(context: LogContext): Record<string, JsonLogValue> {
  const sanitized = jsonLogValue(context, new WeakSet());
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === "object"
    ? sanitized
    : {};
}

export function createJsonLogger(
  options: JsonLoggerOptions = {},
): ApplicationLogger {
  const destination = options.destination ?? consoleDestination;
  const now = options.now ?? (() => new Date());

  function write(
    level: "error" | "info",
    event: string,
    context: LogContext = {},
  ): void {
    const entry = JSON.stringify({
      ...sanitizedContext(context),
      event,
      level,
      timestamp: now().toISOString(),
    });
    destination[level](entry);
  }

  return {
    error: (event, context) => write("error", event, context),
    info: (event, context) => write("info", event, context),
  };
}
