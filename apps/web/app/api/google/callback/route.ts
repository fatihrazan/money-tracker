import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, SESSION_SECONDS, HttpError } from '../../../../lib/auth';
import {
  consumeGoogleState,
  completeGoogle,
  googleOrigin,
  GOOGLE_STATE_COOKIE,
} from '../../../../lib/google';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  let destination = '/login';
  try {
    const origin = googleOrigin();
    const params = request.nextUrl.searchParams;
    const state = await consumeGoogleState(
      params.get('state') ?? '',
      request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? '',
      request.cookies.get(COOKIE_NAME)?.value,
    );
    if (state.purpose !== 'login') destination = '/integrations';
    if (params.has('error')) throw new HttpError(400, 'Izin Google dibatalkan.');
    const code = params.get('code');
    if (!code || code.length > 4096) throw new HttpError(400, 'Kode Google tidak valid.');
    const result = await completeGoogle(code, state);
    const response = NextResponse.redirect(new URL(result.destination, origin));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/api/google', maxAge: 0 });
    if (result.token)
      response.cookies.set(COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: origin.startsWith('https:'),
        path: '/',
        maxAge: SESSION_SECONDS,
      });
    return response;
  } catch (error) {
    // Never reflect Google responses, codes, or credentials into logs/the URL.
    const message =
      error instanceof HttpError ? error.message : 'Koneksi Google gagal. Coba hubungkan kembali.';
    let origin: string;
    try {
      origin = googleOrigin();
    } catch {
      return NextResponse.json(
        { error: { message: 'Google OAuth belum dikonfigurasi.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const url = new URL(destination, origin);
    url.searchParams.set('google_error', message);
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/api/google', maxAge: 0 });
    return response;
  }
}
