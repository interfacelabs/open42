import AdmZip from 'adm-zip';
import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';

import { resolveLlmKey } from '../../auth/llm-keys.js';
import { isUuid } from '../../auth/uuid.js';
import { db, schema } from '../../db/client.js';
import { GbrainCitationChunk, GbrainClient } from '../../gbrain/client.js';
import { bumpPatch, generateSkill, type ThreadCitation } from '../../skills/generate.js';
import {
  estimateInputChars,
  parseMintInput,
  type MintThreadCitationInput,
} from '../../skills/mint-input.js';
import type { SkillDraftResponse } from '../../skills/contract.js';
import { checkWorkspaceChatBudget } from '../chat-budget.js';

/**
 * Skills router — list / read / mint / revise / export, scoped to the
 * workspace named in the parent path (`/workspaces/:id/skills`).
 * `requireMembership` (mounted on the parent path in `apps/api/src/index.ts`)
 * has already validated the session and asserted membership, so handlers
 * read `req.workspace!.id` and `req.session!.userId` directly.
 * `mergeParams: true` is required so the parent `:id` is visible from within
 * this nested router.
 *
 * Previously this router lived at `/skills` and resolved the workspace via
 * `resolveOwnerWorkspaceId(session.userId)` — that returned "first owned
 * workspace" non-deterministically (LIMIT 1, undefined ordering), which is
 * broken under multi-workspace.
 */
export const skillsRouter = Router({ mergeParams: true });

const MAX_REHYDRATED_EXCERPT_CHARS = 6_000;

/**
 * List the workspace's skills with their latest version metadata. Powers
 * the sidebar's Skills section so users see what they've minted without
 * the legacy hardcoded refund-policy entry.
 */
skillsRouter.get('/', async (req, res, next) => {
  try {
    const workspace = await loadWorkspaceRuntime(req.workspace!.id);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const items = await listSkillsForWorkspace(workspace.id);
    res.json({ skills: items });
  } catch (err) {
    next(err);
  }
});

/**
 * Read the latest persisted draft for a skill the caller owns. Mirrors the
 * shape `bundleToDraft` returns for the legacy refund-policy path so the web
 * SkillPanel renders both uniformly.
 */
skillsRouter.get('/:skillId/draft', async (req, res, next) => {
  try {
    const workspace = await loadWorkspaceRuntime(req.workspace!.id);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const id = req.params.skillId;
    if (!id) {
      res.status(400).json({ error: 'missing_id' });
      return;
    }
    if (!isUuid(id)) {
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }

    const loaded = await loadSkillDraft(workspace.id, id);
    if (!loaded) {
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }
    res.json({ draft: loaded });
  } catch (err) {
    next(err);
  }
});

/**
 * Revise an existing skill — append the user's request as a `you` revision,
 * call the generator in REVISE mode using the prior version body as
 * context, persist a new version + brain revision, return the updated
 * draft.
 */
skillsRouter.post('/:skillId/revise', async (req, res, next) => {
  try {
    const session = req.session!;
    const workspace = await loadWorkspaceRuntime(req.workspace!.id);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const id = req.params.skillId;
    if (!id) {
      res.status(400).json({ error: 'missing_id' });
      return;
    }
    if (!isUuid(id)) {
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text_required' });
      return;
    }
    if (text.length > 2_000) {
      res.status(400).json({ error: 'text_too_long' });
      return;
    }

    const fetched = await loadLatestVersion(workspace.id, id);
    if (!fetched) {
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }

    const budget = checkWorkspaceChatBudget({
      workspaceId: workspace.id,
      inputChars: text.length + fetched.version.body.length,
    });
    if (!budget.ok) {
      res.setHeader('Retry-After', String(budget.retryAfter));
      res.status(429).json({ error: budget.error });
      return;
    }

    const resolvedAnthropic = await resolveLlmKey({
      workspaceId: workspace.id,
      provider: 'anthropic',
      scope: 'chat',
    });
    if (!resolvedAnthropic) {
      res.status(503).json({ error: 'upstream_key_unconfigured' });
      return;
    }

    const generated = await generateSkill({
      workspaceId: workspace.id,
      intent: text,
      threadCitations: [],
      previousDraft: {
        frontmatter: fetched.version.frontmatter as Record<string, unknown>,
        body: fetched.version.body,
      },
      resolvedAnthropic,
    });

    const persisted = await persistRevision({
      skillId: fetched.skill.id,
      skillName: fetched.skill.name,
      userId: session.userId,
      revisionText: text,
      generated,
      previousVersion: fetched.version,
    });

    if (!persisted.ok) {
      res.status(persisted.status).json({ error: persisted.error });
      return;
    }

    // Reload everything (including the prior revisions) so the panel
    // stays in sync without a follow-up GET.
    const reloaded = await loadSkillDraft(workspace.id, fetched.skill.id);
    if (!reloaded) {
      res.status(500).json({ error: 'skill_reload_failed' });
      return;
    }
    res.json({ draft: reloaded });
  } catch (err) {
    if (err instanceof Error && err.message === 'skill_generation_timeout') {
      res.status(504).json({ error: 'skill_generation_timeout' });
      return;
    }
    if (err instanceof Error && err.message === 'skill_generation_failed') {
      res.status(502).json({ error: 'skill_generation_failed' });
      return;
    }
    next(err);
  }
});

