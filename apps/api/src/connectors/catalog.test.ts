import { describe, expect, it } from 'vitest';

import {
  COMPOSIO_SERVICE_CATALOG,
  findConnectableComposioServiceByConnectionKind,
  publicComposioServiceCatalog,
} from './catalog.js';

describe('Composio service catalog', () => {
  it('keeps Notion connectable and Slack/GDocs planned', () => {
    expect(COMPOSIO_SERVICE_CATALOG.map((service) => service.serviceId)).toEqual([
      'notion',
      'slack',
      'gdocs',
    ]);
    expect(findConnectableComposioServiceByConnectionKind('notion-composio')?.serviceId).toBe(
      'notion',
    );
    expect(findConnectableComposioServiceByConnectionKind('slack-composio')).toBeNull();
    expect(findConnectableComposioServiceByConnectionKind('gdocs-composio')).toBeNull();
  });

  it('only marks available services connectable when Composio and auth config are ready', () => {
    const services = publicComposioServiceCatalog({
      composioEnabled: true,
      configuredAuthConfigs: { notion: true, slack: true, gdocs: true },
    });

    expect(services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceId: 'notion', connectable: true }),
        expect.objectContaining({ serviceId: 'slack', connectable: false, status: 'planned' }),
        expect.objectContaining({ serviceId: 'gdocs', connectable: false, status: 'planned' }),
      ]),
    );
  });

  it('does not mark Notion connectable without its auth config', () => {
    const services = publicComposioServiceCatalog({
      composioEnabled: true,
      configuredAuthConfigs: { notion: false },
    });

    expect(services.find((service) => service.serviceId === 'notion')?.connectable).toBe(false);
  });
});
