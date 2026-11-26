import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAME, HttpError } from '../../../../lib/auth';
import { beginGoogle, googleOrigin, GOOGLE_STATE_COOKIE } from '../../../../lib/google';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const origin = googleOrigin();
    if (
      request.headers.get('origin') !== origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new HttpError(403, 'Asal permintaan tidak diizinkan.');
    const body = await request.text();
    if (body.length > 1000) throw new HttpError(400, 'Permintaan tidak valid.');
    const { purpose } = z
      .object({
        purpose: z.enum(['login', 'link', 'gmail']),
      })
      .parse(JSON.parse(body));
    const result = await beginGoogle(purpose, request.cookies.get(COOKIE_NAME)?.value);
    const response = NextResponse.json(
      { data: { url: result.url } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    response.cookies.set(GOOGLE_STATE_COOKIE, result.browser, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https:'),
      path: '/api/google',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: error instanceof HttpError ? error.message : 'Tidak dapat memulai login Google.',
        },
      },
      {
        status: error instanceof HttpError ? error.status : 400,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
