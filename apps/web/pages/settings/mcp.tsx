import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { McpProxyManager } from '@/components/mcp/McpProxyManager';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { fetcher, type FetchError } from '@/lib/api';
import { useWorkspaceStore } from '@/lib/workspaces/store';

export default function McpSettingsPage() {
  const router = useRouter();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const authSwr = useSWR('/api/auth/me', fetcher);

  useEffect(() => {
    if ((authSwr.error as FetchError | undefined)?.status === 401) {
      void router.replace('/sign_in');
    }
  }, [authSwr.error, router]);

  return (
    <>
      <Head>
        <title>MCP — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · MCP"
          title="MCP"
          subtitle="Connect this workspace brain to external MCP clients."
        />
        <SettingsNav active="mcp" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <div className="max-w-3xl space-y-6">
            <McpProxyManager workspaceId={workspaceId} mode="settings" />

            <aside className="rounded-xl border border-border-soft bg-panel-soft px-5 py-4 text-[12.5px] leading-snug text-text-body">
              <p className="font-medium text-text-primary">How this works</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>MCP access is off by default. Only owners and admins can turn it on.</li>
                <li>
                  Once enabled, every workspace member can claim one personal read+write client tied
                  to their account.
                </li>
                <li>The secret is shown once. Store it in your MCP client now.</li>
                <li>
                  Revoking a client blocks new token issuance and existing issued tokens at the
                  Open42 proxy.
                </li>
              </ul>
            </aside>
          </div>
        </div>
      </AppShell>
    </>
  );
}
