/**
 * Manual Spike 2: Composio tenant isolation.
 *
 * Do not run this in CI. It requires real COMPOSIO_API_KEY credentials and two
 * manually completed Notion OAuth connections in Composio.
 *
 * Procedure:
 * 1. Initiate a Notion connection for entity/user id "open42-spike-A" and
 *    complete OAuth manually. Put the resulting connected account id in
 *    COMPOSIO_CONNECTED_ACCOUNT_ID_A.
 * 2. Initiate a Notion connection for entity/user id "open42-spike-B" and put
 *    its id in COMPOSIO_CONNECTED_ACCOUNT_ID_B.
 * 3. Run this script. It searches with A and B independently and prints counts.
 * 4. PASS criterion: Composio should execute each call strictly against the
 *    account passed in `account`; Open42 additionally checks getConnection(id)
 *    user_id per cycle and refuses workspace mismatches.
 *
 * If a future Composio SDK/API lets a workspace use another workspace's account
 * id without an entity/user boundary, D1 must change before launch.
 */
import { createComposioClient } from '../apps/api/src/composio/client.js';

const apiKey = process.env.COMPOSIO_API_KEY;
const accountA = process.env.COMPOSIO_CONNECTED_ACCOUNT_ID_A;
const accountB = process.env.COMPOSIO_CONNECTED_ACCOUNT_ID_B;

if (!apiKey || !accountA || !accountB) {
  console.error(
    'COMPOSIO_API_KEY, COMPOSIO_CONNECTED_ACCOUNT_ID_A, and COMPOSIO_CONNECTED_ACCOUNT_ID_B are required',
  );
  process.exit(1);
}

const composio = await createComposioClient({ apiKey });
const [connectionA, connectionB] = await Promise.all([
  composio.getConnection(accountA),
  composio.getConnection(accountB),
]);

const [searchA, searchB] = await Promise.all([
  composio.executeTool<{ results?: unknown[] }>({
    tool: 'NOTION_SEARCH',
    account: accountA,
    args: { filter: { property: 'object', value: 'page' } },
  }),
  composio.executeTool<{ results?: unknown[] }>({
    tool: 'NOTION_SEARCH',
    account: accountB,
    args: { filter: { property: 'object', value: 'page' } },
  }),
]);

console.log(
  JSON.stringify(
    {
      accountA: { id: connectionA.id, user_id: connectionA.user_id, pages: searchA.results?.length ?? 0 },
      accountB: { id: connectionB.id, user_id: connectionB.user_id, pages: searchB.results?.length ?? 0 },
    },
    null,
    2,
  ),
);
