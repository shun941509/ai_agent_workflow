import Studio from '../ui/Studio';
import { requirePageAccount } from '../server/page-account';
import type { PageQuery } from './account-navigation';

export default async function Page({searchParams}: {searchParams: Promise<PageQuery>}) {
  const user = await requirePageAccount('/', searchParams);
  return <Studio accountId={user.id} />;
}
