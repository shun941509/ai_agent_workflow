import Studio from '../ui/Studio';
import type { Metadata } from 'next';
import { requirePageAccount } from '../server/page-account';
import type { PageQuery } from './account-navigation';

export const metadata: Metadata = { title: '작업실 홈 · Workflow Studio' };

export default async function Page({searchParams}: {searchParams: Promise<PageQuery>}) {
  const user = await requirePageAccount('/', searchParams);
  return <Studio accountId={user.id} />;
}
