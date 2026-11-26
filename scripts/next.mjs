import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load root configuration before starting Next without forwarding --env-file flags
// into Next's build workers (Node 20 rejects those flags in NODE_OPTIONS).
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    ...process.argv.slice(2),
  ],
  {
    cwd: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    stdio: 'inherit',
    env: process.env,
  },
);
const syncEnabled =
  ['dev', 'start'].includes(process.argv[2]) &&
  process.env.GMAIL_SYNC_ENABLED !== 'false' &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GMAIL_TOKEN_KEY;
const worker = syncEnabled
  ? spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('./gmail-worker.ts', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdio: 'inherit',
        env: process.env,
        windowsHide: true,
      },
    )
  : undefined;
const telegramEnabled =
  ['dev', 'start'].includes(process.argv[2]) &&
  process.env.TELEGRAM_ENABLED !== 'false' &&
  process.env.TELEGRAM_TRANSPORT !== 'webhook' &&
  process.env.TELEGRAM_BOT_TOKEN &&
  process.env.TELEGRAM_BOT_USERNAME;
const telegramWorker = telegramEnabled
  ? spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('./telegram-worker.ts', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdio: 'inherit',
        env: process.env,
        windowsHide: true,
      },
    )
  : undefined;
telegramWorker?.on('error', () => console.error('Proses bot Telegram tidak dapat dijalankan.'));
worker?.on('error', () => console.error('Proses sinkronisasi Gmail tidak dapat dijalankan.'));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child.kill(signal);
    worker?.kill(signal);
    telegramWorker?.kill(signal);
  });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  worker?.kill();
  telegramWorker?.kill();
  process.exitCode = code ?? 1;
});
