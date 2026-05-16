import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Plug2 } from 'lucide-react';

import { McpProxyManager } from '@/components/mcp/McpProxyManager';
import type { WorkspaceRuntime } from '@/lib/onboarding/derive';

interface OnboardingMcpPanelProps {
  runtime: WorkspaceRuntime;
  workspaceId: string | null;
}

/**
 * Optional onboarding card surfacing the MCP proxy. Rendered below the source
 * picker once the workspace runtime is ready. Collapsed by default — the
 * primary onboarding action stays focused on connecting a source.
 *
 * The user can:
 *   - Expand inline → use the shared {@link McpProxyManager} in compact mode.
 *   - Dismiss → the card hides for the rest of the onboarding view.
 *   - "Set up later in Settings" → links to `/settings/mcp` without leaving
 *     the onboarding flow open.
 */
export function OnboardingMcpPanel({ runtime, workspaceId }: OnboardingMcpPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (runtime !== 'ready' || dismissed) return null;

  if (!expanded) {
    return (
      <section
        aria-label="Use this brain in Claude Code"
        className="mt-6 max-w-[520px] rounded-xl border border-border-soft bg-white p-4"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-soft bg-panel-soft text-text-body">
            <Plug2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-text-primary">
              Use this brain in Claude Code
            </p>
            <p className="mt-1 text-[12.5px] leading-snug text-text-subtle">
              Issue MCP credentials so an external client can read from this workspace&rsquo;s
              brain through Open42&rsquo;s proxy. Admins enable it once; every member can then
              claim their own personal client. Optional — set up later in Settings if you prefer.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-white px-3 text-[12.5px] font-medium text-text-primary transition-colors duration-140 hover:bg-panel-soft"
              >
                Set up MCP
              </button>
              <Link
                href="/settings/mcp"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-text-subtle transition-colors duration-140 hover:text-text-primary"
              >
                Set up later in Settings
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
              </Link>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-[12.5px] font-medium text-text-faint transition-colors duration-140 hover:text-text-subtle"
              >
                Do this later
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Use this brain in Claude Code"
      className="mt-6 max-w-[560px] rounded-xl border border-border-soft bg-white p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-medium text-text-primary">
            Use this brain in Claude Code
          </p>
          <p className="mt-1 max-w-[48ch] text-[12.5px] leading-snug text-text-subtle">
            MCP access is off by default. Turn it on, then create a client &mdash; we&rsquo;ll
            hand you the credentials once. Open42 keeps only a hash.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[12px] font-medium text-text-faint transition-colors duration-140 hover:text-text-subtle"
        >
          Hide
        </button>
      </header>
      <div className="mt-4">
        <McpProxyManager workspaceId={workspaceId} mode="onboarding" />
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-border-soft pt-3">
        <Link
          href="/settings/mcp"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-text-subtle transition-colors duration-140 hover:text-text-primary"
        >
          Finish in Settings
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[12px] font-medium text-text-faint transition-colors duration-140 hover:text-text-subtle"
        >
          Do this later
        </button>
      </div>
    </section>
  );
}
