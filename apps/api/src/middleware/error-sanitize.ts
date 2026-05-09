/**
 * Sanitize an unknown error value for logging.
 *
 * Codex review #2: gbrain (and other upstream services) may echo tool args,
 * request bodies, or arbitrary user data back inside error response payloads.
 * If we let Pino's default error serializer walk an `Error` instance we can
 * leak that data into our persistent application logs — an audit and privacy
 * problem we cannot fix later because the bytes are already on disk.
 *
 * This helper is the ONLY shape that should land in `logger.error/warn` when
 * an `unknown` error is involved. It picks an explicit allow-list of fields:
 *   - `name`        — error class name
 *   - `message`     — truncated to 500 chars (long messages can hide injected text)
 *   - `code`        — numeric or string error code if present (HTTP/MCP/JSON-RPC)
 *   - `status`      — HTTP status if present
 *   - `bodyLength`  — upstream body size in bytes for triage (NOT the body itself)
 *
 * Explicitly NOT included:
 *   - `cause`       — chained errors may carry the same payloads
 *   - `details`     — historical free-form payload, may contain echoed args
 *   - `body`        — raw upstream body
 *   - `stack`       — kept off info/error path; surface separately in debug only
 *   - `response`    — full upstream Response objects
 *
 * The Pino top-level logger also has a `redact` list as defense-in-depth; this
 * function is the primary boundary.
 */
const MESSAGE_MAX_CHARS = 500;

export interface SanitizedError {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
  bodyLength?: number;
}

export function sanitizeErrorForLog(err: unknown): SanitizedError {
  if (err instanceof Error) {
    const out: SanitizedError = {
      name: err.name || 'Error',
      message: truncate(err.message ?? '', MESSAGE_MAX_CHARS),
    };
    const code = readPrimitive(err, 'code');
    if (typeof code === 'string' || typeof code === 'number') out.code = code;
    const status = readPrimitive(err, 'status');
    if (typeof status === 'number') out.status = status;
    const bodyLength = readPrimitive(err, 'bodyLength');
    if (typeof bodyLength === 'number') out.bodyLength = bodyLength;
    return out;
  }
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const out: SanitizedError = {
      name: typeof obj.name === 'string' ? obj.name : 'NonError',
      message: truncate(typeof obj.message === 'string' ? obj.message : '', MESSAGE_MAX_CHARS),
    };
    if (typeof obj.code === 'string' || typeof obj.code === 'number') out.code = obj.code;
    if (typeof obj.status === 'number') out.status = obj.status;
    if (typeof obj.bodyLength === 'number') out.bodyLength = obj.bodyLength;
    return out;
  }
  return {
    name: 'NonError',
    message: truncate(typeof err === 'string' ? err : String(err ?? ''), MESSAGE_MAX_CHARS),
  };
}

function readPrimitive(target: object, key: string): unknown {
  return (target as Record<string, unknown>)[key];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…(truncated ${value.length - max}c)`;
}

/**
 * Pino redact paths used as defense-in-depth on the top-level logger config.
 * This catches accidental future code paths that pass error objects directly
 * to a log call instead of going through `sanitizeErrorForLog`. Keep these in
 * sync with the fields explicitly excluded from `SanitizedError`.
 */
export const PINO_ERROR_REDACT_PATHS: readonly string[] = [
  'err.details',
  'err.body',
  'err.cause',
  'err.response',
  'err.stack',
  'error.details',
  'error.body',
  'error.cause',
  'error.response',
  'error.stack',
  '*.body',
  '*.details',
  '*.payload',
  'req.body',
  'res.body',
];