/**
 * Build a downloadable zip from the latest persisted version of a skill.
 * Same archive shape as the legacy refund-policy export (SKILL.md +
 * frontmatter.yaml + manifest.json) so consumers don't have to branch.
 */
skillsRouter.post('/:skillId', async (req, res, next) => {
  try {
    const session = req.session!;
    const workspace = await loadWorkspaceRuntime(req.workspace!.id);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const id = req.params.skillId;
    if (!id) {
      res.status(400).json({ error: 'missing_id' });
      return;
    }
    if (!isUuid(id)) {
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }

    const fetched = await loadLatestVersion(workspace.id, id);
    if (!fetched) {
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }

    await logSkillExport({
      workspaceId: workspace.id,
      userId: session.userId,
      skillId: fetched.skill.id,
      version: fetched.version,
    });

    const zip = buildSkillZip(fetched.skill.name, fetched.version);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fetched.skill.name}-skill.zip"`);
    res.send(zip);
  } catch (err) {
    next(err);
  }
});

skillsRouter.post('/', async (req, res, next) => {
  try {
    const session = req.session!;
    const workspace = await loadWorkspaceRuntime(req.workspace!.id);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const parsed = parseMintInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    // Same chat budget cap that gates `routes/chat.ts`. Skill generation
    // spends Anthropic tokens against the same workspace daily window.
    // Charge the upper bound for rehydrated citation excerpts up-front
    // (`MAX_REHYDRATED_EXCERPT_CHARS`) — the actual gbrain fetch happens
    // AFTER this gate, so a strict overestimate is the only honest pre-fetch
    // cap. Replace with a precise post-rehydrate count if/when budget
    // accuracy starts mattering more than gate simplicity.
    const budget = checkWorkspaceChatBudget({
      workspaceId: workspace.id,
      inputChars:
        estimateInputChars(parsed) +
        (parsed.threadCitations.length > 0 ? MAX_REHYDRATED_EXCERPT_CHARS : 0),
    });
    if (!budget.ok) {
      res.setHeader('Retry-After', String(budget.retryAfter));
      res.status(429).json({ error: budget.error });
      return;
    }

    const resolvedAnthropic = await resolveLlmKey({
      workspaceId: workspace.id,
      provider: 'anthropic',
      scope: 'chat',
    });
    if (!resolvedAnthropic) {
      res.status(503).json({ error: 'upstream_key_unconfigured' });
      return;
    }

    const gbrain = new GbrainClient(
      {
        workspaceId: workspace.id,
        baseUrl: workspace.gbrainBaseUrl,
        oauthClientId: workspace.gbrainOauthClientId,
        oauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
      },
      { callerUserId: session.userId },
    );
    const threadCitations = await rehydrateThreadCitations(gbrain, parsed.threadCitations);

    const generated = await generateSkill({
      workspaceId: workspace.id,
      intent: parsed.intent,
      threadCitations,
      resolvedAnthropic,
    });

    const persisted = await persistDraft({
      workspaceId: workspace.id,
      userId: session.userId,
      generated,
      sourceCitationSlugs: new Set(threadCitations.map((c) => c.slug)),
    });

    if (!persisted.ok) {
      res.status(persisted.status).json({ error: persisted.error });
      return;
    }

    res.status(201).json({ draft: persisted.draft });
  } catch (err) {
    if (err instanceof Error && err.message === 'skill_generation_timeout') {
      res.status(504).json({ error: 'skill_generation_timeout' });
      return;
    }
    if (err instanceof Error && err.message === 'skill_generation_failed') {
      res.status(502).json({ error: 'skill_generation_failed' });
      return;
    }
    next(err);
  }
});

