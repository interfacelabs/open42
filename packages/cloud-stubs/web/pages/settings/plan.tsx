import type { GetServerSideProps } from 'next';

export default function PlanSettingsStub() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => ({
  notFound: true,
});
