import * as Linking from 'expo-linking';

const linkingConfig = {
  screens: {
    VerifyDeepLink: {
      path: 'sign_in',
    },
    InviteAccept: {
      path: 'invite/accept',
      alias: ['auth/invite/accept'],
    },
    Main: '',
  },
};

export const linking = {
  prefixes: [Linking.createURL('/'), 'open42://', 'https://open42.app'],
  config: linkingConfig,
};

export interface VerificationParams {
  token?: string;
  tokenHash?: string;
  accessToken?: string;
  refreshToken?: string;
  type?: string;
  email?: string;
  inviteId?: string;
  workspaceName?: string;
  inviterEmail?: string;
}

export function verificationParamsFromUrl(url: string): VerificationParams {
  const parsed = Linking.parse(url);
  const query = parsed.queryParams ?? {};
  const hashParams = parseHashParams(url);
  return verificationParamsFromSources(query, hashParams);
}

export function verificationParamsFromParams(params: unknown): VerificationParams {
  return verificationParamsFromSources(isParamRecord(params) ? params : {}, {});
}

export function normalizeDeepLinkPath(path: string): string {
  const separatorIndex = path.search(/[?#]/);
  const pathname = separatorIndex === -1 ? path : path.slice(0, separatorIndex);
  const suffix = separatorIndex === -1 ? '' : path.slice(separatorIndex);
  const normalizedPathname = pathname.replace(/^\/+|\/+$/g, '');
  if (normalizedPathname === 'auth/invite/accept') return `invite/accept${suffix}`;
  return path;
}

function verificationParamsFromSources(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>
): VerificationParams {
  const params: VerificationParams = {};
  setParam(params, 'token', sourceParam(primary, secondary, 'token'));
  setParam(params, 'tokenHash', sourceParam(primary, secondary, 'tokenHash', 'token_hash'));
  setParam(params, 'accessToken', sourceParam(primary, secondary, 'accessToken', 'access_token'));
  setParam(
    params,
    'refreshToken',
    sourceParam(primary, secondary, 'refreshToken', 'refresh_token')
  );
  setParam(params, 'type', sourceParam(primary, secondary, 'type'));
  setParam(params, 'email', sourceParam(primary, secondary, 'email'));
  setParam(params, 'inviteId', sourceParam(primary, secondary, 'inviteId', 'invite_id'));
  setParam(
    params,
    'workspaceName',
    sourceParam(primary, secondary, 'workspaceName', 'workspace_name')
  );
  setParam(
    params,
    'inviterEmail',
    sourceParam(primary, secondary, 'inviterEmail', 'inviter_email')
  );
  return params;
}

function sourceParam(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = stringParam(primary[key]);
    if (value) return value;
  }
  for (const key of keys) {
    const value = stringParam(secondary[key]);
    if (value) return value;
  }
  return undefined;
}

function setParam<K extends keyof VerificationParams>(
  params: VerificationParams,
  key: K,
  value: VerificationParams[K]
) {
  if (value) params[key] = value;
}

function parseHashParams(url: string): Record<string, string> {
  const hash = url.split('#')[1];
  if (!hash) return {};
  return Object.fromEntries(new URLSearchParams(hash));
}

function isParamRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringParam(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}
