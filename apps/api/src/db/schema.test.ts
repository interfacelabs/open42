import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { db } from './client.js';

describe('workspaces table constraints', () => {
  it('workspaces.owner_user_id has no UNIQUE constraint but the column still exists', async () => {
    const indexes = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'workspaces' AND indexname = 'workspaces_owner_user_id_uniq'
    `);
    expect(indexes.rows.length).toBe(0);

    const columns = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'workspaces' AND column_name = 'owner_user_id'
    `);
    expect(columns.rows.length).toBe(1);
  });
});