interface PersistOk {
  ok: true;
  draft: SkillDraftResponse;
}

interface PersistErr {
  ok: false;
  status: number;
  error: string;
}

/**
 * Writes the freshly-generated draft into `skills`, `skill_versions`, and an
 * initial `skill_revisions` row inside one transaction. If the LLM picks a
 * skill name that already exists in this workspace, returns 409 — caller
 * surfaces it so the user can rephrase / rename in the UI.
 */
async function persistDraft(args: {
  workspaceId: string;
  userId: string;
  generated: Awaited<ReturnType<typeof generateSkill>>;
  sourceCitationSlugs: ReadonlySet<string>;
}): Promise<PersistOk | PersistErr> {
  const { workspaceId, userId, generated, sourceCitationSlugs } = args;
  const { draft } = generated;
  const name = draft.frontmatter.name;
  const version = draft.frontmatter.version;
  if (draft.cited_doc_slugs.some((slug) => !sourceCitationSlugs.has(slug))) {
    return {
      ok: false,
      status: 422,
      error: 'skill_citations_invalid',
    };
  }

  try {
    return await db.transaction(async (tx) => {
      const [skill] = await tx.insert(schema.skills).values({ workspaceId, name }).returning();
      if (!skill) {
        return {
          ok: false as const,
          status: 500,
          error: 'skill_insert_failed',
        };
      }

      const [version_] = await tx
        .insert(schema.skillVersions)
        .values({
          skillId: skill.id,
          version,
          frontmatter: draft.frontmatter,
          body: draft.body,
          citedDocSlugs: draft.cited_doc_slugs,
          createdByUserId: userId,
        })
        .returning();
      if (!version_) {
        return {
          ok: false as const,
          status: 500,
          error: 'skill_version_insert_failed',
        };
      }

      const citeChips =
        draft.cited_doc_slugs.length > 0
          ? draft.cited_doc_slugs.map((_, idx) => `[${idx + 1}]`).join(' ')
          : null;
      const [revision] = await tx
        .insert(schema.skillRevisions)
        .values({
          skillId: skill.id,
          versionId: version_.id,
          role: 'brain',
          text: `Drafted v${version} from ${draft.cited_doc_slugs.length} ${draft.cited_doc_slugs.length === 1 ? 'source' : 'sources'}.`,
          cites: citeChips,
        })
        .returning();
      if (!revision) {
        return {
          ok: false as const,
          status: 500,
          error: 'skill_revision_insert_failed',
        };
      }

      return {
        ok: true as const,
        draft: {
          id: skill.id,
          name: skill.name,
          version: version_.version,
          body: version_.body,
          cites: draft.cited_doc_slugs.map((slug, idx) => ({
            index: idx + 1,
            slug,
          })),
          revisions: [
            {
              id: revision.id,
              role: 'brain' as const,
              text: revision.text,
              cites: revision.cites ?? undefined,
            },
          ],
        },
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false as const,
        status: 409,
        error: 'skill_name_already_exists',
      };
    }
    throw err;
  }
}

/**
 * Detect a Postgres unique-constraint violation. The error code lives on
 * the top-level pg-node error in some drivers, but Drizzle (and Node 20+
 * Error chains) sometimes wrap it under `.cause`. Check both — false
 * negatives here turn 409s into 500s.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: unknown }).code === '23505') return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && (cause as { code?: unknown }).code === '23505') {
    return true;
  }
  return false;
}

interface PersistRevisionOk {
  ok: true;
}

interface PersistRevisionErr {
  ok: false;
  status: number;
  error: string;
}

/**
 * Append a `you` revision (the user's request), insert a new
 * `skill_versions` row from the regenerated draft, and append a `brain`
 * revision linked to that version. All three writes happen in one
 * transaction.
 */
async function persistRevision(args: {
  skillId: string;
  skillName: string;
  userId: string;
  revisionText: string;
  generated: Awaited<ReturnType<typeof generateSkill>>;
  previousVersion: typeof schema.skillVersions.$inferSelect;
}): Promise<PersistRevisionOk | PersistRevisionErr> {
  const { skillId, skillName, userId, revisionText, generated, previousVersion } = args;
  const { draft } = generated;
  // Clamp identity + version server-side. Build a NEW frontmatter object so we
  // don't mutate the caller's draft (shared fixtures, parallel callers, retry
  // paths all break if we mutate in place).
  const clampedFrontmatter = {
    ...draft.frontmatter,
    name: skillName,
    version: bumpPatch(previousVersion.version),
  };
  const clampedVersion = clampedFrontmatter.version;

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(schema.skillRevisions).values({
        skillId,
        role: 'you',
        text: revisionText,
      });

      const [version] = await tx
        .insert(schema.skillVersions)
        .values({
          skillId,
          version: clampedVersion,
          frontmatter: clampedFrontmatter,
          body: draft.body,
          citedDocSlugs: draft.cited_doc_slugs,
          createdByUserId: userId,
        })
        .returning();
      if (!version) {
        return {
          ok: false as const,
          status: 500,
          error: 'skill_version_insert_failed',
        };
      }

      await tx
        .update(schema.skills)
        .set({ updatedAt: new Date() })
        .where(eq(schema.skills.id, skillId));

      const citeChips =
        draft.cited_doc_slugs.length > 0
          ? draft.cited_doc_slugs.map((_, idx) => `[${idx + 1}]`).join(' ')
          : null;
      await tx.insert(schema.skillRevisions).values({
        skillId,
        versionId: version.id,
        role: 'brain',
        text: `Revised to v${version.version}.`,
        cites: citeChips,
      });

      return { ok: true as const };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false as const,
        status: 422,
        error: 'skill_version_unchanged',
      };
    }
    throw err;
  }
}

