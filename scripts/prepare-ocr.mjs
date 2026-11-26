import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const target = fileURLToPath(new URL('../apps/web/public/ocr/', import.meta.url));
const engine = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
await mkdir(join(target, 'core'), { recursive: true });
await mkdir(join(target, 'lang'), { recursive: true });
await copyFile(join(engine, 'dist/worker.min.js'), join(target, 'worker.min.js'));
await copyFile(join(engine, 'LICENSE.md'), join(target, 'TESSERACT-LICENSE.md'));
await copyFile(join(engine, 'dist/worker.min.js.LICENSE.txt'), join(target, 'worker.min.js.LICENSE.txt'));
await copyFile(join(core, 'LICENSE'), join(target, 'core/LICENSE'));
for (const file of await readdir(core)) {
  if (/^tesseract-core.*(?:\.wasm|\.wasm\.js)$/.test(file))
    await copyFile(join(core, file), join(target, 'core', file));
}
for (const code of ['eng', 'ind']) {
  const directory = dirname(require.resolve(`@tesseract.js-data/${code}/package.json`));
  await copyFile(
    join(directory, '4.0.0_best_int', `${code}.traineddata.gz`),
    join(target, 'lang', `${code}.traineddata.gz`),
  );
}
const version = JSON.parse(await readFile(join(engine, 'package.json'), 'utf8')).version;
await writeFile(
  join(target, 'version.json'),
  JSON.stringify({ engine: version, languages: ['eng', 'ind'] }),
);
console.log(`OCR assets ready: Tesseract ${version}, Indonesian + English (self-hosted).`);
