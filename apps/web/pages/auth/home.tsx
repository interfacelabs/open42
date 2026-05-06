import Head from 'next/head';

import { BrainStatus } from '@/components/BrainStatus';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Home - Open42</title>
      </Head>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 px-10 py-10">
          <div className="max-w-4xl">
            <BrainStatus
              pagesCount={0}
              recentQueries={['What is our enterprise refund policy?']}
              exportedSkills={[]}
            />
          </div>
        </main>
        <QuickSwitcher />
      </div>
    </>
  );
}
