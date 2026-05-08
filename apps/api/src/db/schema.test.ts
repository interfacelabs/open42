import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { db } from './client.js';

describe('workspaces table constraints', () => {
  it('has UNIQUE(owner_user_id)', async () => {
    const result = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'workspaces'
        AND indexname LIKE '%owner_user_id%'
        AND indexdef LIKE '%UNIQUE%'
    `);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
