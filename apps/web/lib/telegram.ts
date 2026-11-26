import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { atomic, query, type PoolClient } from '@money/database';
import { rupiah, today, type Account, type Category } from '@money/core';
import {
  parseTelegramTransaction,
  telegramHelp,
  understandTelegramText,
  NaturalInputError,
  type NaturalConversation,
} from '@money/core/telegram';
import { digest, HttpError } from './auth';
import { saveTransactionWithClient } from './finance';

export function telegramConfigured() {
  return (
    /^\d+:[A-Za-z0-9_-]+$/.test(process.env.TELEGRAM_BOT_TOKEN ?? '') &&
    /^[A-Za-z0-9_]{5,32}$/.test(process.env.TELEGRAM_BOT_USERNAME ?? '')
  );
}
export function telegramBotId() {
  if (!telegramConfigured()) throw new HttpError(503, 'Bot Telegram belum dikonfigurasi.');
  return process.env.TELEGRAM_BOT_TOKEN!.split(':')[0];
}
export async function telegramStatus(uid: string) {
  const [link] = await query('SELECT linked_at FROM telegram_links WHERE user_id=$1', [uid]);
  return {
    configured: telegramConfigured(),
    connected: Boolean(link),
    linked_at: link?.linked_at ?? null,
    username: process.env.TELEGRAM_BOT_USERNAME ?? null,
  };
}
export async function createTelegramLink(uid: string) {
  telegramBotId();
  const code = randomBytes(24).toString('hex');
  await query(
    `INSERT INTO telegram_link_codes(code_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')
 ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at`,
    [digest(code), uid],
  );
  return { url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${code}` };
}
export async function disconnectTelegram(uid: string) {
  await atomic(async (client) => {
    // Serialize revocation with in-flight bot writes and pairing.
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [uid]);
    await client.query('DELETE FROM telegram_links WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM telegram_link_codes WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM telegram_drafts WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM telegram_conversations WHERE user_id=$1', [uid]);
  });
  return { message: 'Telegram diputus.' };
}
const actor = z.object({ id: z.number().int().positive().safe(), is_bot: z.boolean().optional() });
const message = z.object({
  from: actor.optional(),
  chat: z.object({ id: z.number().int().safe(), type: z.string() }),
  text: z.string().max(4096).optional(),
});
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: message.optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: actor,
      data: z.string().optional(),
      message: message.optional(),
    })
    .optional(),
});
export type TelegramReply = {
  chat_id: number;
  text: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
  callback_id?: string;
} | null;

async function processMessage(
  client: PoolClient,
  input: z.infer<typeof telegramUpdateSchema>,
): Promise<TelegramReply> {
  const callback = input.callback_query;
  const msg = callback?.message ?? input.message;
  const from = callback?.from ?? msg?.from;
  if (!msg || !from || from.is_bot || msg.chat.type !== 'private' || msg.chat.id !== from.id)
    return null;
  const respond = (text: string): NonNullable<TelegramReply> => ({
    chat_id: msg.chat.id,
    text,
    ...(callback ? { callback_id: callback.id } : {}),
  });
  const text = (msg.text ?? '').trim();
  if (!callback && /^\/start(?:@[A-Za-z0-9_]+)? [a-f0-9]{48}$/.test(text)) {
    const hash = digest(text.split(' ')[1]);
    const code = (
      await client.query(
        'SELECT user_id FROM telegram_link_codes WHERE code_hash=$1 AND expires_at>now()',
        [hash],
      )
    ).rows[0];
    if (!code)
      return respond(
        'Tautan kedaluwarsa atau sudah dipakai. Buat tautan baru dari menu Integrasi web.',
      );
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [code.user_id]);
    const consumed = await client.query(
      'DELETE FROM telegram_link_codes WHERE code_hash=$1 AND expires_at>now() RETURNING user_id',
      [hash],
    );
    if (!consumed.rowCount) return respond('Tautan tidak berlaku. Buat tautan baru di web.');
    const existing = await client.query(
      'SELECT 1 FROM telegram_links WHERE user_id=$1 OR telegram_id=$2',
      [code.user_id, from.id],
    );
    if (existing.rowCount)
      return respond(
        'Akun sudah terhubung. Putuskan koneksi lama lewat web sebelum menautkan kembali.',
      );
    await client.query('INSERT INTO telegram_links(user_id,telegram_id,chat_id) VALUES($1,$2,$2)', [
      code.user_id,
      from.id,
    ]);
    return respond(`Telegram terhubung.\n${telegramHelp}`);
  }
  const link = (
    await client.query('SELECT user_id FROM telegram_links WHERE telegram_id=$1 AND chat_id=$2', [
      from.id,
      msg.chat.id,
    ])
  ).rows[0];
  if (!link) return respond('Hubungkan akun melalui menu Integrasi di web terlebih dahulu.');
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [link.user_id]);
  const stillLinked = await client.query(
    'SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id=$2',
    [link.user_id, from.id],
  );
  if (!stillLinked.rowCount)
    return respond('Koneksi telah diputus. Hubungkan kembali melalui web.');
  if (callback) {
    const action = /^(save|cancel):([a-f0-9-]{36})$/.exec(callback.data ?? '');
    if (!action || !z.uuid().safeParse(action[2]).success) return respond('Tombol tidak valid.');
    const draft = (
      await client.query(
        'DELETE FROM telegram_drafts WHERE id=$1 AND user_id=$2 AND telegram_id=$3 AND expires_at>now() RETURNING payload',
        [action[2], link.user_id, from.id],
      )
    ).rows[0];
    if (!draft) return respond('Draf sudah diproses atau kedaluwarsa.');
    if (action[1] === 'cancel') return respond('Draf dibatalkan.');
    const result = await saveTransactionWithClient(client, link.user_id, draft.payload);
    return respond([result.message, ...result.warnings].join('\n'));
  }
  if (/^\/(start|bantuan|help)(?:@[A-Za-z0-9_]+)?$/.test(text)) return respond(telegramHelp);
  if (/^(?:\/(?:batal|cancel|baru)(?:@[A-Za-z0-9_]+)?|batal|batalkan)$/i.test(text)) {
    await client.query('DELETE FROM telegram_conversations WHERE user_id=$1', [link.user_id]);
    await client.query('DELETE FROM telegram_drafts WHERE user_id=$1', [link.user_id]);
    return respond(
      'Percakapan dan draf yang belum disimpan dibatalkan. Ceritakan transaksi baru, misalnya: makan siang 25 ribu pakai BCA.',
    );
  }
  const accounts = (
    await client.query<Account>(
      'SELECT * FROM accounts WHERE user_id=$1 AND archived=false ORDER BY name',
      [link.user_id],
    )
  ).rows;
  const categories = (
    await client.query<Category>('SELECT * FROM categories WHERE user_id=$1 ORDER BY kind,name', [
      link.user_id,
    ])
  ).rows;
  if (/^\/akun(?:@[A-Za-z0-9_]+)?$/.test(text))
    return respond(('Akun aktif:\n' + accounts.map((a) => a.name).join('\n')).slice(0, 4000));
  if (/^\/kategori(?:@[A-Za-z0-9_]+)?$/.test(text))
    return respond(
      (
        'Kategori:\n' +
        categories.map((c) => `${c.kind === 'expense' ? 'Keluar' : 'Masuk'}: ${c.name}`).join('\n')
      ).slice(0, 4000),
    );
  if (text.startsWith('/') && !/^\/(keluar|masuk|transfer)(?:@[A-Za-z0-9_]+)?\s/i.test(text))
    return respond(telegramHelp);
  const date = today(process.env.APP_TIMEZONE);
  let parsed;
  if (/^\/(keluar|masuk|transfer)(?:@[A-Za-z0-9_]+)?\s/i.test(text) && text.includes('|')) {
    parsed = parseTelegramTransaction(text, accounts, categories, date);
  } else {
    await client.query('DELETE FROM telegram_conversations WHERE user_id=$1 AND expires_at<now()', [
      link.user_id,
    ]);
    const previous = (
      await client.query<{ state: NaturalConversation }>(
        'SELECT state FROM telegram_conversations WHERE user_id=$1 AND telegram_id=$2 AND expires_at>now()',
        [link.user_id, from.id],
      )
    ).rows[0];
    const natural = understandTelegramText(text, accounts, categories, date, previous?.state);
    if (!natural.parsed) {
      await client.query(
        `INSERT INTO telegram_conversations(user_id,telegram_id,state,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET telegram_id=EXCLUDED.telegram_id,state=EXCLUDED.state,expires_at=EXCLUDED.expires_at`,
        [link.user_id, from.id, natural.state],
      );
      return respond(
        `${natural.question}\nKetik /batal untuk membatalkan, atau /baru untuk transaksi lain.`,
      );
    }
    parsed = natural.parsed;
  }
  await client.query('DELETE FROM telegram_conversations WHERE user_id=$1', [link.user_id]);
  await client.query('DELETE FROM telegram_drafts WHERE user_id=$1 AND expires_at<now()', [
    link.user_id,
  ]);
  const draft = (
    await client.query(
      `INSERT INTO telegram_drafts(user_id,telegram_id,payload,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') RETURNING id`,
      [link.user_id, from.id, parsed.payload],
    )
  ).rows[0];
  const p = parsed.payload;
  return {
    ...respond(
      `${p.kind === 'transfer' ? 'Transfer' : p.kind === 'expense' ? 'Pengeluaran' : 'Pemasukan'} ${rupiah(p.amount)}\n${parsed.account} -> ${parsed.target}\nTanggal: ${p.date}\nCatatan: ${p.note || '-'}${p.kind === 'transfer' ? `\nBiaya admin: ${rupiah(p.fee)}` : ''}\nSimpan transaksi ini?`,
    ),
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Simpan', callback_data: `save:${draft.id}` },
          { text: 'Batal', callback_data: `cancel:${draft.id}` },
        ],
      ],
    },
  };
}
export async function handleTelegramUpdate(raw: unknown): Promise<TelegramReply> {
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid Telegram update');
  const input = parsed.data;
  const bot = telegramBotId();
  return atomic(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(68210452)');
    const prior = (
      await client.query('SELECT reply FROM telegram_updates WHERE bot_id=$1 AND update_id=$2', [
        bot,
        input.update_id,
      ])
    ).rows[0];
    if (prior) return prior.reply;
    await client.query('SAVEPOINT telegram_action');
    let reply: TelegramReply;
    try {
      reply = await processMessage(client, input);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT telegram_action');
      const msg = input.callback_query?.message ?? input.message;
      const from = input.callback_query?.from ?? msg?.from;
      if (!msg || !from || msg.chat.type !== 'private' || msg.chat.id !== from.id) reply = null;
      else {
        if (
          !(error instanceof z.ZodError) &&
          !(error instanceof HttpError) &&
          !(error instanceof NaturalInputError) &&
          !(error instanceof Error && /^(Perintah|Format|Akun|Kategori)/.test(error.message))
        )
          throw error;
        reply = {
          chat_id: msg.chat.id,
          text:
            error instanceof z.ZodError
              ? error.issues.map((i) => i.message).join(' ')
              : error.message,
          ...(input.callback_query ? { callback_id: input.callback_query.id } : {}),
        };
      }
    }
    await client.query(
      'INSERT INTO telegram_updates(bot_id,update_id,reply) VALUES($1,$2,$3::jsonb)',
      [bot, input.update_id, JSON.stringify(reply)],
    );
    return reply;
  });
}

export async function telegramApi<T>(method: string, body: unknown, timeoutMs = 15000): Promise<T> {
  telegramBotId();
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const result = (await response.json()) as { ok: boolean; result: T };
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed (${response.status})`);
  return result.result;
}
