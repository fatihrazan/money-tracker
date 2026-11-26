import { Integrations } from '../../../components/integrations';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ google_error?: string; google?: string }>;
}) {
  const params = await searchParams;
  return (
    <Integrations
      googleError={params.google_error?.slice(0, 300)}
      connected={params.google === 'connected'}
    />
  );
}
