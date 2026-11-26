import { timingSafeEqual } from 'node:crypto';

export function secretMatches(expected: string, actual: string | null) {
  if (!actual) return false;
  const left = Buffer.from(expected),
    right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function readLimitedJson(request: Request, limit = 64000) {
  if (!request.body) throw new Error('Invalid JSON');
  if (Number(request.headers.get('content-length')) > limit) throw new RangeError('Body too large');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
