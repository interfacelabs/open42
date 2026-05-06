import type { GetServerSideProps } from 'next';

export default function ProductRoot() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/sign_in',
    permanent: false,
  },
});
