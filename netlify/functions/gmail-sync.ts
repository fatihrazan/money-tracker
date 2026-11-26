import { syncAllGmail } from '../../apps/web/lib/gmail';

// Scheduled by netlify.toml; scheduled functions do not accept public HTTP requests.
export default async function handler() {
  if (process.env.GMAIL_SCHEDULE_ENABLED !== 'true') return new Response(null, { status: 204 });
  await syncAllGmail({ budgetMs: 20000 });
  return new Response(null, { status: 204 });
}
