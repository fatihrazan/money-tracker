import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

// No project .env, fixed host port, or persistent database volume needed.
const name = `money-test-${randomUUID()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
function testDatabase(url) {
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'test:integration'],
    {
      stdio: 'inherit',
      env: { ...process.env, TEST_DATABASE_URL: url },
    },
  );
  process.exitCode = result.status ?? 1;
}
async function nativeWindows() {
  const probe = createServer();
  await new Promise((resolve, reject) =>
    probe.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  const port = String(probe.address().port);
  await new Promise((resolve) => probe.close(resolve));
  const dir = mkdtempSync(join(tmpdir(), 'money-test-'));
  const cluster = join(dir, 'data'),
    password = randomUUID(),
    pwFile = join(dir, 'password');
  let started = false;
  try {
    writeFileSync(pwFile, password);
    execFileSync('initdb', [
      '-D',
      cluster,
      '-U',
      'postgres',
      `--pwfile=${pwFile}`,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ]);
    execFileSync(
      'pg_ctl',
      [
        '-D',
        cluster,
        '-l',
        join(dir, 'postgres.log'),
        '-o',
        `-h 127.0.0.1 -p ${port}`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    );
    started = true;
    execFileSync('createdb', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', 'money_test'], {
      env: { ...process.env, PGPASSWORD: password },
    });
    testDatabase(`postgresql://postgres:${password}@127.0.0.1:${port}/money_test`);
  } finally {
    if (started) execFileSync('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  }
}
if (process.platform === 'win32' && spawnSync('initdb', ['--version']).status === 0) {
  await nativeWindows();
} else {
  docker(
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_PASSWORD=test',
    '-e',
    'POSTGRES_DB=money_test',
    '-p',
    '127.0.0.1::5432',
    '--health-cmd',
    'pg_isready -h 127.0.0.1 -U postgres -d money_test',
    '--health-interval',
    '1s',
    '--health-timeout',
    '2s',
    '--health-retries',
    '60',
    'postgres:18-alpine',
  );
  try {
    let ready = false;
    for (let i = 0; i < 65; i++) {
      if (docker('inspect', '--format', '{{.State.Health.Status}}', name) === 'healthy') {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('PostgreSQL uji tidak siap.');
    const port = docker('port', name, '5432/tcp').split(':').at(-1);
    testDatabase(`postgresql://postgres:test@127.0.0.1:${port}/money_test`);
  } finally {
    docker('rm', '-f', name);
  }
}
