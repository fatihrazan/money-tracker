import { atomic, query } from '@money/database';
import { emailRuleSchema, type GmailStatus } from '@money/core/email-transactions';
import { HttpError } from './auth';
import { gmailConfigured, googleConfigured } from './google';

export async function gmailStatus(uid: string): Promise<GmailStatus> {
  const [identities, connections, rules, imports, workers] = await Promise.all([
    query('SELECT email FROM google_identities WHERE user_id=$1', [uid]),
    query(
      `SELECT enabled,refresh_token_encrypted IS NOT NULL connected,sync_from,last_synced_at,last_error FROM gmail_connections WHERE user_id=$1`,
      [uid],
    ),
    query(
      'SELECT id,name,sender,subject_contains,body_contains,kind,account_id,to_account_id,category_id,enabled,created_at FROM gmail_rules WHERE user_id=$1 ORDER BY created_at,id',
      [uid],
    ),
    query(
      `SELECT i.id,i.status,i.reason,i.received_at,i.created_at,i.transaction_id,r.name rule_name FROM gmail_imports i
      LEFT JOIN gmail_rules r ON r.id=i.rule_id AND r.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT 30`,
      [uid],
    ),
    query(
      "SELECT last_heartbeat>now()-($1::int*interval '1 minute') active FROM background_jobs WHERE name='gmail'",
      [process.env.GMAIL_SCHEDULE_ENABLED === 'true' ? 7 : 3],
    ),
  ]);
  return {
    google_configured: googleConfigured(),
    gmail_configured: gmailConfigured(),
    identity: identities[0] ?? null,
    connection: connections[0] ?? null,
    rules,
    imports,
    worker_active: workers[0]?.active ?? false,
    sync_interval_minutes: process.env.GMAIL_SCHEDULE_ENABLED === 'true' ? 5 : 1,
  } as GmailStatus;
}
export async function saveEmailRule(uid: string, body: unknown, id?: string) {
  const data = emailRuleSchema.parse(body);
  return atomic(async (client) => {
    const accounts = [data.account_id, ...(data.kind === 'transfer' ? [data.to_account_id!] : [])];
    const found = await client.query(
      'SELECT id FROM accounts WHERE user_id=$1 AND id=ANY($2::uuid[]) AND archived=false',
      [uid, accounts],
    );
    if (found.rowCount !== accounts.length)
      throw new HttpError(400, 'Rekening tidak valid atau diarsipkan.');
    if (data.kind !== 'transfer') {
      const category = await client.query(
        'SELECT id FROM categories WHERE user_id=$1 AND id=$2 AND kind=$3',
        [uid, data.category_id, data.kind],
      );
      if (!category.rowCount) throw new HttpError(400, 'Kategori tidak sesuai jenis transaksi.');
    }
    const values = [
      uid,
      data.name,
      data.sender,
      data.subject_contains,
      data.body_contains,
      data.kind,
      data.account_id,
      data.kind === 'transfer' ? data.to_account_id : null,
      data.kind === 'transfer' ? null : data.category_id,
      data.enabled,
    ];
    if (id) {
      const updated = await client.query(
        `UPDATE gmail_rules SET name=$2,sender=$3,subject_contains=$4,body_contains=$5,kind=$6,
        account_id=$7,to_account_id=$8,category_id=$9,enabled=$10,updated_at=now() WHERE user_id=$1 AND id=$11 RETURNING id`,
        [...values, id],
      );
      if (!updated.rowCount) throw new HttpError(404, 'Aturan tidak ditemukan.');
    } else {
      // Bound the scan query and UI; a user can update or disable existing rules.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [uid]);
      const count = (
        await client.query('SELECT count(*)::int n FROM gmail_rules WHERE user_id=$1', [uid])
      ).rows[0].n;
      if (count >= 50) throw new HttpError(400, 'Maksimal 50 aturan per pengguna.');
      await client.query(
        `INSERT INTO gmail_rules(user_id,name,sender,subject_contains,body_contains,kind,account_id,to_account_id,category_id,enabled)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        values,
      );
    }
    return { message: 'Aturan email disimpan. Email baru yang cocok akan dicatat otomatis.' };
  });
}
export async function updateGmailConnection(
  uid: string,
  action: 'pause' | 'resume' | 'disconnect',
) {
  return atomic(async (client) => {
    const connection = (
      await client.query('SELECT * FROM gmail_connections WHERE user_id=$1 FOR UPDATE', [uid])
    ).rows[0];
    if (!connection) throw new HttpError(404, 'Gmail belum terhubung.');
    if (action === 'resume' && !connection.refresh_token_encrypted)
      throw new HttpError(400, 'Hubungkan Gmail kembali.');
    if (action === 'disconnect') {
      await client.query(
        'UPDATE gmail_connections SET enabled=false,refresh_token_encrypted=NULL,page_token=NULL,scan_query=NULL,scan_until=NULL,last_error=NULL WHERE user_id=$1',
        [uid],
      );
    } else {
      await client.query('UPDATE gmail_connections SET enabled=$2 WHERE user_id=$1', [
        uid,
        action === 'resume',
      ]);
    }
    return {
      message:
        action === 'disconnect'
          ? 'Akses Gmail di aplikasi dihapus. Login Google tetap terhubung.'
          : action === 'pause'
            ? 'Impor email dijeda.'
            : 'Impor email diaktifkan.',
    };
  });
}
