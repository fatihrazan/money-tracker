import { telegramUpdateSchema, handleTelegramUpdate } from '../../../../lib/telegram';
import { deliverTelegramReply } from '../../../../lib/telegram-delivery';
import { readLimitedJson, secretMatches } from '../../../../lib/server-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (process.env.TELEGRAM_TRANSPORT !== 'webhook' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
    return json({ error: 'Webhook unavailable' }, 503);
  if (!secretMatches(secret, request.headers.get('x-telegram-bot-api-secret-token')))
    return json({ error: 'Unauthorized' }, 401);
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    return json({ error: 'Expected JSON' }, 415);
  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return json({ error: 'Invalid request' }, error instanceof RangeError ? 413 : 400);
  }
  const input = telegramUpdateSchema.safeParse(body);
  if (!input.success) return json({ error: 'Invalid update' }, 400);
  try {
    // Acknowledge only after commit and delivery. Telegram retries reuse the persisted receipt.
    const reply = await handleTelegramUpdate(input.data);
    await deliverTelegramReply(reply);
    return json({ ok: true });
  } catch {
    // Never expose bot credentials, request contents, or database errors.
    console.error('Telegram webhook processing failed; awaiting retry.');
    return json({ error: 'Temporarily unavailable' }, 503);
  }
}
