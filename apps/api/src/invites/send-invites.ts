import pino from 'pino';

import { generateInviteLink as defaultGenerateInviteLink } from '../auth/supabase.js';
import { renderInviteEmail } from '../integrations/email-templates/invite.js';
import { sendEmail as defaultSendEmail } from '../integrations/resend.js';

const logger = pino({ name: 'invites/send', level: process.env.LOG_LEVEL ?? 'info' });

const INVITE_LIMIT = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendInvitesInput {
  workspaceId: string;
  workspaceName: string;
  inviterUserId: string;
  inviterEmail: string;
  emails: string[];
  role: 'admin' | 'member';
  webBaseUrl: string;
}

export interface InviteRow {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending';
  createdAt: Date;
}

export interface InviteSendResult {
  sent: number;
  failed: Array<{ email: string; reason: string }>;
  invites: InviteRow[];
}

export interface UpsertInvitesResult {
  invites: InviteRow[];
  failed: Array<{ email: string; reason: string }>;
}

export interface InviteSendDeps {
  generateInviteLink?: typeof defaultGenerateInviteLink;
  sendEmail?: typeof defaultSendEmail;
  /**
   * Upserts pending invites for the given (workspace, emails). The
   * implementation owns:
   *   - filtering out emails that match an existing member (push
   *     `{ reason: 'already_member' }` into `failed[]`),
   *   - filtering out self-invite emails (push `{ reason: 'cannot_invite_self' }`
   *     into `failed[]`),
   *   - upserting pending rows for the rest using the partial unique index
   *     on `(workspace_id, email) WHERE status='pending'`.
   *
   * The returned `failed[]` is concatenated with per-email send failures
   * downstream — callers receive a single merged `failed[]` from this helper.
   */
  upsertInvitesForWorkspace: (params: {
    workspaceId: string;
    inviterUserId: string;
    inviterEmail: string;
    emails: string[];
    role: 'admin' | 'member';
  }) => Promise<UpsertInvitesResult>;
}

function inviteError(code: string): Error & { status?: number; code?: string } {
  return Object.assign(new Error(code), { status: 400, code });
}

/**
 * Shared per-workspace invite-send pipeline. Owns validation, calls the
 * caller-provided `upsertInvitesForWorkspace` repo function, then iterates
 * the resulting rows to (a) generate a Supabase invite link, (b) render the
 * invite email, (c) deliver it via Resend. Per-email failures are collected
 * in `failed[]`; the rest of the batch proceeds.
 *
 * The send loop is sequential — Resend throttles cleanly at low concurrency
 * and the failure mode of one address blocking the next is easy to reason
 * about. Re-evaluate if invite batches grow past the current limit of 10.
 */
export async function sendInvitesForWorkspace(
  input: SendInvitesInput,
  deps: InviteSendDeps,
): Promise<InviteSendResult> {
  if (input.emails.length === 0) {
    throw inviteError('invite_emails_required');
  }
  if (input.emails.length > INVITE_LIMIT) {
    throw inviteError('invite_emails_too_many');
  }
  for (const email of input.emails) {
    if (!EMAIL_RE.test(email)) {
      throw inviteError('invite_emails_invalid');
    }
  }

  const generateLink = deps.generateInviteLink ?? defaultGenerateInviteLink;
  const send = deps.sendEmail ?? defaultSendEmail;

  const { invites, failed } = await deps.upsertInvitesForWorkspace({
    workspaceId: input.workspaceId,
    inviterUserId: input.inviterUserId,
    inviterEmail: input.inviterEmail,
    emails: input.emails,
    role: input.role,
  });

  const webBase = input.webBaseUrl.replace(/\/+$/, '');
  let sent = 0;
  for (const invite of invites) {
    try {
      const { actionLink } = await generateLink({
        email: invite.email,
        redirectTo: `${webBase}/auth/invite/accept?invite_id=${invite.id}`,
      });
      const rendered = renderInviteEmail({
        workspaceName: input.workspaceName,
        inviterEmail: input.inviterEmail,
        inviteUrl: actionLink,
      });
      const result = await send({
        to: invite.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (result.ok) {
        sent += 1;
        logger.info({ workspace_id: input.workspaceId, invite_id: invite.id }, 'invite_sent');
      } else {
        failed.push({ email: invite.email, reason: 'email_send_failed' });
        logger.warn(
          { workspace_id: input.workspaceId, invite_id: invite.id, err: result.error },
          'invite_email_failed',
        );
      }
    } catch (err) {
      failed.push({ email: invite.email, reason: 'invite_link_failed' });
      logger.warn(
        {
          workspace_id: input.workspaceId,
          invite_id: invite.id,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'invite_link_failed',
      );
    }
  }

  return { sent, failed, invites };
}
