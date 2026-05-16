export const OPEN42_MANAGED_PROFILE_ID = 'open42-managed';

export type ConnectorAuthProfileMode = 'open42_managed' | 'byok';

export interface ConnectorAuthProfileService {
  serviceId: string;
  configured: boolean;
  enabled: boolean;
}

export interface ConnectorAuthProfile {
  id: string;
  mode: ConnectorAuthProfileMode;
  label: string;
  services: ConnectorAuthProfileService[];
  revokedAt?: string | null;
}

export interface ConnectorAuthProfilesPayload {
  profiles: ConnectorAuthProfile[];
}

export function activeConnectorProfiles(
  profiles: ConnectorAuthProfile[] | undefined,
): ConnectorAuthProfile[] {
  return (profiles ?? []).filter((profile) => !profile.revokedAt);
}

export function profileSupportsService(
  profile: ConnectorAuthProfile,
  serviceId: string,
): boolean {
  return profile.services.some(
    (service) =>
      service.serviceId === serviceId && service.configured && service.enabled,
  );
}

export function connectorProfilesForService(
  profiles: ConnectorAuthProfile[] | undefined,
  serviceId: string,
): ConnectorAuthProfile[] {
  return activeConnectorProfiles(profiles).filter((profile) =>
    profileSupportsService(profile, serviceId),
  );
}

export function authProfileIdForRequest(
  profileId: string | null | undefined,
): string | undefined {
  if (!profileId || profileId === OPEN42_MANAGED_PROFILE_ID) return undefined;
  return profileId;
}

export function profileModeLabel(mode: ConnectorAuthProfileMode): string {
  return mode === 'open42_managed' ? 'Open42 managed' : 'My Composio account';
}
