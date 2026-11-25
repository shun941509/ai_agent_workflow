import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AccountEntry from '../../ui/AccountEntry';
import { guestWorkSummary } from '../../server/guest-work';
import { pageSession } from '../../server/page-account';
import { workspaceReturnTo, type PageQuery } from '../account-navigation';

export const metadata: Metadata = { title: '로그인 · Workflow Studio', referrer: 'no-referrer' };

export default async function LoginPage({searchParams}: {searchParams: Promise<PageQuery>}) {
  const session = await pageSession();
  const returnTo = workspaceReturnTo((await searchParams).returnTo);
  if (session?.user.login) redirect(returnTo);
  // SQLite returns null-prototype rows. Pass a plain object to the client form.
  const guestWork = session ? {...guestWorkSummary(session.user.id)} : null;
  return <AccountEntry returnTo={returnTo} guestWork={guestWork} />;
}
