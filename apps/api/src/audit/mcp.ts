/**
 * Per-tenant audit trail for gbrain MCP tool calls.
 *
 * Stores STRUCTURAL metadata only — never request/response body content.
 * `request_hmac` is an HMAC-SHA256 fingerprint over the raw arguments,
 * keyed by OPEN42_KEK. Rotatable; plaintext is unrecoverable.
 *
 * Codex review #6: forensic visibility ("did Open42 ops query Tenant A's
 * brain at 3am?") and basic compliance posture, with zero data exposure.
 */
import { createHmac, randomUUID } from 'node:crypto';

import { readKek } from '../crypto/envelope.js';
import { db, schema } from '../db/client.js';

export interface McpAuditInput {
  workspaceId: string;
  callerUserId?: string | null;
  toolName: string;
  requestArgs: Record<string, unknown>;
  requestId?: string;
  status: number;
  durationMs: number;
  resultCount?: number | null;
  errorCode?: string | null;
}

/**
 * Stable JSON.stringify with sorted keys at every depth. JSON.stringify
 * preserves insertion order on modern V8 — but call sites construct the
 * argument record from various sources (req.body, scheduler payloads,
 * destructured options), so insertion order isn't a stable contract.
 * Sorting guarantees the same arguments always hash to the same bytes,
 * which is the whole point of "fingerprint, not encryption".
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

export function fingerprintArgs(args: Record<string, unknown>): Buffer {
  return createHmac('sha256', readKek()).update(stableStringify(args)).digest();
}

/**
 * Fire-and-forget audit write. NEVER throws — audit must not break the
 * user-facing flow. DB errors are logged to stderr.
 */
export async function recordMcpCall(input: McpAuditInput): Promise<void> {
  try {
    const requestHmac = fingerprintArgs(input.requestArgs);
    await db.insert(schema.mcpAuditLog).values({
      workspaceId: input.workspaceId,
      callerUserId: input.callerUserId ?? null,
      toolName: input.toolName,
      requestHmac,
      requestId: input.requestId ?? randomUUID(),
      status: input.status,
      durationMs: input.durationMs,
      resultCount: input.resultCount ?? null,
      errorCode: input.errorCode ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[mcp-audit] write failed (audit must not break user flow):',
      err instanceof Error ? err.message : String(err),
    );
  }
}
