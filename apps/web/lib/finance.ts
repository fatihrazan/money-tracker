import { atomic, lockAccounts, query, type PoolClient } from '@money/database';
import {
  accountSchema,
  budgetsSchema,
  categorySchema,
  dateRangeSchema,
  reconcileSchema,
  transactionSchema,
  shiftMonth,
  monthSchema,
  today,
  type Account,
  type DateRange,
  type Category,
  type Snapshot,
  type Transaction,
} from '@money/core';
import { HttpError } from './auth';
import { z } from 'zod';

const txSelect = `SELECT t.*,a.name account_name,d.name to_account_name,c.name category_name,
 COALESCE((SELECT amount FROM transactions fee WHERE fee.parent_transfer_id=t.id AND fee.user_id=t.user_id),0)::bigint fee
 FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts d ON d.id=t.to_account_id
 LEFT JOIN categories c ON c.id=t.category_id WHERE t.user_id=$1`;
export async function transactionPage(
  uid: string,
  start: string,
  end: string,
  account?: string,
  cursor?: string,
  search?: string,
) {
  const params: unknown[] = [uid, start, end];
  let filter = ' AND t.date >= $2 AND t.date < $3';
  if (account) {
    params.push(account);
    filter += ` AND (t.account_id=$4 OR t.to_account_id=$4)`;
  }
  if (cursor) {
    const [date, timestamp, id] = z
      .tuple([z.iso.date(), z.iso.datetime({ offset: true }), z.uuid()])
      .parse(cursor.split('|'));
    const n = params.length;
    params.push(date, timestamp, id);
    filter += ` AND (t.date,t.created_at,t.id)<($${n + 1}::date,$${n + 2}::timestamptz,$${n + 3}::uuid)`;
  }
  if (search) {
    params.push(search);
    filter += ` AND EXISTS (SELECT 1 FROM unnest(ARRAY[t.note,c.name,a.name,d.name]) field WHERE strpos(lower(field),lower($${params.length}))>0)`;
  }
  const rows = await query<Transaction & { page_key: string }>(
    txSelect.replace(
      'SELECT t.*',
      `SELECT concat_ws('|',t.date,to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),t.id) page_key,t.*`,
    ) +
      filter +
      ' ORDER BY t.date DESC,t.created_at DESC,t.id DESC LIMIT 51',
    params,
  );
  return {
    transactions: rows.slice(0, 50).map(({ page_key, ...tx }) => tx),
    next_cursor: rows.length > 50 ? rows[49].page_key : null,
  };
}
export async function snapshot(
  user: { id: string; username: string },
  month: string,
  account?: string,
  range?: DateRange,
  view: string = 'full',
): Promise<Snapshot> {
  if (range) range = dateRangeSchema.parse(range);
  const end = range ? new Date(`${range.end}T00:00:00Z`) : undefined;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  const dates = [
    user.id,
    range?.start ?? `${month}-01`,
    end?.toISOString().slice(0, 10) ?? `${shiftMonth(month, 1)}-01`,
  ];
  const [accounts, categories, transactions, summary, quick_fills, recent, setup, lastExpense] =
    await Promise.all([
      ['categories', 'budgets'].includes(view)
        ? []
        : query<Account>('SELECT * FROM account_balances WHERE user_id=$1 ORDER BY archived,name', [
            user.id,
          ]),
      view === 'accounts'
        ? []
        : query<Category>(
            `SELECT c.*,budget_at(c.id,$4::date) budget, (SELECT count(*)::int FROM transactions t WHERE t.user_id=c.user_id AND t.category_id=c.id) used,
      COALESCE((SELECT sum(t.amount) FROM transactions t WHERE t.user_id=c.user_id AND t.category_id=c.id),0)::bigint total,
      COALESCE((SELECT sum(t.amount) FROM transactions t WHERE t.user_id=c.user_id AND t.category_id=c.id AND t.kind='expense' AND t.date >= $2 AND t.date < $3),0)::bigint spent
      FROM categories c WHERE user_id=$1 ORDER BY kind,name`,
            [...dates, range?.end ?? `${month}-01`],
          ),
      view === 'full'
        ? transactionPage(user.id, dates[1], dates[2], account)
        : { transactions: [], next_cursor: null },
      !['full', 'dashboard', 'transactions'].includes(view)
        ? [{ income: 0, expense: 0 }]
        : query<{ income: number; expense: number }>(
            `SELECT COALESCE(sum(amount) FILTER(WHERE kind='income'),0)::bigint income,COALESCE(sum(amount) FILTER(WHERE kind='expense'),0)::bigint expense
      FROM transactions WHERE user_id=$1 AND date >= $2 AND date < $3 ${account ? 'AND account_id=$4' : ''}`,
            account ? [...dates, account] : dates,
          ),
      !['full', 'dashboard'].includes(view)
        ? []
        : query<Snapshot['quick_fills'][number]>(
            `SELECT min(t.note) note,t.amount,t.account_id,t.category_id FROM transactions t JOIN accounts a ON a.id=t.account_id
      WHERE t.user_id=$1 AND t.kind='expense' AND t.note<>'' AND a.archived=false AND t.parent_transfer_id IS NULL AND t.date >= $2::date-90
      GROUP BY lower(t.note),t.amount,t.account_id,t.category_id HAVING count(*)>=2 ORDER BY count(*) DESC,max(t.created_at) DESC LIMIT 6`,
            [user.id, today(process.env.APP_TIMEZONE)],
          ),
      !['full', 'dashboard'].includes(view)
        ? []
        : query<Transaction>(
            txSelect + ' ORDER BY t.date DESC,t.created_at DESC,t.id DESC LIMIT 8',
            [user.id],
          ),
      !['full', 'dashboard'].includes(view)
        ? [{ needed: false }]
        : query<{ needed: boolean }>(
            `SELECT NOT EXISTS(SELECT 1 FROM transactions WHERE user_id=$1)
      AND NOT EXISTS(SELECT 1 FROM accounts WHERE user_id=$1 AND initial_balance<>0) needed`,
            [user.id],
          ),
      !['full', 'dashboard', 'transactions'].includes(view)
        ? []
        : query<NonNullable<Snapshot['last_expense']>>(
            `SELECT t.account_id,t.category_id FROM transactions t JOIN accounts a ON a.id=t.account_id
      WHERE t.user_id=$1 AND t.kind='expense' AND a.archived=false AND t.parent_transfer_id IS NULL ORDER BY t.created_at DESC,t.id DESC LIMIT 1`,
            [user.id],
          ),
    ]);
  return {
    user,
    accounts,
    categories,
    ...transactions,
    quick_fills,
    recent,
    needs_setup: setup[0].needed,
    last_expense: lastExpense[0] ?? null,
    summary: summary[0],
    total: accounts.filter((a) => !a.archived).reduce((n, a) => n + a.balance, 0),
    month,
  };
}
export async function saveAccount(uid: string, body: unknown, id?: string) {
  const data = accountSchema.parse(body);
  return atomic(async (client) => {
    await lockAccounts(client, uid);
    if (id) {
      const existing = (
        await client.query<Account>('SELECT * FROM accounts WHERE user_id=$1 AND id=$2', [uid, id])
      ).rows[0];
      if (existing?.archived && existing.initial_balance !== data.initial_balance)
        throw new HttpError(400, 'Aktifkan akun sebelum mengubah saldo awal.');
      const result = await client.query(
        'UPDATE accounts SET name=$1,type=$2,initial_balance=$3 WHERE user_id=$4 AND id=$5 RETURNING id',
        [data.name, data.type, data.initial_balance, uid, id],
      );
      if (!result.rowCount) throw new HttpError(404, 'Akun tidak ditemukan.');
      return result.rows[0];
    }
    return (
      await client.query(
        'INSERT INTO accounts(user_id,name,type,initial_balance) VALUES($1,$2,$3,$4) RETURNING id',
        [uid, data.name, data.type, data.initial_balance],
      )
    ).rows[0];
  });
}
export async function archiveAccount(uid: string, id: string, archived: boolean) {
  return atomic(async (client) => {
    await lockAccounts(client, uid);
    const account = (
      await client.query<Account>('SELECT * FROM account_balances WHERE user_id=$1 AND id=$2', [
        uid,
        id,
      ])
    ).rows[0];
    if (!account) throw new HttpError(404, 'Akun tidak ditemukan.');
    if (archived && !account.archived && account.balance !== 0)
      throw new HttpError(400, 'Saldo harus Rp0 sebelum akun diarsipkan.');
    await client.query('UPDATE accounts SET archived=$3 WHERE user_id=$1 AND id=$2', [
      uid,
      id,
      archived,
    ]);
    return { message: archived ? 'Akun diarsipkan.' : 'Akun diaktifkan kembali.' };
  });
}
export async function reconcile(uid: string, id: string, body: unknown) {
  const { actual } = reconcileSchema.parse(body);
  return atomic(async (client) => {
    await lockAccounts(client, uid);
    const account = (
      await client.query<Account>('SELECT * FROM account_balances WHERE user_id=$1 AND id=$2', [
        uid,
        id,
      ])
    ).rows[0];
    if (!account) throw new HttpError(404, 'Akun tidak ditemukan.');
    if (account.archived) throw new HttpError(400, 'Aktifkan akun sebelum mencocokkan saldo.');
    const diff = actual - account.balance;
    if (diff)
      await client.query(
        "INSERT INTO transactions(user_id,kind,amount,account_id,note,date) VALUES($1,'adjustment',$2,$3,$4,$5)",
        [
          uid,
          diff,
          id,
          `Saldo tercatat ${account.balance}, saldo asli ${actual}`,
          today(process.env.APP_TIMEZONE),
        ],
      );
    return { message: diff ? 'Penyesuaian saldo dicatat.' : 'Saldo sudah cocok.' };
  });
}
export async function saveCategory(
  uid: string,
  body: unknown,
  month = today(process.env.APP_TIMEZONE).slice(0, 7),
) {
  const data = categorySchema.parse(body);
  return atomic(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      'INSERT INTO categories(user_id,name,kind) VALUES($1,$2,$3) RETURNING id',
      [uid, data.name, data.kind],
    );
    if (data.budget !== null)
      await client.query('INSERT INTO category_budgets VALUES($1,$2,$3)', [
        row.id,
        `${monthSchema.parse(month)}-01`,
        data.budget,
      ]);
    return row;
  });
}
export async function deleteCategory(uid: string, id: string) {
  const rows = await query('DELETE FROM categories WHERE user_id=$1 AND id=$2 RETURNING id', [
    uid,
    id,
  ]);
  if (!rows.length) throw new HttpError(404, 'Kategori tidak ditemukan.');
  return { message: 'Kategori dihapus.' };
}
export async function saveBudgets(
  uid: string,
  body: unknown,
  month = today(process.env.APP_TIMEZONE).slice(0, 7),
) {
  const budgets = budgetsSchema.parse(body);
  return atomic(async (client) => {
    for (const b of budgets) {
      const result = await client.query(
        `INSERT INTO category_budgets(category_id,effective_month,budget)
         SELECT id,$4::date,$1::bigint FROM categories WHERE user_id=$2 AND id=$3 AND kind='expense'
         ON CONFLICT(category_id,effective_month) DO UPDATE SET budget=EXCLUDED.budget`,
        [b.budget, uid, b.id, `${monthSchema.parse(month)}-01`],
      );
      if (!result.rowCount) throw new HttpError(404, 'Kategori tidak ditemukan.');
    }
    return { message: 'Anggaran disimpan.' };
  });
}
async function validateRelations(
  client: PoolClient,
  uid: string,
  data: ReturnType<typeof transactionSchema.parse>,
) {
  const ids = [data.account_id, ...(data.kind === 'transfer' ? [data.to_account_id!] : [])];
  const accounts = (
    await client.query<Account>('SELECT * FROM accounts WHERE user_id=$1 AND id=ANY($2::uuid[])', [
      uid,
      ids,
    ])
  ).rows;
  if (accounts.length !== ids.length) throw new HttpError(400, 'Akun tidak valid.');
  if (accounts.some((a) => a.archived))
    throw new HttpError(400, 'Aktifkan akun sebelum mencatat atau mengubah transaksi.');
  if (data.kind !== 'transfer') {
    const cat = (
      await client.query('SELECT id FROM categories WHERE user_id=$1 AND id=$2 AND kind=$3', [
        uid,
        data.category_id,
        data.kind,
      ])
    ).rows[0];
    if (!cat) throw new HttpError(400, 'Kategori tidak sesuai jenis transaksi.');
  }
}
export async function saveTransaction(uid: string, body: unknown, id?: string) {
  return atomic((client) => saveTransactionWithClient(client, uid, body, id));
}
export async function createManualTransaction(uid: string, body: unknown, key: string) {
  const payload = JSON.stringify(transactionSchema.parse(body));
  return atomic(async (client) => {
    const claim = await client.query(
      'INSERT INTO transaction_requests(user_id,request_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [uid, key, payload],
    );
    if (!claim.rowCount) {
      const {
        rows: [existing],
      } = await client.query(
        'SELECT result,payload=$3::jsonb AS matches FROM transaction_requests WHERE user_id=$1 AND request_id=$2',
        [uid, key, payload],
      );
      if (!existing.matches)
        throw new HttpError(
          409,
          'Permintaan ini sudah tersimpan dengan isi berbeda. Mulai transaksi baru.',
        );
      return existing.result;
    }
    const result = await saveTransactionWithClient(client, uid, body);
    await client.query(
      'UPDATE transaction_requests SET result=$3 WHERE user_id=$1 AND request_id=$2',
      [uid, key, result],
    );
    return result;
  });
}
// Email import and its deduplication record must commit in the same transaction.
export async function saveTransactionWithClient(
  client: PoolClient,
  uid: string,
  body: unknown,
  id?: string,
) {
  const data = transactionSchema.parse(body);
  await lockAccounts(client, uid);
  if (id) {
    const existing = (
      await client.query(
        `SELECT t.kind,t.parent_transfer_id,EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=t.user_id
           AND (a.id=t.account_id OR a.id=t.to_account_id) AND a.archived=true) archived
           FROM transactions t WHERE t.user_id=$1 AND t.id=$2 FOR UPDATE`,
        [uid, id],
      )
    ).rows[0];
    if (!existing) throw new HttpError(404, 'Transaksi tidak ditemukan.');
    if (existing.archived) throw new HttpError(400, 'Aktifkan akun sebelum mengubah transaksi.');
    if (existing.kind === 'adjustment')
      throw new HttpError(400, 'Hapus penyesuaian lalu cocokkan saldo kembali.');
    if (existing.parent_transfer_id)
      throw new HttpError(400, 'Ubah biaya admin melalui transaksi transfer asal.');
  }
  await validateRelations(client, uid, data);
  const values = [
    uid,
    data.kind,
    data.amount,
    data.account_id,
    data.kind === 'transfer' ? data.to_account_id : null,
    data.kind === 'transfer' ? null : data.category_id,
    data.note,
    data.date,
  ];
  const result = id
    ? await client.query(
        'UPDATE transactions SET kind=$2,amount=$3,account_id=$4,to_account_id=$5,category_id=$6,note=$7,date=$8 WHERE user_id=$1 AND id=$9 RETURNING id',
        [...values, id],
      )
    : await client.query(
        'INSERT INTO transactions(user_id,kind,amount,account_id,to_account_id,category_id,note,date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        values,
      );
  const txId = result.rows[0].id;
  await client.query('DELETE FROM transactions WHERE user_id=$1 AND parent_transfer_id=$2', [
    uid,
    txId,
  ]);
  let feeCategory: string | undefined;
  if (data.kind === 'transfer' && data.fee) {
    feeCategory = (
      await client.query(
        "INSERT INTO categories(user_id,name,kind) VALUES($1,'Biaya Admin','expense') ON CONFLICT(user_id,name,kind) DO UPDATE SET name=EXCLUDED.name RETURNING id",
        [uid],
      )
    ).rows[0].id;
    const dest = (
      await client.query('SELECT name FROM accounts WHERE user_id=$1 AND id=$2', [
        uid,
        data.to_account_id,
      ])
    ).rows[0];
    await client.query(
      "INSERT INTO transactions(user_id,kind,amount,account_id,category_id,note,date,parent_transfer_id) VALUES($1,'expense',$2,$3,$4,$5,$6,$7)",
      [
        uid,
        data.fee,
        data.account_id,
        feeCategory,
        `Biaya transfer ke ${dest.name}`.slice(0, 200),
        data.date,
        txId,
      ],
    );
  }
  const warnings: string[] = [];
  for (const categoryId of [
    data.kind === 'expense' ? data.category_id : undefined,
    feeCategory,
  ].filter(Boolean)) {
    const b = (
      await client.query<{ name: string; budget: number; spent: number }>(
        `SELECT c.name,budget_at(c.id,$3::date) budget,COALESCE(sum(t.amount),0)::bigint spent FROM categories c LEFT JOIN transactions t
        ON t.category_id=c.id AND t.user_id=c.user_id AND t.date >= $3 AND t.date < $4
        WHERE c.user_id=$1 AND c.id=$2 AND budget_at(c.id,$3::date) IS NOT NULL GROUP BY c.id`,
        [
          uid,
          categoryId,
          `${data.date.slice(0, 7)}-01`,
          `${shiftMonth(data.date.slice(0, 7), 1)}-01`,
        ],
      )
    ).rows[0];
    if (b && b.spent / b.budget >= 0.8)
      warnings.push(
        `Anggaran ${b.name}: ${Math.round((b.spent / b.budget) * 100)}% terpakai${b.spent > b.budget ? ', batas terlewati' : ''}.`,
      );
  }
  return { id: txId, message: 'Transaksi disimpan.', warnings };
}
export async function deleteTransaction(uid: string, id: string) {
  return atomic(async (client) => {
    await lockAccounts(client, uid);
    const archived = await client.query(
      `SELECT t.id FROM transactions t JOIN accounts a ON a.user_id=t.user_id AND (a.id=t.account_id OR a.id=t.to_account_id) WHERE t.user_id=$1 AND t.id=$2 AND a.archived=true`,
      [uid, id],
    );
    if (archived.rowCount) throw new HttpError(400, 'Aktifkan akun sebelum menghapus transaksi.');
    const fee = await client.query(
      'SELECT 1 FROM transactions WHERE user_id=$1 AND id=$2 AND parent_transfer_id IS NOT NULL',
      [uid, id],
    );
    if (fee.rowCount)
      throw new HttpError(400, 'Hapus biaya admin melalui transaksi transfer asal.');
    const result = await client.query(
      'DELETE FROM transactions WHERE user_id=$1 AND id=$2 RETURNING id',
      [uid, id],
    );
    if (!result.rowCount) throw new HttpError(404, 'Transaksi tidak ditemukan.');
    return { message: 'Transaksi dihapus.' };
  });
}