async function rehydrateThreadCitations(
  gbrain: Pick<GbrainClient, 'getChunks'>,
  citations: MintThreadCitationInput[],
): Promise<ThreadCitation[]> {
  const out: ThreadCitation[] = [];
  const seen = new Set<string>();
  let remaining = MAX_REHYDRATED_EXCERPT_CHARS;

  for (const citation of citations) {
    if (seen.has(citation.slug) || remaining <= 0) continue;
    seen.add(citation.slug);

    const chunks = await gbrain.getChunks(citation.slug);
    if (chunks.length === 0) continue;

    const excerpt = chunksToExcerpt(chunks).slice(0, remaining);
    if (!excerpt) continue;

    remaining -= excerpt.length;
    out.push({
      slug: citation.slug,
      excerpt,
      lastUpdated: citation.lastUpdated ?? latestChunkUpdate(chunks),
    });
  }

  return out;
}

function chunksToExcerpt(chunks: GbrainCitationChunk[]): string {
  return chunks
    .map((chunk) => chunk.chunk_text ?? chunk.excerpt ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
    .trim();
}

function latestChunkUpdate(chunks: GbrainCitationChunk[]): string | undefined {
  const updates = chunks
    .map((chunk) => chunk.last_updated)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort();
  return updates.at(-1);
}

async function logSkillExport(args: {
  workspaceId: string;
  userId: string;
  skillId: string;
  version: typeof schema.skillVersions.$inferSelect;
}): Promise<void> {
  const citedDocSlugs = normalizeCitedDocSlugs(args.version.citedDocSlugs);
  try {
    await db.insert(schema.skillExports).values({
      workspaceId: args.workspaceId,
      userId: args.userId,
      skillId: args.skillId,
      citationsCount: citedDocSlugs.length,
      citedDocSlugs,
      sourcePagesOldestAt: null,
      stalenessWarning: false,
    });
  } catch {
    // Audit log only — downloads should not fail if this write is unavailable.
  }
}

function normalizeCitedDocSlugs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((slug): slug is string => typeof slug === 'string')
    : [];
}

/**
 * Workspace-scoped skill listing for the sidebar. Joins to the latest
 * `skill_versions` row per skill so callers can render `name` + `version`
 * without a second round-trip.
 */
async function listSkillsForWorkspace(workspaceId: string) {
  const rows = await db
    .select({
      id: schema.skills.id,
      name: schema.skills.name,
      updatedAt: schema.skills.updatedAt,
    })
    .from(schema.skills)
    .where(eq(schema.skills.workspaceId, workspaceId))
    .orderBy(desc(schema.skills.updatedAt));

  if (rows.length === 0)
    return [] as Array<{ id: string; name: string; version: string | null; updatedAt: string }>;

  // Per-skill latest version. One round-trip per skill is fine for P1
  // scale; a window-function join can come if a workspace ends up with
  // dozens of skills.
  return Promise.all(
    rows.map(async (skill) => {
      const [v] = await db
        .select({ version: schema.skillVersions.version })
        .from(schema.skillVersions)
        .where(eq(schema.skillVersions.skillId, skill.id))
        .orderBy(desc(schema.skillVersions.createdAt))
        .limit(1);
      return {
        id: skill.id,
        name: skill.name,
        version: v?.version ?? null,
        updatedAt: skill.updatedAt.toISOString(),
      };
    }),
  );
}

