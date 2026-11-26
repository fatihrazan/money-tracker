import type { Worker } from 'tesseract.js';

export const PHOTO_LIMIT = 12 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export type ScanProgress = { value: number; label: string };
export type ScanResult = { text: string; confidence: number };
export type PhotoScanner = (
  file: File,
  options: { signal: AbortSignal; onProgress: (progress: ScanProgress) => void },
) => Promise<ScanResult>;

export function validatePhoto(file: Pick<File, 'size' | 'type' | 'name'>) {
  if (!file.size) throw new Error('Foto kosong. Pilih foto lain.');
  if (file.size > PHOTO_LIMIT) throw new Error('Ukuran foto maksimal 12 MB.');
  if (
    !PHOTO_ACCEPT.split(',').includes(file.type) &&
    !(file.type === '' && /\.(?:jpe?g|png|webp)$/i.test(file.name))
  )
    throw new Error('Gunakan foto JPG, PNG, atau WebP.');
}
const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Pembacaan dibatalkan.', 'AbortError');
};
async function imageForOcr(file: File, signal: AbortSignal) {
  validatePhoto(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error('File bukan foto JPG, PNG, atau WebP yang valid.');
  checkAbort(signal);
  if (typeof createImageBitmap !== 'function')
    throw new Error('Browser ini belum mendukung pembacaan foto. Gunakan browser terbaru.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50_000_000)
      throw new Error('Resolusi foto terlalu besar. Pilih foto yang lebih kecil.');
    const scale = Math.min(2, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser tidak mendukung pembacaan foto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    checkAbort(signal);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

export const scanPhoto: PhotoScanner = async (file, { signal, onProgress }) => {
  checkAbort(signal);
  onProgress({ value: 2, label: 'Menyiapkan foto' });
  const image = await imageForOcr(file, signal);
  const { createWorker, OEM } = await import('tesseract.js');
  checkAbort(signal);
  const origin = window.location.origin;
  let worker: Worker | undefined;
  let rejectAbort: ((reason: DOMException) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => rejectAbort?.(new DOMException('Pembacaan dibatalkan.', 'AbortError'));
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const loading = createWorker(['ind', 'eng'], OEM.LSTM_ONLY, {
      workerPath: `${origin}/ocr/worker.min.js`,
      corePath: `${origin}/ocr/core`,
      langPath: `${origin}/ocr/lang`,
      workerBlobURL: false,
      gzip: true,
      cachePath: 'money-ocr-v1',
      errorHandler: () => {},
      logger: ({ status, progress }) => {
        if (signal.aborted) return;
        const recognizing = status === 'recognizing text';
        onProgress({
          value: recognizing
            ? Math.round(60 + progress * 39)
            : status.includes('language')
              ? Math.round(25 + progress * 25)
              : 15,
          label: recognizing ? 'Membaca transaksi' : 'Menyiapkan pembaca foto',
        });
      },
    });
    void loading.then(
      (ready) => {
        if (signal.aborted) void ready.terminate();
      },
      () => {},
    );
    worker = await Promise.race([loading, aborted]);
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    checkAbort(signal);
    const result = await Promise.race([worker.recognize(image, { rotateAuto: true }), aborted]);
    onProgress({ value: 100, label: 'Pembacaan selesai' });
    return { text: result.data.text.slice(0, 16000), confidence: result.data.confidence };
  } finally {
    signal.removeEventListener('abort', cancel);
    if (worker) await worker.terminate().catch(() => {});
  }
};
