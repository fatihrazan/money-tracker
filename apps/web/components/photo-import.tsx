'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanLine, LoaderCircle, ChevronDown } from 'lucide-react';
import {
  extractPhotoTransaction,
  type PhotoDraft,
  type PhotoKind,
} from '@money/core/photo-transaction';
import { rupiah, type Snapshot } from '@money/core';
import {
  PHOTO_ACCEPT,
  scanPhoto,
  validatePhoto,
  type PhotoScanner,
  type ScanProgress,
} from '../lib/scan-photo';
import { Modal } from './modal';
import { SelectField } from './pickers';

export function PhotoImport({
  data,
  onApply,
  disabled = false,
  scanner = scanPhoto,
}: {
  data: Snapshot;
  onApply: (draft: PhotoDraft) => void;
  disabled?: boolean;
  scanner?: PhotoScanner;
}) {
  const [open, setOpen] = useState(false),
    [reading, setReading] = useState(false);
  const [preview, setPreview] = useState(''),
    [filename, setFilename] = useState('');
  const [text, setText] = useState(''),
    [confidence, setConfidence] = useState(100),
    [error, setError] = useState('');
  const [override, setOverride] = useState<PhotoKind>();
  const [progress, setProgress] = useState<ScanProgress>({ value: 0, label: 'Menyiapkan foto' });
  const upload = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const draft = useMemo(
    () => extractPhotoTransaction(text, data.accounts, data.categories, override),
    [text, data.accounts, data.categories, override],
  );

  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function close() {
    active.current?.abort();
    active.current = null;
    setOpen(false);
    setReading(false);
    setPreview('');
    setText('');
    setFilename('');
    setError('');
    setOverride(undefined);
  }
  async function choose(file: File) {
    active.current?.abort();
    active.current = null;
    setReading(false);
    setError('');
    setText('');
    setOverride(undefined);
    try {
      validatePhoto(file);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPreview(URL.createObjectURL(file));
    setFilename(file.name);
    setReading(true);
    setProgress({ value: 0, label: 'Menyiapkan foto' });
    try {
      const result = await scanner(file, {
        signal: controller.signal,
        onProgress: (next) => {
          if (active.current === controller && !controller.signal.aborted)
            setProgress((previous) => ({ ...next, value: Math.max(previous.value, next.value) }));
        },
      });
      if (active.current !== controller || controller.signal.aborted) return;
      if (!result.text.trim())
        throw new Error('Teks belum terbaca. Coba foto yang lebih jelas dan tidak terpotong.');
      setText(result.text.slice(0, 16000));
      setConfidence(result.confidence);
    } catch (e) {
      if (active.current === controller && !controller.signal.aborted)
        setError(
          e instanceof Error && /foto|JPG|PNG|WebP|Browser|browser|Resolusi|Teks/.test(e.message)
            ? e.message
            : 'Foto belum dapat dibaca. Coba lagi atau gunakan foto yang lebih jelas.',
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setReading(false);
      }
    }
  }
  const accountName = (id: string | null) =>
    data.accounts.find((account) => account.id === id)?.name ?? 'Belum terbaca';
  return (
    <>
      <button
        type="button"
        className="photo-entry"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ScanLine size={18} />
        <span>Isi dari foto</span>
        <ImagePlus size={16} />
      </button>
      {open && (
        <Modal title="Baca transaksi dari foto" onClose={close}>
          <input
            ref={upload}
            type="file"
            accept={PHOTO_ACCEPT}
            tabIndex={-1}
            className="sr-only"
            aria-label="Unggah foto transaksi"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void choose(file);
            }}
          />
          <input
            ref={camera}
            type="file"
            accept={PHOTO_ACCEPT}
            capture="environment"
            tabIndex={-1}
            className="sr-only"
            aria-label="Ambil foto transaksi"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void choose(file);
            }}
          />
          {!preview && (
            <div
              className="photo-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void choose(file);
              }}
            >
              <span className="photo-drop-icon">
                <ScanLine size={30} />
              </span>
              <strong>Struk atau bukti transaksi</strong>
              <p>JPG, PNG, atau WebP · maksimal 12 MB</p>
              <div className="photo-choices">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => upload.current?.click()}
                >
                  <ImagePlus size={16} />
                  Pilih foto
                </button>
                <button type="button" className="btn" onClick={() => camera.current?.click()}>
                  <Camera size={16} />
                  Kamera
                </button>
              </div>
            </div>
          )}
          {preview && (
            <div className="photo-selected">
              <img src={preview} alt="Foto transaksi yang dipilih" />
              <div>
                <strong>{filename}</strong>
                <small>
                  {reading
                    ? 'Sedang dibaca'
                    : text
                      ? 'Foto siap diperiksa'
                      : 'Pembacaan belum berhasil'}
                </small>
                {!reading && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => upload.current?.click()}
                  >
                    Ganti foto
                  </button>
                )}
              </div>
            </div>
          )}
          {reading && (
            <div className="photo-progress" role="status">
              <div>
                <LoaderCircle className="spin" size={17} />
                <span>{progress.label}</span>
                <small>{progress.value}%</small>
              </div>
              <progress value={progress.value} max={100} aria-label="Proses membaca foto" />
              <button type="button" className="btn small" onClick={close}>
                Batalkan
              </button>
            </div>
          )}
          {error && (
            <p className="flash error" role="alert">
              {error}
            </p>
          )}
          {text && !reading && (
            <div className="photo-review">
              <label>
                Jenis transaksi
                <SelectField
                  label="Jenis transaksi pada foto"
                  value={draft.kind ?? ''}
                  onValueChange={(value) => setOverride(value as PhotoKind)}
                  placeholder="Pilih jenis"
                  options={[
                    { value: 'expense', label: 'Pengeluaran' },
                    { value: 'income', label: 'Pemasukan' },
                    { value: 'transfer', label: 'Transfer' },
                  ]}
                />
              </label>
              <dl className="photo-summary">
                <div>
                  <dt>Nominal</dt>
                  <dd>{draft.amount === null ? 'Belum terbaca' : rupiah(draft.amount)}</dd>
                </div>
                <div>
                  <dt>Tanggal</dt>
                  <dd>
                    {draft.date
                      ? new Intl.DateTimeFormat('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(`${draft.date}T00:00:00Z`))
                      : 'Belum terbaca'}
                  </dd>
                </div>
                <div>
                  <dt>{draft.kind === 'income' ? 'Ke akun' : 'Dari akun'}</dt>
                  <dd>{accountName(draft.account_id)}</dd>
                </div>
                {draft.kind === 'transfer' ? (
                  <>
                    <div>
                      <dt>Ke akun</dt>
                      <dd>{accountName(draft.to_account_id)}</dd>
                    </div>
                    <div>
                      <dt>Biaya admin</dt>
                      <dd>{rupiah(draft.fee)}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>Kategori</dt>
                    <dd>
                      {data.categories.find((category) => category.id === draft.category_id)
                        ?.name ?? 'Pilih di form'}
                    </dd>
                  </div>
                )}
              </dl>
              {(confidence < 60 || draft.warnings.length > 0) && (
                <div className="photo-review-hint">
                  {confidence < 60 && <p>Teks kurang jelas. Periksa nominal dan tanggal.</p>}
                  {draft.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
              <details className="photo-text">
                <summary>
                  Teks terbaca
                  <ChevronDown size={15} />
                </summary>
                <textarea
                  aria-label="Teks terbaca dari foto"
                  value={text}
                  maxLength={16000}
                  onChange={(event) => setText(event.target.value)}
                />
              </details>
              <button
                type="button"
                className="btn primary full"
                disabled={!draft.kind || draft.amount === null}
                onClick={() => {
                  onApply(draft);
                  close();
                }}
              >
                Gunakan hasil
              </button>
              <p className="photo-footnote">Periksa dan lengkapi form sebelum menyimpan.</p>
            </div>
          )}
          <p className="photo-privacy">Foto dibaca di perangkat dan tidak disimpan di server.</p>
        </Modal>
      )}
    </>
  );
}
