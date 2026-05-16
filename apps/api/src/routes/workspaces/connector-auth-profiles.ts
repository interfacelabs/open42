import { Router } from 'express';

import {
  ComposioProfileError,
  deleteComposioByokProfile,
  listPublicConnectorAuthProfiles,
  upsertComposioByokProfile,
} from '../../composio/profiles.js';

export interface ConnectorAuthProfilesRouterDeps {
  listProfiles?: typeof listPublicConnectorAuthProfiles;
  upsertProfile?: typeof upsertComposioByokProfile;
  deleteProfile?: typeof deleteComposioByokProfile;
}

export function buildConnectorAuthProfilesRouter(deps: ConnectorAuthProfilesRouterDeps = {}) {
  const router = Router({ mergeParams: true });
  const listProfiles = deps.listProfiles ?? listPublicConnectorAuthProfiles;
  const upsertProfile = deps.upsertProfile ?? upsertComposioByokProfile;
  const deleteProfile = deps.deleteProfile ?? deleteComposioByokProfile;

  router.get('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const profiles = await listProfiles(workspaceId);
      res.json({ profiles });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const userId = req.session!.userId;
      const parsed = parseUpsertBody(req.body);
      if (!parsed) {
        res.status(400).json({ error: 'invalid_connector_auth_profile' });
        return;
      }

      const profile = await upsertProfile({
        workspaceId,
        userId,
        profileId: parsed.profileId,
        label: parsed.label,
        apiKey: parsed.apiKey,
        services: {
          notion: { authConfigId: parsed.notionAuthConfigId, enabled: true },
        },
      });
      res.json({ ok: true, profileId: profile.id });
    } catch (err) {
      if (err instanceof ComposioProfileError) {
        res.status(err.status).json({ error: err.code });
        return;
      }
      next(err);
    }
  });

  router.delete('/:profileId', async (req, res, next) => {
    try {
      await deleteProfile({
        workspaceId: req.workspace!.id,
        profileId: req.params.profileId,
      });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ComposioProfileError) {
        res.status(err.status).json({ error: err.code });
        return;
      }
      next(err);
    }
  });

  return router;
}

function parseUpsertBody(body: unknown): {
  profileId: string | null;
  label: string | null;
  apiKey: string;
  notionAuthConfigId: string;
} | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as {
    profileId?: unknown;
    label?: unknown;
    apiKey?: unknown;
    notionAuthConfigId?: unknown;
    services?: { notion?: { authConfigId?: unknown } };
  };
  const apiKey = cleanRequiredString(obj.apiKey, 512);
  const notionAuthConfigId = cleanRequiredString(
    obj.notionAuthConfigId ?? obj.services?.notion?.authConfigId,
    512,
  );
  if (!apiKey || !notionAuthConfigId) return null;
  const profileId = cleanOptionalString(obj.profileId, 80);
  const label = cleanOptionalString(obj.label, 80);
  return { profileId, label, apiKey, notionAuthConfigId };
}

function cleanRequiredString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function cleanOptionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return cleanRequiredString(value, max);
}
