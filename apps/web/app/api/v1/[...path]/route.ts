import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  loginSchema,
  signupSchema,
  monthSchema,
  dateRangeSchema,
  today,
  shiftMonth,
} from '@money/core';
import {
  COOKIE_NAME,
  SESSION_SECONDS,
  deleteSession,
  HttpError,
  login,
  sessionUser,
  signup,
} from '../../../../lib/auth';
import { telegramStatus, createTelegramLink, disconnectTelegram } from '../../../../lib/telegram';
import * as finance from '../../../../lib/finance';
import { gmailStatus, saveEmailRule, updateGmailConnection } from '../../../../lib/gmail-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
function tokenOf(req: NextRequest) {
  return (
    req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ??
    req.cookies.get(COOKIE_NAME)?.value
  );
}
async function handler(req: NextRequest, context: Context) {
  try {
    if (req.method !== 'GET') {
      const origin = req.headers.get('origin');
      const expected = process.env.APP_ORIGIN ?? req.nextUrl.origin;
      if ((origin && origin !== expected) || req.headers.get('sec-fetch-site') === 'cross-site')
        throw new HttpError(403, 'Asal permintaan tidak diizinkan.');
      if (req.headers.get('content-type')?.split(';')[0] !== 'application/json')
        throw new HttpError(415, 'Gunakan Content-Type application/json.');
      const declared = Number(req.headers.get('content-length') ?? 0);
      if (declared > 64000) throw new HttpError(413, 'Permintaan terlalu besar.');
    }
    const path = (await context.params).path;
    const route = path.join('/');
    const read = async () => {
      const text = await req.text();
      if (text.length > 64000) throw new HttpError(413, 'Permintaan terlalu besar.');
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError(400, 'JSON tidak valid.');
      }
    };

    if (req.method === 'POST' && ['auth/login', 'auth/signup'].includes(route)) {
      const input = await read();
      const data = route === 'auth/signup' ? signupSchema.parse(input) : loginSchema.parse(input);
      const result =
        route === 'auth/signup'
          ? await signup(data.username, data.password)
          : await login(data.username, data.password);
      const bearer = req.headers.get('x-auth-mode') === 'bearer';
      const response = NextResponse.json(
        {
          data: {
            user: result.user,
            ...(bearer ? { token: result.token, expires_in: SESSION_SECONDS } : {}),
          },
        },
        { status: route === 'auth/signup' ? 201 : 200 },
      );
      if (!bearer)
        response.cookies.set(COOKIE_NAME, result.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure:
            process.env.COOKIE_SECURE === 'true' ||
            (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'),
          path: '/',
          maxAge: SESSION_SECONDS,
        });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const token = tokenOf(req);
    const user = await sessionUser(token);
    if (!user) throw new HttpError(401, 'Silakan masuk kembali.');
    let result: unknown;
    if (route === 'auth/me' && req.method === 'GET') result = user;
    else if (route === 'integrations/telegram' && req.method === 'GET')
      result = await telegramStatus(user.id);
    else if (route === 'integrations/telegram/link' && req.method === 'POST')
      result = await createTelegramLink(user.id);
    else if (route === 'integrations/telegram' && req.method === 'DELETE')
      result = await disconnectTelegram(user.id);
    else if (route === 'integrations/google' && req.method === 'GET')
      result = await gmailStatus(user.id);
    else if (route === 'integrations/gmail' && req.method === 'PATCH') {
      const { action } = z
        .object({ action: z.enum(['pause', 'resume', 'disconnect']) })
        .parse(await read());
      result = await updateGmailConnection(user.id, action);
    } else if (route === 'auth/logout' && req.method === 'POST') {
      await deleteSession(token!);
      const response = NextResponse.json({ data: { message: 'Kamu sudah keluar.' } });
      response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        path: '/',
        maxAge: 0,
        sameSite: 'lax',
      });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } else if (['snapshot', 'transactions'].includes(route) && req.method === 'GET') {
      const month = monthSchema.parse(
        req.nextUrl.searchParams.get('month') || today(process.env.APP_TIMEZONE).slice(0, 7),
      );
      const account = req.nextUrl.searchParams.get('account') || undefined;
      if (account) z.uuid().parse(account);
      const start = req.nextUrl.searchParams.get('start');
      const end = req.nextUrl.searchParams.get('end');
      const range =
        start !== null || end !== null ? dateRangeSchema.parse({ start, end }) : undefined;
      const view = z
        .enum(['dashboard', 'transactions', 'accounts', 'categories', 'budgets', 'full'])
        .parse(req.nextUrl.searchParams.get('view') ?? 'full');
      if (route === 'transactions') {
        const endDate = new Date(`${range?.end ?? `${month}-01`}T00:00:00Z`);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        result = await finance.transactionPage(
          user.id,
          range?.start ?? `${month}-01`,
          range ? endDate.toISOString().slice(0, 10) : `${shiftMonth(month, 1)}-01`,
          account,
          req.nextUrl.searchParams.get('cursor') ?? undefined,
          z
            .string()
            .max(200)
            .optional()
            .parse(req.nextUrl.searchParams.get('q') ?? undefined),
        );
      } else result = await finance.snapshot(user, month, account, range, view);
    } else {
      const [resource, id, action] = path;
      if (path.length > 3) throw new HttpError(404, 'Endpoint tidak ditemukan.');
      if (id) z.uuid().parse(id);
      if (resource === 'accounts' && !action && req.method === 'POST' && !id)
        result = await finance.saveAccount(user.id, await read());
      else if (resource === 'accounts' && id && !action && req.method === 'PATCH')
        result = await finance.saveAccount(user.id, await read(), id);
      else if (resource === 'accounts' && id && action === 'archive' && req.method === 'POST')
        result = await finance.archiveAccount(
          user.id,
          id,
          z.object({ archived: z.boolean() }).parse(await read()).archived,
        );
      else if (resource === 'accounts' && id && action === 'reconcile' && req.method === 'POST')
        result = await finance.reconcile(user.id, id, await read());
      else if (resource === 'transactions' && !action && !id && req.method === 'POST')
        result = await finance.createManualTransaction(
          user.id,
          await read(),
          z.uuid().parse(req.headers.get('idempotency-key')),
        );
      else if (resource === 'transactions' && !action && id && req.method === 'PATCH')
        result = await finance.saveTransaction(user.id, await read(), id);
      else if (resource === 'transactions' && !action && id && req.method === 'DELETE')
        result = await finance.deleteTransaction(user.id, id);
      else if (resource === 'categories' && !action && !id && req.method === 'POST')
        result = await finance.saveCategory(
          user.id,
          await read(),
          monthSchema.optional().parse(req.nextUrl.searchParams.get('month') ?? undefined),
        );
      else if (resource === 'categories' && !action && id && req.method === 'DELETE')
        result = await finance.deleteCategory(user.id, id);
      else if (resource === 'budgets' && !id && req.method === 'PUT')
        result = await finance.saveBudgets(
          user.id,
          await read(),
          monthSchema.optional().parse(req.nextUrl.searchParams.get('month') ?? undefined),
        );
      else if (resource === 'email-rules' && !action && req.method === 'POST' && !id)
        result = await saveEmailRule(user.id, await read());
      else if (resource === 'email-rules' && !action && req.method === 'PATCH' && id)
        result = await saveEmailRule(user.id, await read(), id);
      else throw new HttpError(404, 'Endpoint tidak ditemukan.');
    }
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    let status = 500,
      message = 'Terjadi kesalahan pada server.';
    if (error instanceof z.ZodError) {
      status = 400;
      message = error.issues.map((i) => i.message).join(' ');
    } else if (error instanceof HttpError) {
      status = error.status;
      message = error.message;
    } else if ((error as { code?: string }).code === '23505') {
      status = 409;
      message = 'Nama sudah digunakan.';
    } else if ((error as { code?: string }).code === '23503') {
      status = 400;
      message = 'Data masih digunakan atau referensi tidak valid.';
    } else if ((error as { code?: string }).code === '23514') {
      status = 400;
      message = 'Data tidak memenuhi aturan pencatatan.';
    } else
      console.error(
        'API failure',
        error instanceof Error ? error.name : 'UnknownError',
        (error as { code?: string }).code ?? '',
      );
    return NextResponse.json(
      { error: { message } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
