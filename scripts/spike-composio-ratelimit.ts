/**
 * Manual Spike 3: Composio rate-limit surfacing.
 *
 * Do not run this in CI. It requires a real COMPOSIO_API_KEY, a real Composio
 * connected_account_id for Notion, and enough connected Notion pages to create
 * burst pressure. The goal is to determine whether Composio smooths Notion
 * rate limits internally or surfaces raw HTTP 429 errors.
 *
 * Usage:
 *   COMPOSIO_API_KEY=... COMPOSIO_CONNECTED_ACCOUNT_ID=... \
 *     npx tsx scripts/spike-composio-ratelimit.ts
 *
 * PASS criterion:
 *   Calls either all succeed due to Composio internal smoothing, or failures are
 *   surfaced as 429-like errors that the Open42 client retry layer handles.
 */
import { createComposioClient } from '../apps/api/src/composio/client.js';

const apiKey = process.env.COMPOSIO_API_KEY;
const account = process.env.COMPOSIO_CONNECTED_ACCOUNT_ID;

if (!apiKey || !account) {
  console.error('COMPOSIO_API_KEY and COMPOSIO_CONNECTED_ACCOUNT_ID are required');
  process.exit(1);
}

const composio = await createComposioClient({ apiKey });
let failures = 0;

for (let index = 0; index < 200; index += 1) {
  try {
    await composio.executeTool({
      tool: 'NOTION_SEARCH',
      account,
      args: {
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
      },
    });
  } catch (err) {
    failures += 1;
    console.error('rate-limit spike call failed', {
      index,
      status: statusOf(err),
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

console.log(JSON.stringify({ calls: 200, failures }, null, 2));

function statusOf(err: unknown): unknown {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as Record<string, unknown>;
  return record.status ?? record.statusCode;
}