/**
 * Look up the skill + its latest committed version + the existing revision
 * log, scoped to the caller's workspace. Returns null if the skill doesn't
 * exist or doesn't belong to the workspace (404 either way — we don't
 * differentiate so cross-tenant probing reveals nothing).
 */
async function loadSkillDraft(workspaceId: string, id: string): Promise<SkillDraftResponse | null> {
  const fetched = await loadLatestVersion(workspaceId, id);
  if (!fetched) return null;
  const { skill, version } = fetched;

  const revisions = await db
    .select()
    .from(schema.skillRevisions)
    .where(eq(schema.skillRevisions.skillId, skill.id))
    .orderBy(schema.skillRevisions.createdAt);

  const slugs = Array.isArray(version.citedDocSlugs)
    ? (version.citedDocSlugs as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  return {
    id: skill.id,
    name: skill.name,
    version: version.version,
    body: version.body,
    cites: slugs.map((slug, idx) => ({ index: idx + 1, slug })),
    revisions: revisions.map((r) => ({
      id: r.id,
      role: r.role,
      text: r.text,
      cites: r.cites ?? undefined,
    })),
  };
}

interface LoadedVersion {
  skill: { id: string; name: string; workspaceId: string };
  version: typeof schema.skillVersions.$inferSelect;
}

async function loadLatestVersion(workspaceId: string, id: string): Promise<LoadedVersion | null> {
  const [skill] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.id, id), eq(schema.skills.workspaceId, workspaceId)))
    .limit(1);
  if (!skill) return null;

  const [version] = await db
    .select()
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skill.id))
    .orderBy(desc(schema.skillVersions.createdAt))
    .limit(1);
  if (!version) return null;

  return { skill, version };
}

function buildSkillZip(name: string, version: typeof schema.skillVersions.$inferSelect): Buffer {
  const zip = new AdmZip();
  const frontmatterYaml = stringifyYamlFrontmatter(version.frontmatter as Record<string, unknown>);
  const skillMd = `---\n${frontmatterYaml}---\n\n${version.body}\n`;
  const manifest = {
    name,
    version: version.version,
    entrypoint: 'SKILL.md',
    generated_at: version.createdAt.toISOString(),
  };
  zip.addFile(`${name}/SKILL.md`, Buffer.from(skillMd, 'utf8'));
  zip.addFile(`${name}/frontmatter.yaml`, Buffer.from(frontmatterYaml, 'utf8'));
  zip.addFile(`${name}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  return zip.toBuffer();
}

/**
 * Tiny YAML emitter for skill frontmatter — handles the limited shape the
 * generator emits (strings, numbers, bools, arrays of strings). External
 * deps would be overkill for this scope.
 */
export function stringifyYamlFrontmatter(value: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      lines.push(`${key}:`);
      for (const item of raw) {
        lines.push(`  - ${formatScalar(item)}`);
      }
      continue;
    }
    lines.push(`${key}: ${formatScalar(raw)}`);
  }
  return lines.join('\n') + '\n';
}

function formatScalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    if (/^[A-Za-z0-9_./@:-]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/**
 * Load the workspace runtime fields needed to talk to the per-tenant gbrain.
 * Membership has already been asserted by `requireMembership`; this helper
 * only checks whether the tenant runtime is provisioned (gbrain credentials
 * populated) so handlers can 409 fast when the workspace exists but isn't
 * up yet (e.g. provisioning still in flight).
 */
async function loadWorkspaceRuntime(workspaceId: string) {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (
    !(workspace?.gbrainBaseUrl || workspace?.gbrainPrivateAddress) ||
    !workspace.gbrainOauthClientId ||
    !workspace.gbrainOauthClientSecretCiphertext
  ) {
    return null;
  }
  return {
    id: workspace.id,
    gbrainBaseUrl: workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.gbrainPrivateAddress ?? ''),
    gbrainOauthClientId: workspace.gbrainOauthClientId,
    gbrainOauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
  };
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
