import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginAddress, workspaceAddress, type PageQuery } from '../app/account-navigation';
import { lookupSession } from './auth';

export async function pageSession() {
  return lookupSession((await cookies()).toString());
}

export async function requirePageAccount(path: string, query: Promise<PageQuery>) {
  const session = await pageSession();
  if (!session?.user.login) redirect(loginAddress(workspaceAddress(path, await query)));
  return session.user;
}
