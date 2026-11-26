import { createHash, randomBytes } from 'node:crypto';
import { atomic, query, type PoolClient } from '@money/database';
import { hashPassword, verifyPassword } from './password';
export const COOKIE_NAME = 'money_session';
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function sessionUser(token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (
    (
      await query<{ id: string; username: string }>(
        'SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [digest(token)],
      )
    )[0] ?? null
  );
}
export async function deleteSession(token: string) {
  await query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
}
export async function newSession(client: PoolClient, userId: string) {
  const token = randomBytes(32).toString('hex');
  await client.query('DELETE FROM sessions WHERE expires_at<now()');
  await client.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [digest(token), userId],
  );
  return token;
}
const defaults = {
  accounts: [
    ['BNI', 'bank'],
    ['Mandiri', 'bank'],
    ['Bank Jago', 'bank'],
    ['GoPay', 'ewallet'],
    ['ShopeePay', 'ewallet'],
    ['Tunai', 'cash'],
  ],
  expense: [
    'Makan & Minum',
    'Transportasi',
    'Belanja',
    'Tagihan',
    'Hiburan',
    'Kesehatan',
    'Pendidikan',
    'Biaya Admin',
    'Lainnya',
  ],
  income: ['Gaji', 'Bonus', 'Hadiah', 'Cashback', 'Lainnya'],
};
export async function signup(username: string, password: string) {
  const hash = await hashPassword(password);
  return atomic(async (client) => {
    const user = (
      await client.query<{ id: string; username: string }>(
        'INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id,username',
        [username, hash],
      )
    ).rows[0];
    await createDefaults(client, user.id);
    return { user, token: await newSession(client, user.id) };
  });
}
export async function createDefaults(client: PoolClient, userId: string) {
  for (const [name, type] of defaults.accounts)
    await client.query('INSERT INTO accounts(user_id,name,type) VALUES($1,$2,$3)', [
      userId,
      name,
      type,
    ]);
  for (const kind of ['expense', 'income'] as const)
    for (const name of defaults[kind])
      await client.query('INSERT INTO categories(user_id,name,kind) VALUES($1,$2,$3)', [
        userId,
        name,
        kind,
      ]);
}
export async function login(username: string, password: string) {
  const key = digest(`login:${username}`);
  const limit = (
    await query<{ attempts: number }>(
      `INSERT INTO auth_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET
    attempts=CASE WHEN auth_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_limits.attempts+1 END,
    window_start=CASE WHEN auth_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_limits.window_start END RETURNING attempts`,
      [key],
    )
  )[0];
  if (limit.attempts > 15)
    throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  const user = (
    await query<{ id: string; username: string; password_hash: string | null }>(
      'SELECT * FROM users WHERE username=$1',
      [username],
    )
  )[0];
  if (!user?.password_hash || !(await verifyPassword(password, user.password_hash)))
    throw new HttpError(401, 'Nama pengguna atau kata sandi salah.');
  await query('DELETE FROM auth_limits WHERE key=$1', [key]);
  return atomic(async (client) => ({
    user: { id: user.id, username: user.username },
    token: await newSession(client, user.id),
  }));
}
