import { describe, expect, it } from 'vitest';

import { renderInviteEmail } from './invite.js';

describe('renderInviteEmail', () => {
  const input = {
    workspaceName: 'Speedrun Labs',
    inviterEmail: 'riccardo@speedrunlabs.com',
    inviteUrl: 'https://open42.app/auth/invite/accept?invite_id=abc123&token_hash=xyz',
  };

  it('returns html, text, and subject containing the workspace name and invite URL', () => {
    const out = renderInviteEmail(input);
    expect(out.html).toContain('Speedrun Labs');
    expect(out.html).toContain(input.inviteUrl);
    expect(out.text).toContain('Speedrun Labs');
    expect(out.text).toContain(input.inviteUrl);
    expect(out.subject).toContain('Speedrun Labs');
  });

  it('html-escapes potentially-dangerous workspace names', () => {
    const out = renderInviteEmail({ ...input, workspaceName: '<script>x</script>' });
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});
