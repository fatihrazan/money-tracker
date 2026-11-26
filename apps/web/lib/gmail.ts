import { convert } from 'html-to-text';
import { atomic, query } from '@money/database';
import { randomUUID } from 'node:crypto';
import { parseBankEmail, type EmailRule } from '@money/core/email-transactions';
import { digest, HttpError } from './auth';
import { decryptRefreshToken, googleClient, gmailConfigured } from './google';
import { saveTransactionWithClient } from './finance';

type Header = { name: string; value: string };
type Part = {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size?: number };
  parts?: Part[];
};
export type GmailMessage = {
  id: string;
  internalDate: string;
  labelIds?: string[];
  payload?: Part;
};
type Connection = {
  user_id: string;
  subject: string;
  refresh_token_encrypted: string | null;
  enabled: boolean;
  sync_from: Date;
  last_synced_at: Date | null;
  scan_query: string | null;
  scan_until: Date | null;
  page_token: string | null;
};
export type GmailApi = <T>(path: string, params?: Record<string, string>) => Promise<T>;

function header(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ''
  );
}
export function messageContent(message: GmailMessage) {
  const from = header(message, 'From');
  const addresses =
    from.match(/[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  const sender = addresses.length === 1 ? addresses[0].toLowerCase() : '';
  const subject = header(message, 'Subject');
  function decode(part: Part | undefined, depth = 0): string {
    if (!part || depth > 12 || part.filename || (part.body?.size ?? 0) > 150000) return '';
    if (part.parts) {
      if (part.mimeType === 'multipart/alternative') {
        const plain = part.parts.find((child) => child.mimeType === 'text/plain');
        const text = decode(plain, depth + 1);
        return text.trim()
          ? text
          : decode(
              part.parts.find((child) => child.mimeType === 'text/html'),
              depth + 1,
            );
      }
      return part.parts
        .map((child) => decode(child, depth + 1))
        .join('\n')
        .slice(0, 150001);
    }
    if (!part.body?.data || part.body.data.length > 220000) return '';
    const contentType =
      part.headers?.find((item) => item.name.toLowerCase() === 'content-type')?.value ?? '';
    const charset = /charset=["']?([^;"'\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
    if (charset && !['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(charset)) return '';
    const content = Buffer.from(part.body.data, 'base64url').toString('utf8');
    if (part.mimeType === 'text/plain') return content;
    if (part.mimeType === 'text/html')
      return convert(content, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'table', options: { uppercaseHeaderCells: false } },
          // Email layout tables otherwise concatenate cells (Tanggal31 Okt...).
          // Blocks keep label/value boundaries even in nested layout tables.
          {
            selector: 'tr',
            format: 'block',
            options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
          },
          {
            selector: 'td',
            format: 'block',
            options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
          },
          {
            selector: 'th',
            format: 'block',
            options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
          },
        ],
      });
    return '';
  }
  const body = decode(message.payload);
  // Use the first Authentication-Results header, prepended by the receiving server.
  // Later copies can have been supplied by the sender; never search them for a pass.
  const auth = header(message, 'Authentication-Results').replace(/\r?\n\s*/g, ' ');
  const fromDomain = sender.split('@')[1];
  const dmarcDomain = /\bdmarc=pass\b[^;]*?\bheader\.from=([^;\s]+)/i
    .exec(auth)?.[1]
    ?.toLowerCase();
  const authenticated =
    /^mx\.google\.com\s*;/i.test(auth.trim()) &&
    Boolean(
      fromDomain &&
      dmarcDomain &&
      (fromDomain === dmarcDomain || fromDomain.endsWith(`.${dmarcDomain}`)),
    );
  return { sender, subject, body, authenticated };
}

export async function importGmailMessage(
  uid: string,
  googleSubject: string,
  message: GmailMessage,
) {
  const received = new Date(Number(message.internalDate));
  if (!message.id || !Number.isFinite(received.valueOf())) throw new Error('Invalid Gmail message');
  return atomic(async (client) => {
    // Serialize with pause/disconnect and competing imports. The receipt survives transaction deletion.
    const connection = (
      await client.query<Connection>(
        'SELECT * FROM gmail_connections WHERE user_id=$1 AND subject=$2 FOR UPDATE',
        [uid, googleSubject],
      )
    ).rows[0];
    if (!connection?.enabled || !connection.refresh_token_encrypted) return 'inactive';
    if (received < connection.sync_from) return 'old';
    if (
      (
        await client.query(
          'SELECT 1 FROM gmail_imports WHERE user_id=$1 AND google_subject=$2 AND message_id=$3',
          [uid, googleSubject, message.id],
        )
      ).rowCount
    )
      return 'seen';
    const content = messageContent(message);
    const rules = (
      await client.query<Omit<EmailRule, 'created_at'> & { created_at: Date }>(
        'SELECT * FROM gmail_rules WHERE user_id=$1 AND enabled=true FOR SHARE',
        [uid],
      )
    ).rows;
    const matches = rules.filter(
      (rule) =>
        rule.sender === content.sender &&
        content.subject.toLowerCase().includes(rule.subject_contains.toLowerCase()) &&
        content.body.toLowerCase().includes(rule.body_contains.toLowerCase()) &&
        received >= new Date(rule.created_at),
    );
    // Unrelated email is neither retained nor logged.
    if (!matches.length) return 'unmatched';
    const rule = matches.length === 1 ? matches[0] : undefined;
    async function record(
      status: string,
      reason: string,
      transactionId: string | null = null,
      eventKey: string | null = null,
    ) {
      await client.query(
        `INSERT INTO gmail_imports(user_id,google_subject,message_id,rule_id,transaction_id,event_key,status,reason,received_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          uid,
          googleSubject,
          message.id,
          rule?.id ?? null,
          transactionId,
          eventKey,
          status,
          reason,
          received,
        ],
      );
      return status;
    }
    if (!rule) return record('skipped', 'Beberapa aturan cocok. Buat aturan yang lebih spesifik.');
    if (message.labelIds?.some((label) => ['SPAM', 'TRASH', 'SENT', 'DRAFT'].includes(label)))
      return record('skipped', 'Email bukan notifikasi masuk yang valid.');
    if (!content.authenticated)
      return record('skipped', 'Autentikasi pengirim bank belum dapat diverifikasi.');
    const parsed = parseBankEmail(content.subject, content.body, rule.kind);
    if (!parsed.ok) return record('skipped', parsed.reason);
    const eventKey = digest(`${content.sender}|${parsed.reference}|${parsed.date}`);
    if (
      (
        await client.query('SELECT 1 FROM gmail_imports WHERE user_id=$1 AND event_key=$2', [
          uid,
          eventKey,
        ])
      ).rowCount
    )
      return record('duplicate', 'Nomor referensi transaksi sudah pernah dicatat.');
    // A changed/archived mapping is a durable skip, not a retry that blocks other emails.
    await client.query('SAVEPOINT gmail_transaction');
    try {
      const result = await saveTransactionWithClient(client, uid, {
        kind: rule.kind,
        amount: parsed.amount,
        fee: parsed.fee,
        date: parsed.date,
        account_id: rule.account_id,
        to_account_id: rule.to_account_id,
        category_id: rule.category_id,
        note: `Email bank · ${rule.name}`.slice(0, 200),
      });
      await client.query(
        "UPDATE transactions SET source='gmail' WHERE user_id=$1 AND (id=$2 OR parent_transfer_id=$2)",
        [uid, result.id],
      );
      return record(
        'imported',
        ['Transaksi dicatat otomatis.', ...result.warnings].join(' '),
        result.id,
        eventKey,
      );
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      await client.query('ROLLBACK TO SAVEPOINT gmail_transaction');
      return record('skipped', error.message);
    }
  });
}

function makeGmailApi(connection: Connection, deadline = Infinity): GmailApi {
  const client = googleClient();
  client.setCredentials({
    refresh_token: decryptRefreshToken(
      connection.refresh_token_encrypted!,
      connection.user_id,
      connection.subject,
    ),
  });
  return async <T>(path: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const timeout = Math.min(20000, deadline - Date.now());
    if (timeout <= 0) throw new Error('Gmail time budget exhausted');
    return (await client.request<T>({ url: url.href, timeout, retry: false })).data;
  };
}
export async function syncGmailUser(
  uid: string,
  apiOverride?: GmailApi,
  options: { deadline?: number } = {},
) {
  const deadline = options.deadline ?? Infinity;
  if (Date.now() >= deadline) return;
  const token = randomUUID();
  const acquired = await query(
    `INSERT INTO gmail_sync_leases(user_id,token,expires_at) VALUES($1,$2,now()+interval '2 minutes')
    ON CONFLICT(user_id) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at,last_started_at=now()
    WHERE gmail_sync_leases.expires_at<now() RETURNING user_id`,
    [uid, token],
  );
  if (!acquired.length) return;
  const checkpoint = async () => {
    if (Date.now() >= deadline) return false;
    return (
      (
        await query(
          "UPDATE gmail_sync_leases SET expires_at=now()+interval '2 minutes' WHERE user_id=$1 AND token=$2 RETURNING user_id",
          [uid, token],
        )
      ).length > 0
    );
  };
  try {
    const connection = (
      await query<Connection>('SELECT * FROM gmail_connections WHERE user_id=$1', [uid])
    )[0];
    if (!connection?.enabled || !connection.refresh_token_encrypted) return;
    const api = apiOverride ?? makeGmailApi(connection, deadline);
    const rules = await query<{ sender: string }>(
      'SELECT DISTINCT sender FROM gmail_rules WHERE user_id=$1 AND enabled=true',
      [uid],
    );
    if (!rules.length) return;
    let scanQuery = connection.scan_query;
    const until = connection.scan_until ?? new Date();
    if (!scanQuery) {
      const since = Math.max(
        connection.sync_from.valueOf(),
        (connection.last_synced_at?.valueOf() ?? connection.sync_from.valueOf()) - 10 * 60 * 1000,
      );
      const senderTerms = rules
        .map((rule) => `from:${rule.sender.replace(/[^a-zA-Z0-9@._+\-]/g, '')}`)
        .join(' ');
      scanQuery = `{${senderTerms}} after:${Math.floor(since / 1000)} before:${Math.ceil(until.valueOf() / 1000)} -in:spam -in:trash -in:sent -in:drafts`;
      await query(
        'UPDATE gmail_connections SET scan_query=$2,scan_until=$3,page_token=NULL WHERE user_id=$1 AND enabled=true',
        [uid, scanQuery, until],
      );
    }
    let pageToken = connection.page_token;
    // Save pagination to resume after interruptions or bursts without losing older pages.
    for (let page = 0; page < 5; page++) {
      if (!(await checkpoint())) return;
      const active = (
        await query(
          'SELECT enabled AND refresh_token_encrypted IS NOT NULL active FROM gmail_connections WHERE user_id=$1',
          [uid],
        )
      )[0];
      if (!active?.active) return;
      const result = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
        'messages',
        { q: scanQuery, maxResults: '100', ...(pageToken ? { pageToken } : {}) },
      );
      for (const item of result.messages ?? []) {
        if (!(await checkpoint())) return;
        const stillActive = (
          await query(
            'SELECT enabled AND refresh_token_encrypted IS NOT NULL active FROM gmail_connections WHERE user_id=$1',
            [uid],
          )
        )[0];
        if (!stillActive?.active) return;
        if (
          (
            await query(
              'SELECT 1 FROM gmail_imports WHERE user_id=$1 AND google_subject=$2 AND message_id=$3',
              [uid, connection.subject, item.id],
            )
          ).length
        )
          continue;
        let message: GmailMessage;
        try {
          message = await api<GmailMessage>(`messages/${encodeURIComponent(item.id)}`, {
            format: 'full',
          });
        } catch (error) {
          if ((error as { response?: { status?: number } }).response?.status === 404) continue;
          throw error;
        }
        if (!(await checkpoint())) return;
        await importGmailMessage(uid, connection.subject, message);
      }
      if (!(await checkpoint())) return;
      pageToken = result.nextPageToken ?? null;
      if (!pageToken) {
        await query(
          'UPDATE gmail_connections SET last_synced_at=$2,scan_query=NULL,scan_until=NULL,page_token=NULL,last_error=NULL WHERE user_id=$1 AND enabled=true AND refresh_token_encrypted IS NOT NULL',
          [uid, until],
        );
        return;
      }
      await query(
        'UPDATE gmail_connections SET page_token=$2,last_error=NULL WHERE user_id=$1 AND enabled=true AND refresh_token_encrypted IS NOT NULL',
        [uid, pageToken],
      );
    }
  } catch (error) {
    const response = (
      error as { response?: { status?: number; data?: { error?: string | { status?: string } } } }
    ).response;
    const revoked = response?.status === 401 || response?.data?.error === 'invalid_grant';
    const message = revoked
      ? 'Izin Gmail kedaluwarsa atau dicabut. Hubungkan ulang Gmail.'
      : 'Sinkronisasi Gmail gagal sementara. Sistem akan mencoba kembali.';
    await query(
      'UPDATE gmail_connections SET last_error=$2,enabled=CASE WHEN $3 THEN false ELSE enabled END WHERE user_id=$1 AND refresh_token_encrypted IS NOT NULL',
      [uid, message, revoked],
    );
    // Invalid pagination token: restart the uncommitted scan without advancing the watermark.
    if (response?.status === 400 && !revoked)
      await query(
        'UPDATE gmail_connections SET scan_query=NULL,scan_until=NULL,page_token=NULL WHERE user_id=$1',
        [uid],
      );
  } finally {
    await query(
      "UPDATE gmail_sync_leases SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND token=$2",
      [uid, token],
    );
  }
}
export async function syncAllGmail(options: { budgetMs?: number } = {}) {
  const deadline = options.budgetMs === undefined ? Infinity : Date.now() + options.budgetMs;
  if (!gmailConfigured()) return;
  await query(
    "INSERT INTO background_jobs(name) VALUES('gmail') ON CONFLICT(name) DO UPDATE SET last_heartbeat=now()",
  );
  const users = await query<{ user_id: string }>(
    `SELECT c.user_id FROM gmail_connections c LEFT JOIN gmail_sync_leases l ON l.user_id=c.user_id WHERE c.enabled=true AND c.refresh_token_encrypted IS NOT NULL ORDER BY l.last_started_at NULLS FIRST,c.user_id`,
  );
  for (const user of users) {
    if (Date.now() >= deadline) break;
    await syncGmailUser(user.user_id, undefined, {
      deadline: Math.min(deadline, Date.now() + 15000),
    });
    await query("UPDATE background_jobs SET last_heartbeat=now() WHERE name='gmail'");
  }
}
