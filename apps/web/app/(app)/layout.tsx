import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME, sessionUser } from '../../lib/auth';
import { AppShell } from '../../components/shell';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await sessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect('/login');
  return <AppShell username={user.username}>{children}</AppShell>;
}
