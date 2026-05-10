/**
 * Back-compat redirect.
 *
 * The dashboard moved from /auth/home to / as part of the onboarding/dashboard
 * routing rework. Keep this route as a 308 server redirect so any in-flight
 * deep link, bookmark, or external integration that still points at
 * /auth/home (composio callbacks, invite emails, old e2e tests, etc.) lands
 * on the new canonical URL without a flash of empty UI.
 *
 * Once every internal link is verified migrated, this file can be deleted.
 */
import type { GetServerSideProps } from 'next';

export default function AuthHomeRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/', permanent: false },
});
