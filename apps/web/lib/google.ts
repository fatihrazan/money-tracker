import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { atomic, query, type PoolClient } from '@money/database';
import { createDefaults, digest, HttpError, newSession, sessionUser } from './auth';

export const GOOGLE_STATE_COOKIE = 'money_google_state';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export type GooglePurpose = 'login' | 'link' | 'gmail';
type GoogleProfile = { subject: string; email: string };
type OAuthState = {
  verifier: string;
  nonce: string;
  purpose: GooglePurpose;
  user_id: string | null;
  session_hash: string | null;
};

export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_ORIGIN,
  );
}
export function googleOrigin() {
  const value = process.env.APP_ORIGIN;
  if (!value) throw new HttpError(503, 'APP_ORIGIN belum dikonfigurasi.');
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new HttpError(503, 'Google OAuth memerlukan HTTPS atau localhost.');
  return url.origin;
}
export function googleClient() {
  if (!googleConfigured())
    throw new HttpError(503, 'Login Google belum dikonfigurasi oleh pengelola aplikasi.');
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${googleOrigin()}/api/google/callback`,
  );
}
function tokenKey() {
  const raw = process.env.GMAIL_TOKEN_KEY ?? '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw))
    throw new HttpError(503, 'Kunci enkripsi Gmail belum dikonfigurasi.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new HttpError(503, 'Kunci enkripsi Gmail tidak valid.');
  return key;
}
export function gmailConfigured() {
  try {
    tokenKey();
    return googleConfigured();
  } catch {
    return false;
  }
}
export function encryptRefreshToken(token: string, userId: string, subject: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${subject}`));
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}
export function decryptRefreshToken(encrypted: string, userId: string, subject: string) {
  const [iv, tag, data, extra] = encrypted.split('.');
  if (!iv || !tag || !data || extra) throw new Error('Invalid encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(`${userId}:${subject}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
export async function beginGoogle(purpose: GooglePurpose, sessionToken?: string) {
  const client = googleClient();
  const user = purpose === 'login' ? null : await sessionUser(sessionToken);
  if (purpose !== 'login' && !user) throw new HttpError(401, 'Masuk dulu untuk menautkan Google.');
  if (purpose === 'gmail') tokenKey();
  const state = randomBytes(32).toString('hex');
  const browser = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  await query('DELETE FROM google_oauth_states WHERE expires_at<now()');
  await query(
    `INSERT INTO google_oauth_states(state_hash,browser_hash,verifier,nonce,purpose,user_id,session_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
    [
      digest(state),
      digest(browser),
      codeVerifier,
      nonce,
      purpose,
      user?.id ?? null,
      user ? digest(sessionToken!) : null,
    ],
  );
  const url = client.generateAuthUrl({
    scope: ['openid', 'email', ...(purpose === 'gmail' ? [GMAIL_SCOPE] : [])],
    access_type: purpose === 'gmail' ? 'offline' : 'online',
    prompt: purpose === 'gmail' ? 'consent select_account' : 'select_account',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  return { url, browser };
}
export async function consumeGoogleState(state: string, browser: string, sessionToken?: string) {
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser))
    throw new HttpError(400, 'Permintaan Google tidak valid atau sudah kedaluwarsa.');
  const row = (
    await query<OAuthState>(
      `DELETE FROM google_oauth_states
    WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *`,
      [digest(state), digest(browser)],
    )
  )[0];
  if (!row) throw new HttpError(400, 'Permintaan Google tidak valid atau sudah kedaluwarsa.');
  if (row.purpose !== 'login') {
    const user = await sessionUser(sessionToken);
    if (!user || user.id !== row.user_id || digest(sessionToken!) !== row.session_hash)
      throw new HttpError(401, 'Sesi berubah. Ulangi penautan Google.');
  }
  return row;
}
export async function attachGoogle(client: PoolClient, userId: string, profile: GoogleProfile) {
  // Subject is the identity. Never merge users merely because their email/name matches.
  const identities = (
    await client.query<{ user_id: string; subject: string }>(
      'SELECT user_id,subject FROM google_identities WHERE user_id=$1 OR subject=$2 FOR UPDATE',
      [userId, profile.subject],
    )
  ).rows;
  if (
    identities.some(
      (identity) => identity.user_id !== userId || identity.subject !== profile.subject,
    )
  )
    throw new HttpError(
      409,
      'Akun Google sudah tertaut ke akun lain, atau akun ini memakai Google yang berbeda.',
    );
  await client.query(
    `INSERT INTO google_identities(user_id,subject,email) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email`,
    [userId, profile.subject, profile.email],
  );
}
export async function googleSignIn(profile: GoogleProfile) {
  return atomic(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`google:${profile.subject}`]);
    let user = (
      await client.query<{ id: string; username: string }>(
        'SELECT u.id,u.username FROM users u JOIN google_identities g ON g.user_id=u.id WHERE g.subject=$1',
        [profile.subject],
      )
    ).rows[0];
    if (!user) {
      const base =
        profile.email
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9_.]/g, '')
          .slice(0, 18) || 'google';
      user = (
        await client.query<{ id: string; username: string }>(
          'INSERT INTO users(username,password_hash) VALUES($1,NULL) RETURNING id,username',
          [`${base}_${randomBytes(5).toString('hex')}`],
        )
      ).rows[0];
      await createDefaults(client, user.id);
    }
    await attachGoogle(client, user.id, profile);
    return { user, token: await newSession(client, user.id) };
  });
}
export async function completeGoogle(code: string, state: OAuthState) {
  const client = googleClient();
  const { tokens } = await client.getToken({ code, codeVerifier: state.verifier });
  if (!tokens.id_token) throw new HttpError(400, 'Google tidak mengembalikan identitas.');
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const claims = ticket.getPayload();
  if (
    !claims?.sub ||
    !claims.email ||
    claims.email_verified !== true ||
    (claims as { nonce?: string }).nonce !== state.nonce
  )
    throw new HttpError(400, 'Identitas Google tidak dapat diverifikasi.');
  const profile = { subject: claims.sub, email: claims.email };
  if (state.purpose === 'login')
    return { ...(await googleSignIn(profile)), destination: '/dashboard' };
  const uid = state.user_id!;
  if (state.purpose === 'gmail' && !tokens.scope?.split(' ').includes(GMAIL_SCOPE))
    throw new HttpError(400, 'Izin membaca Gmail belum diberikan.');
  await atomic(async (connection) => {
    if (
      !(
        await connection.query(
          'SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()',
          [state.session_hash, uid],
        )
      ).rowCount
    )
      throw new HttpError(401, 'Sesi sudah berakhir. Masuk dan hubungkan Google kembali.');
    await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `google:${profile.subject}`,
    ]);
    await attachGoogle(connection, uid, profile);
    if (state.purpose === 'gmail') {
      const existing = (
        await connection.query<{ refresh_token_encrypted: string | null }>(
          'SELECT refresh_token_encrypted FROM gmail_connections WHERE user_id=$1 AND subject=$2 FOR UPDATE',
          [uid, profile.subject],
        )
      ).rows[0];
      const encrypted = tokens.refresh_token
        ? encryptRefreshToken(tokens.refresh_token, uid, profile.subject)
        : existing?.refresh_token_encrypted;
      if (!encrypted)
        throw new HttpError(
          400,
          'Akses latar belakang Gmail belum diberikan. Ulangi hubungkan Gmail.',
        );
      await connection.query(
        `INSERT INTO gmail_connections(user_id,subject,refresh_token_encrypted) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET refresh_token_encrypted=$3,enabled=true,last_error=NULL,
        sync_from=CASE WHEN gmail_connections.refresh_token_encrypted IS NULL THEN now() ELSE gmail_connections.sync_from END,
        last_synced_at=CASE WHEN gmail_connections.refresh_token_encrypted IS NULL THEN NULL ELSE gmail_connections.last_synced_at END`,
        [uid, profile.subject, encrypted],
      );
    }
  });
  return { destination: '/integrations?google=connected', token: undefined };
}
