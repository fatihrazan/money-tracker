import { telegramApi } from '../apps/web/lib/telegram';

async function main() {
  const status = process.argv.includes('--status');
  const remove = process.argv.includes('--delete');
  if (status && remove) throw new Error('Choose --status or --delete.');
  const info = await telegramApi<{ username: string }>('getMe', {});
  if (info.username.toLowerCase() !== process.env.TELEGRAM_BOT_USERNAME?.toLowerCase())
    throw new Error('Bot username and token do not match.');
  if (!status && !remove) {
    const origin = new URL(process.env.APP_ORIGIN ?? '');
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== process.env.APP_ORIGIN ||
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    )
      throw new Error('APP_ORIGIN must be a public HTTPS origin without a path or trailing slash.');
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret) || process.env.TELEGRAM_TRANSPORT !== 'webhook')
      throw new Error('Configure webhook transport and a strong TELEGRAM_WEBHOOK_SECRET.');
    // Check that the deployed application accepts this secret before moving the bot.
    const probe = await fetch(`${origin.origin}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    if (probe.status !== 400 || (await probe.json()).error !== 'Invalid update')
      throw new Error(
        'Deploy the webhook endpoint with matching runtime environment variables first.',
      );
    await telegramApi('setWebhook', {
      url: `${origin.origin}/api/telegram/webhook`,
      secret_token: secret,
      max_connections: 1,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    console.log('Webhook registered; pending Telegram updates were retained.');
  } else if (remove) {
    await telegramApi('deleteWebhook', { drop_pending_updates: false });
    console.log('Webhook removed; pending Telegram updates were retained.');
  }
  const result = await telegramApi<{
    url: string;
    pending_update_count: number;
    last_error_date?: number;
  }>('getWebhookInfo', {});
  console.log(
    JSON.stringify(
      {
        url: result.url,
        pending_updates: result.pending_update_count,
        has_delivery_error: Boolean(result.last_error_date),
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error(
    'Webhook setup failed. Check the production URL, deployment, bot configuration and network. Credentials were not printed.',
  );
  process.exitCode = 1;
});
