import { expect, it } from 'vitest';

import {
  linking,
  normalizeDeepLinkPath,
  verificationParamsFromParams,
  verificationParamsFromUrl,
} from './deepLinks';

it('parses production universal links and invite metadata', () => {
  expect(linking.prefixes).toContain('https://open42.app');

  expect(
    verificationParamsFromUrl(
      'https://open42.app/auth/invite/accept?invite_id=inv-1&token_hash=hash&type=invite&workspace_name=Open42&inviter_email=founder%40open42.test'
    )
  ).toEqual({
    inviteId: 'inv-1',
    inviterEmail: 'founder@open42.test',
    tokenHash: 'hash',
    type: 'invite',
    workspaceName: 'Open42',
  });
});

it('routes both invite URL shapes to the invite accept screen', () => {
  expect(normalizeDeepLinkPath('/auth/invite/accept?invite_id=inv-1')).toBe(
    'invite/accept?invite_id=inv-1'
  );
  expect(normalizeDeepLinkPath('/invite/accept?invite_id=inv-1')).toBe(
    '/invite/accept?invite_id=inv-1'
  );
  expect(linking.config.screens.InviteAccept).toMatchObject({
    path: 'invite/accept',
    alias: ['auth/invite/accept'],
  });
});

it('normalizes warm-link route params from React Navigation', () => {
  expect(
    verificationParamsFromParams({
      access_token: 'access-token',
      invite_id: 'inv-1',
      inviter_email: 'founder@open42.test',
      refresh_token: 'refresh-token',
      token_hash: 'hash',
      type: 'invite',
      workspace_name: 'Open42',
    })
  ).toEqual({
    accessToken: 'access-token',
    inviteId: 'inv-1',
    inviterEmail: 'founder@open42.test',
    refreshToken: 'refresh-token',
    tokenHash: 'hash',
    type: 'invite',
    workspaceName: 'Open42',
  });
});

it('keeps universal-link query params ahead of hash params', () => {
  expect(
    verificationParamsFromUrl(
      'https://open42.app/sign_in?token_hash=query-hash#token_hash=hash-hash&access_token=hash-access'
    )
  ).toEqual({
    accessToken: 'hash-access',
    tokenHash: 'query-hash',
  });
});
