export function humanizeError(code?: string | null): string {
  switch (code) {
    case 'email_invalid':
      return 'Enter a valid email address.';
    case 'signin_rate_limited':
      return 'Wait a moment before requesting another code.';
    case 'signin_not_allowed':
      return 'This email is not allowed to sign in.';
    case 'supabase_not_configured':
      return 'Sign-in is not configured on this server.';
    case 'supabase_verify_failed':
    case 'magic_link_invalid':
    case 'verify_failed':
      return 'That code or link did not verify.';
    case 'workspace_name_invalid':
      return 'Use a workspace name between 1 and 80 characters.';
    case 'invite_emails_invalid':
      return 'Check the invite email addresses.';
    case 'invite_not_found':
      return 'That invite could not be found.';
    case 'invite_revoked':
      return 'That invite has been revoked.';
    case 'invite_expired':
      return 'That invite has expired.';
    case 'invite_already_accepted':
      return 'That invite has already been accepted.';
    case 'invite_email_mismatch':
      return 'This invite is for a different email.';
    case 'workspace_not_found':
      return 'That workspace could not be found.';
    case 'workspace_not_ready':
    case 'workspace_gbrain_not_ready':
      return 'This workspace is still starting up.';
    case 'chat_provider_error':
    case 'provider_request_failed':
    case 'provider_stream_failed':
      return 'The model could not finish that answer.';
    case 'chat_body_too_large':
      return 'That thread is too large to send.';
    case 'upstream_key_unconfigured':
      return 'No model key is configured for this workspace.';
    case 'chat_rate_limited':
    case 'chat_budget_exceeded':
      return 'This workspace has hit its chat budget.';
    case 'share_link_rate_limited':
      return 'Share links are rate limited. Try again shortly.';
    case 'skill_generation_failed':
      return 'The brain could not generate that skill.';
    case 'skill_generation_timeout':
      return 'Skill generation took too long. Try again.';
    case 'skill_not_found':
      return 'That skill could not be found.';
    case 'invalid_api_key':
      return 'Check the key and try again.';
    case 'invalid_model':
      return 'Use a valid model name or leave it blank.';
    case 'invalid_provider_scope':
      return 'Choose a valid provider and scope.';
    case 'unsupported_provider_scope':
      return 'That provider does not support this scope.';
    case 'forbidden_owner_only':
      return 'Only workspace owners can manage this.';
    case 'forbidden_cannot_manage_mcp_proxy':
      return 'Only workspace owners and admins can manage MCP.';
    case 'mcp_proxy_disabled':
      return 'Enable the MCP proxy before creating credentials.';
    case 'mcp_proxy_domain_not_configured':
      return 'MCP is not configured on this server.';
    case 'mcp_client_already_issued':
      return 'You already have active MCP credentials.';
    case 'client_name_invalid':
      return 'Use a client name between 1 and 80 characters.';
    case 'client_scope_invalid':
      return 'Use read or read write for the client scope.';
    case 'network_error':
      return 'Could not reach Open42. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export function apiErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'network_error';
}
