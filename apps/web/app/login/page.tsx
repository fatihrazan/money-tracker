import { AuthForm } from '../../components/auth-form';
import { googleConfigured } from '../../lib/google';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ google_error?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthForm googleEnabled={googleConfigured()} googleError={params.google_error?.slice(0, 300)} />
  );
}
