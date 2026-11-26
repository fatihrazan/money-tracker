import { randomBytes, scrypt as scryptCallback, timingSafeEqual, pbkdf2Sync } from 'node:crypto';
const derive = (password: string, salt: string, N: number, r: number, p: number, length: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      length,
      { N, r, p, maxmem: Math.max(128 * N * r + 1024 * 1024, 64 * 1024 * 1024) },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:32768:8:1$${salt}$${(await derive(password, salt, 32768, 8, 1, 64)).toString('hex')}`;
}
// Werkzeug uses the same scrypt/PBKDF2 encoding: imported users keep their passwords.
export async function verifyPassword(password: string, encoded: string) {
  try {
    const [method, salt, hex] = encoded.split('$');
    if (!salt || !/^[0-9a-f]+$/i.test(hex ?? '') || hex.length % 2) return false;
    const expected = Buffer.from(hex, 'hex');
    const [algorithm, a, b, c] = method.split(':');
    let actual: Buffer;
    if (algorithm === 'scrypt') {
      const [N, r, p] = [Number(a), Number(b), Number(c)];
      if (N < 2 || N > 131072 || r < 1 || r > 16 || p < 1 || p > 8 || expected.length > 128)
        return false;
      actual = await derive(password, salt, N, r, p, expected.length);
    } else if (
      algorithm === 'pbkdf2' &&
      ['sha256', 'sha512'].includes(a) &&
      Number(b) > 0 &&
      Number(b) <= 2_000_000
    ) {
      actual = pbkdf2Sync(password, salt, Number(b), expected.length, a);
    } else return false;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
