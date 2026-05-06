import AdmZip from 'adm-zip';
import { describe, expect, it, vi } from 'vitest';

import { generateRefundPolicySkill } from './generate.js';

describe('generateRefundPolicySkill', () => {
  it('builds a validated zip bundle with citations and freshness', async () => {
    const bundle = await generateRefundPolicySkill({
      workspaceId: 'workspace-1',
      gbrainVersion: '0.27.1',
      now: new Date('2026-05-06T12:00:00.000Z'),
      gbrain: {
        async query() {
          return {
            chunks: [
              {
                slug: 'refund-policy-2024',
                version_id: 7,
                last_updated: '2026-04-01T00:00:00.000Z',
                excerpt: 'Customers may request a refund within 30 days.',
                score: 0.9,
              },
            ],
          };
        },
        async getChunks() {
          return [
            {
              slug: 'refund-policy-2024',
              version_id: 7,
              last_updated: '2026-04-01T00:00:00.000Z',
              excerpt: 'Customers may request a refund within 30 days.',
            },
          ];
        },
      },
    });

    expect(bundle.frontmatter.citations).toHaveLength(1);
    expect(bundle.skillMarkdown).toContain('[refund-policy-2024 v7]');
    const zip = new AdmZip(bundle.zip);
    expect(zip.getEntry('refund-policy/SKILL.md')).toBeTruthy();
    expect(zip.getEntry('refund-policy/frontmatter.yaml')).toBeTruthy();
    expect(zip.getEntry('refund-policy/manifest.json')).toBeTruthy();
  });

  it('reranks result chunks and can use an Anthropic-generated skill body', async () => {
    const anthropicGenerate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Source 1: refund-new v3');
      expect(prompt).toContain('Enterprise SLA refund');
      return '# Custom Refund Skill';
    });

    const bundle = await generateRefundPolicySkill({
      workspaceId: 'workspace-2',
      gbrainVersion: '0.27.1',
      now: new Date('2026-05-06T12:00:00.000Z'),
      anthropicGenerate,
      gbrain: {
        async query() {
          return {
            results: [
              {
                slug: 'refund-old',
                version_id: 2,
                last_updated: '2025-01-01T00:00:00.000Z',
                chunk_text: 'Payment policy.',
                score: 0.1,
              },
              {
                slug: 'refund-new',
                version_id: 3,
                last_updated: '2026-05-01T00:00:00.000Z',
                chunk_text: 'Enterprise SLA refund.',
                score: 1,
              },
            ],
          };
        },
        async getChunks(slug: string) {
          return [
            {
              slug,
              version_id: slug === 'refund-new' ? 3 : 2,
              last_updated: slug === 'refund-new' ? '2026-05-01T00:00:00.000Z' : '2025-01-01T00:00:00.000Z',
              chunk_text: slug === 'refund-new' ? 'Enterprise SLA refund.' : 'Payment policy.',
            },
          ];
        },
      },
    });

    expect(bundle.skillMarkdown).toBe('# Custom Refund Skill');
    expect(anthropicGenerate).toHaveBeenCalledOnce();
    expect(bundle.frontmatter.freshness.staleness_warning).toBe(true);
  });

  it('returns an explicit fallback when no refund-policy chunks exist', async () => {
    const bundle = await generateRefundPolicySkill({
      workspaceId: 'workspace-empty',
      gbrainVersion: '0.27.1',
      now: new Date('2026-05-06T12:00:00.000Z'),
      gbrain: {
        async query() {
          return { results: [] };
        },
        async getChunks() {
          return [];
        },
      },
    });

    expect(bundle.frontmatter.citations).toEqual([]);
    expect(bundle.skillMarkdown).toContain('does not currently contain enough cited refund-policy material');
  });

  it('rejects generated frontmatter that does not match the skill schema', async () => {
    await expect(
      generateRefundPolicySkill({
        workspaceId: 'workspace-invalid',
        gbrainVersion: '0.27.1',
        now: new Date('2026-05-06T12:00:00.000Z'),
        gbrain: {
          async query() {
            return {
              chunks: [
                {
                  slug: 42 as unknown as string,
                  version_id: 1,
                  last_updated: '2026-05-01T00:00:00.000Z',
                  excerpt: 'Refund metadata is malformed.',
                },
              ],
            };
          },
          async getChunks() {
            return [];
          },
        },
      }),
    ).rejects.toThrow('refund_policy_frontmatter_invalid');
  });
});
