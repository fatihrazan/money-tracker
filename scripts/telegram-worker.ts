import { pool, query } from '@money/database';
import { telegramApi, telegramBotId, handleTelegramUpdate } from '../apps/web/lib/telegram';
import { deliverTelegramReply } from '../apps/web/lib/telegram-delivery';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
async function main() {
  if (process.env.TELEGRAM_TRANSPORT === 'webhook')
    throw new Error('Webhook mode is active; do not start a polling worker.');
  const bot = telegramBotId();
  const lock = await pool().connect();
  try {
    const acquired = await lock.query('SELECT pg_try_advisory_lock(68210453) acquired');
    if (!acquired.rows[0].acquired) throw new Error('A Telegram worker is already running.');
    const info = await telegramApi<{ username: string }>('getMe', {});
    if (info.username.toLowerCase() !== process.env.TELEGRAM_BOT_USERNAME!.toLowerCase())
      throw new Error('TELEGRAM_BOT_USERNAME does not match the token.');
    const webhook = await telegramApi<{ url: string }>('getWebhookInfo', {});
    if (webhook.url) throw new Error('Bot has a webhook. Remove it before using long polling.');
    await query('INSERT INTO telegram_polling(bot_id) VALUES($1) ON CONFLICT DO NOTHING', [bot]);
    console.log('Telegram worker ready. Press Ctrl+C to stop.');
    while (!stopping) {
      try {
        const [state] = await query('SELECT next_offset FROM telegram_polling WHERE bot_id=$1', [
          bot,
        ]);
        const updates = await telegramApi<{ update_id: number }[]>(
          'getUpdates',
          {
            offset: state.next_offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query'],
          },
          45000,
        );
        for (const update of updates) {
          if (stopping) break;
          const reply = await handleTelegramUpdate(update);
          await deliverTelegramReply(reply);
          await query('UPDATE telegram_polling SET next_offset=$2 WHERE bot_id=$1', [
            bot,
            update.update_id + 1,
          ]);
        }
      } catch {
        console.error(
          'Telegram polling failed; retrying in 5 seconds. Check network, bot access, and database.',
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(68210453)');
    lock.release();
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Telegram worker failed.');
    process.exitCode = 1;
  })
  .finally(() => pool().end());
