export type ComposioServiceStatus = 'available' | 'planned' | 'hidden';
export type ComposioServiceMode = 'pollable' | 'one_shot';
export type ComposioServiceId = 'notion' | 'slack' | 'gdocs';

export interface SupportedComposioService {
  readonly serviceId: ComposioServiceId;
  readonly label: string;
  readonly detail: string;
  readonly connectionKind: string;
  readonly composioToolkit: string;
  readonly logoSlug: string;
  readonly authConfigEnv: string;
  readonly status: ComposioServiceStatus;
  readonly mode: ComposioServiceMode;
  readonly capabilities: readonly string[];
  readonly allowedTools: readonly string[];
  readonly extractor: string;
}

export interface PublicComposioService {
  readonly serviceId: ComposioServiceId;
  readonly label: string;
  readonly detail: string;
  readonly connectionKind: string;
  readonly composioToolkit: string;
  readonly logoSlug: string;
  readonly status: ComposioServiceStatus;
  readonly mode: ComposioServiceMode;
  readonly capabilities: readonly string[];
  readonly connectable: boolean;
}

export interface PublicComposioCatalogOptions {
  readonly composioEnabled: boolean;
  readonly configuredAuthConfigs?: Partial<Record<ComposioServiceId, boolean>>;
}

export const COMPOSIO_SERVICE_CATALOG: readonly SupportedComposioService[] = [
  {
    serviceId: 'notion',
    label: 'Notion',
    detail: 'Live pages via OAuth',
    connectionKind: 'notion-composio',
    composioToolkit: 'NOTION',
    logoSlug: 'notion',
    authConfigEnv: 'COMPOSIO_NOTION_AUTH_CONFIG_ID',
    status: 'available',
    mode: 'pollable',
    capabilities: ['pages', 'blocks', 'workspace-search'],
    allowedTools: ['NOTION_SEARCH', 'NOTION_FETCH_PAGE_CONTENT'],
    extractor: 'notion-composio',
  },
  {
    serviceId: 'slack',
    label: 'Slack',
    detail: 'Channels, messages, and threads',
    connectionKind: 'slack-composio',
    composioToolkit: 'SLACK',
    logoSlug: 'slack',
    authConfigEnv: 'COMPOSIO_SLACK_AUTH_CONFIG_ID',
    status: 'planned',
    mode: 'pollable',
    capabilities: ['channels', 'messages', 'threads', 'files'],
    allowedTools: [
      'SLACK_LIST_CONVERSATIONS',
      'SLACK_FETCH_CONVERSATION_HISTORY',
      'SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION',
      'SLACK_RETRIEVE_MESSAGE_PERMALINK_URL',
      'SLACK_LIST_FILES_WITH_FILTERS_IN_SLACK',
      'SLACK_DOWNLOAD_SLACK_FILE',
    ],
    extractor: 'slack-composio',
  },
  {
    serviceId: 'gdocs',
    label: 'Google Docs',
    detail: 'Docs and text content',
    connectionKind: 'gdocs-composio',
    composioToolkit: 'GOOGLEDOCS',
    logoSlug: 'googledocs',
    authConfigEnv: 'COMPOSIO_GDOCS_AUTH_CONFIG_ID',
    status: 'planned',
    mode: 'pollable',
    capabilities: ['documents', 'plain-text', 'workspace-search'],
    allowedTools: ['GOOGLEDOCS_SEARCH_DOCUMENTS', 'GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT'],
    extractor: 'gdocs-composio',
  },
];

export function publicComposioServiceCatalog(
  options: PublicComposioCatalogOptions,
): PublicComposioService[] {
  return COMPOSIO_SERVICE_CATALOG.filter((service) => service.status !== 'hidden').map(
    (service) => ({
      serviceId: service.serviceId,
      label: service.label,
      detail: service.detail,
      connectionKind: service.connectionKind,
      composioToolkit: service.composioToolkit,
      logoSlug: service.logoSlug,
      status: service.status,
      mode: service.mode,
      capabilities: service.capabilities,
      connectable:
        service.status === 'available' &&
        options.composioEnabled &&
        Boolean(options.configuredAuthConfigs?.[service.serviceId]),
    }),
  );
}

export function findComposioServiceByConnectionKind(
  kind: string,
): SupportedComposioService | undefined {
  return COMPOSIO_SERVICE_CATALOG.find((service) => service.connectionKind === kind);
}

export function findComposioServiceById(serviceId: string): SupportedComposioService | undefined {
  return COMPOSIO_SERVICE_CATALOG.find((service) => service.serviceId === serviceId);
}

export function findConnectableComposioServiceById(
  serviceId: string,
): SupportedComposioService | null {
  const service = findComposioServiceById(serviceId);
  if (!service || service.status !== 'available') return null;
  return service;
}

export function findConnectableComposioServiceByConnectionKind(
  kind: string,
): SupportedComposioService | null {
  const service = findComposioServiceByConnectionKind(kind);
  if (!service || service.status !== 'available') return null;
  return service;
}

export function serviceIdForConnectionKind(kind: string): ComposioServiceId | null {
  if (kind === 'notion-zip') return 'notion';
  return findComposioServiceByConnectionKind(kind)?.serviceId ?? null;
}
