import { telegramApi, type TelegramReply } from './telegram';

export async function deliverTelegramReply(reply: TelegramReply) {
  if (!reply) return;
  if (reply.callback_id) {
    try {
      await telegramApi('answerCallbackQuery', { callback_query_id: reply.callback_id }, 3000);
    } catch {
      // Callback acknowledgements expire; the persisted result must still be delivered.
    }
  }
  const { callback_id, ...message } = reply;
  await telegramApi('sendMessage', message);
}
