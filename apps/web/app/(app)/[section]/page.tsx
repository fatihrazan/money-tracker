import { notFound } from 'next/navigation';
import { Workspace } from '../../../components/workspace';
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!['dashboard', 'transactions', 'accounts', 'categories', 'budgets'].includes(section))
    notFound();
  return <Workspace section={section} />;
}
