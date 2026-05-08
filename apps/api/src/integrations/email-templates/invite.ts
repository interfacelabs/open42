export interface InviteEmailInput {
  workspaceName: string;
  inviterEmail: string;
  inviteUrl: string;
}

export interface InviteEmailOutput {
  subject: string;
  html: string;
  text: string;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);

export function renderInviteEmail(input: InviteEmailInput): InviteEmailOutput {
  const ws = escapeHtml(input.workspaceName);
  const inviter = escapeHtml(input.inviterEmail);
  const url = input.inviteUrl;

  const subject = `${input.inviterEmail} invited you to ${input.workspaceName} on Open42`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#171717;background:#fff;">
  <div style="max-width:520px;margin:0 auto;">
    <p style="font-family:ui-monospace,monospace;font-size:13px;color:#737373;margin:0 0 24px;">open42</p>
    <h1 style="font-size:28px;font-weight:500;letter-spacing:-0.02em;margin:0 0 18px;color:#171717;">
      You've been invited to a brain.
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#404040;margin:0 0 18px;">
      ${inviter} added you to <strong>${ws}</strong>'s company brain on Open42 — a self-hostable place to ask your team's documentation what your team actually knows, with citations.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#1d4dff;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:500;">
        Accept invite →
      </a>
    </p>
    <p style="font-size:12px;color:#737373;line-height:1.6;margin:24px 0 0;">
      This link is valid for 24 hours. If you weren't expecting this invite, you can ignore this email — nothing happens until you click.
    </p>
  </div>
</body></html>`;

  const text = `You've been invited to a brain.

${input.inviterEmail} added you to ${input.workspaceName}'s company brain on Open42.

Accept your invite:
${url}

This link is valid for 24 hours. If you weren't expecting this, ignore the email.`;

  return { subject, html, text };
}
