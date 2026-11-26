import { pool } from '@money/database';
import { gmailConfigured } from '../apps/web/lib/google';
import { syncAllGmail } from '../apps/web/lib/gmail';

let stopped = false;
let wake: (() => void) | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopped = true;
    wake?.();
  });
if (!gmailConfigured()) {
  console.error(
    'Gmail worker: isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_ORIGIN, dan GMAIL_TOKEN_KEY.',
  );
  process.exitCode = 1;
} else {
  console.log('Sinkronisasi Gmail aktif; interval 60 detik.');
  while (!stopped) {
    try {
      await syncAllGmail();
    } catch {
      console.error('Sinkronisasi Gmail tertunda. Periksa koneksi database dan migrasi.');
    }
    if (process.argv.includes('--once') || stopped) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
await pool().end();
