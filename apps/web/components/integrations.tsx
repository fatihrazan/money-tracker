'use client';
import { useEffect, useState } from 'react';
import { Mail, Pencil, Plus } from 'lucide-react';
import { createClient } from '@money/api-client';
import { today, type Snapshot } from '@money/core';
import {
  bankEmailPresets,
  emailRuleSchema,
  type EmailRule,
  type GmailStatus,
} from '@money/core/email-transactions';
import { TelegramConnect } from './telegram-connect';
import { GoogleButton } from './google-button';
import { Modal } from './modal';
import { SelectField } from './pickers';
import { accountOptions, categoryOptions } from './transaction-options';

const api = createClient();
const dateTime = (value: string) =>
  new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));

export function EmailRuleForm({
  data,
  rule,
  busy,
  onSave,
}: {
  data: Snapshot;
  rule?: EmailRule;
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
}) {
  const [presetId, setPresetId] = useState('custom');
  const [fields, setFields] = useState({
    name: rule?.name ?? '',
    sender: rule?.sender ?? '',
    subject_contains: rule?.subject_contains ?? '',
    body_contains: rule?.body_contains ?? '',
  });
  const [kind, setKind] = useState(rule?.kind ?? 'expense');
  const [accountId, setAccountId] = useState(rule?.account_id ?? '');
  const [destination, setDestination] = useState(rule?.to_account_id ?? '');
  const [category, setCategory] = useState(rule?.category_id ?? '');
  const [error, setError] = useState('');
  const accounts = data.accounts.filter((account) => !account.archived);
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const result = emailRuleSchema.safeParse({
          ...Object.fromEntries(form),
          kind,
          account_id: accountId,
          to_account_id: kind === 'transfer' ? destination || null : null,
          category_id: kind === 'transfer' ? null : category || null,
          enabled: form.get('enabled') === 'on',
        });
        setError(result.success ? '' : result.error.issues[0].message);
        if (result.success) await onSave(result.data);
      }}
    >
      {!rule && (
        <label>
          Format email bank
          <SelectField
            label="Format email bank"
            value={presetId}
            onValueChange={(value) => {
              const preset = bankEmailPresets.find((item) => item.id === value);
              setPresetId(value);
              setFields({
                name: preset?.name ?? '',
                sender: preset?.sender ?? '',
                subject_contains: preset?.subject_contains ?? '',
                body_contains: preset?.body_contains ?? '',
              });
              setKind(preset?.kind ?? 'expense');
              setAccountId('');
              setDestination('');
              setCategory('');
              setError('');
            }}
            options={[
              { value: 'custom', label: 'Isi sendiri' },
              ...bankEmailPresets.map(({ id, label }) => ({ value: id, label })),
            ]}
            disabled={busy}
          />
        </label>
      )}
      {presetId !== 'custom' && (
        <p className="muted">
          Pengirim dan penanda email sudah diisi. Pilih rekening dan kategori untuk aturan ini.
          {presetId === 'mandiri-transfer' &&
            ' Transfer ke orang lain dicatat sebagai pengeluaran. Untuk rekening milikmu, pilih Transfer antar akun sendiri.'}
        </p>
      )}
      <label>
        Nama aturan
        <input
          name="name"
          value={fields.name}
          onChange={(event) => setFields({ ...fields, name: event.target.value })}
          placeholder="Contoh: Pembayaran dari rekening utama"
          maxLength={80}
          required
        />
      </label>
      <label>
        Email pengirim bank
        <input
          name="sender"
          type="email"
          value={fields.sender}
          onChange={(event) => setFields({ ...fields, sender: event.target.value })}
          placeholder="Salin alamat pengirim dari email bank"
          maxLength={254}
          required
        />
      </label>
      <label>
        Subjek email mengandung
        <input
          name="subject_contains"
          value={fields.subject_contains}
          onChange={(event) => setFields({ ...fields, subject_contains: event.target.value })}
          placeholder="Bagian subjek khusus jenis transaksi ini"
          minLength={3}
          maxLength={160}
          required
        />
      </label>
      <label>
        Isi email mengandung (opsional)
        <input
          name="body_contains"
          value={fields.body_contains}
          onChange={(event) => setFields({ ...fields, body_contains: event.target.value })}
          placeholder="Contoh: nama merchant atau penanda rekening"
          maxLength={160}
        />
      </label>
      <p className="muted">
        Gunakan penanda yang membedakan rekening dan jenis transaksi. Hanya email baru setelah
        aturan dibuat yang diproses.
      </p>
      <label>
        Jenis pencatatan
        <SelectField
          label="Jenis pencatatan email"
          value={kind}
          onValueChange={(value) => {
            setKind(value as EmailRule['kind']);
            setCategory('');
          }}
          options={[
            { value: 'expense', label: 'Pengeluaran' },
            { value: 'income', label: 'Pemasukan' },
            { value: 'transfer', label: 'Transfer antar akun sendiri' },
          ]}
          required
          disabled={busy}
        />
      </label>
      <label>
        {kind === 'income' ? 'Rekening penerima' : 'Rekening sumber'}
        <SelectField
          label="Rekening email"
          value={accountId}
          onValueChange={setAccountId}
          options={accountOptions(accounts)}
          required
          disabled={busy}
        />
      </label>
      {kind === 'transfer' ? (
        <label>
          Rekening tujuan
          <SelectField
            label="Tujuan transfer email"
            value={destination}
            onValueChange={setDestination}
            options={accountOptions(accounts.filter((account) => account.id !== accountId))}
            required
            disabled={busy}
          />
        </label>
      ) : (
        <label>
          Kategori otomatis
          <SelectField
            label="Kategori otomatis"
            value={category}
            onValueChange={setCategory}
            options={categoryOptions(data.categories.filter((item) => item.kind === kind))}
            required
            disabled={busy}
          />
        </label>
      )}
      <label className="check-label">
        <input name="enabled" type="checkbox" defaultChecked={rule?.enabled ?? true} />
        Aktifkan aturan ini
      </label>
      <p className="muted">
        Email yang cocok akan langsung menambah transaksi tanpa konfirmasi. Jika beberapa aturan
        cocok atau informasi transaksi tidak lengkap, email dilewati dan alasannya tampil di
        riwayat.
      </p>
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan aturan'}
      </button>
    </form>
  );
}

export function Integrations({
  googleError = '',
  connected = false,
}: {
  googleError?: string;
  connected?: boolean;
}) {
  const [status, setStatus] = useState<GmailStatus>();
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState(googleError);
  const [notice, setNotice] = useState(connected ? 'Google berhasil terhubung.' : '');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ rule?: EmailRule }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.request<GmailStatus>('integrations/google'),
      api.snapshot(today().slice(0, 7)),
    ])
      .then(([next, snapshot]) => {
        if (active) {
          setStatus(next);
          setData(snapshot);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!editor && !busy && document.visibilityState === 'visible')
        setRevision((value) => value + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [editor, busy]);
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.request<{ message: string }>(path, method, body);
      setNotice(result.message);
      setEditor(undefined);
      setRevision((value) => value + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Integrasi</h1>
      </div>
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="flash success" role="status">
          {notice}
        </p>
      )}
      <TelegramConnect />
      {!status || !data ? (
        <section className="card empty">
          {error ? (
            <button className="btn" onClick={() => setRevision((v) => v + 1)}>
              Coba lagi
            </button>
          ) : (
            'Memuat…'
          )}
        </section>
      ) : (
        <div className="workspace">
          <section className="card integration-card">
            <h2>Login Google</h2>
            {status.identity ? (
              <p>
                Terhubung sebagai <strong>{status.identity.email}</strong>.
              </p>
            ) : (
              <>
                <p className="muted">
                  Tautkan Google ke akun ini untuk masuk menggunakan email Google dan tetap memakai
                  data yang sudah ada.
                </p>
                <GoogleButton purpose="link" disabled={!status.google_configured || busy}>
                  Tautkan akun Google
                </GoogleButton>
              </>
            )}
            {!status.google_configured && (
              <p className="flash">
                Pengelola perlu mengisi konfigurasi Google OAuth agar fitur ini aktif.
              </p>
            )}
          </section>
          <section className="card integration-card">
            <div className="section-head">
              <h2>Impor otomatis dari Gmail</h2>
              <Mail size={21} />
            </div>
            <p className="muted">
              Beri izin membaca Gmail sekali, lalu tentukan aturan bank. Email transaksi yang
              dikenali langsung dicatat ke rekening dan kategori pilihanmu.
            </p>
            {!status.gmail_configured && (
              <p className="flash">
                Konfigurasi Gmail dan kunci enkripsi perlu disiapkan oleh pengelola.
              </p>
            )}
            {status.connection?.connected ? (
              <>
                <p>
                  <strong>
                    {status.connection.enabled ? 'Impor otomatis aktif' : 'Impor dijeda'}
                  </strong>{' '}
                  · {status.identity?.email}
                </p>
                <p className="muted">
                  Sinkronisasi terakhir:{' '}
                  {status.connection.last_synced_at
                    ? dateTime(status.connection.last_synced_at)
                    : 'Menunggu sinkronisasi pertama'}
                  .
                </p>
                {!status.worker_active && (
                  <p className="flash">
                    Proses sinkronisasi belum aktif. Jalankan server dengan konfigurasi Gmail atau
                    proses sinkronisasi terpisah.
                  </p>
                )}
                {status.connection.last_error && (
                  <p className="flash error">{status.connection.last_error}</p>
                )}
                <div className="integration-actions">
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      mutate('integrations/gmail', 'PATCH', {
                        action: status.connection!.enabled ? 'pause' : 'resume',
                      })
                    }
                  >
                    {status.connection.enabled ? 'Jeda impor' : 'Aktifkan impor'}
                  </button>
                  <GoogleButton purpose="gmail" disabled={busy || !status.gmail_configured}>
                    Hubungkan ulang Gmail
                  </GoogleButton>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => mutate('integrations/gmail', 'PATCH', { action: 'disconnect' })}
                  >
                    Putuskan Gmail
                  </button>
                </div>
              </>
            ) : (
              <GoogleButton purpose="gmail" disabled={!status.gmail_configured || busy}>
                Hubungkan Gmail
              </GoogleButton>
            )}
            <p className="muted">
              Pemeriksaan dilakukan sekitar setiap {status.sync_interval_minutes ?? 1} menit selama
              server aktif. Email lama sebelum koneksi/aturan dibuat tidak diimpor. Izin hanya untuk
              membaca email.
            </p>
          </section>
          <section className="card integration-card">
            <div className="section-head">
              <h2>Aturan email bank</h2>
              <button className="btn primary" disabled={busy} onClick={() => setEditor({})}>
                <Plus size={17} />
                Tambah aturan
              </button>
            </div>
            {status.rules.length ? (
              status.rules.map((rule) => (
                <div className="email-rule-row" key={rule.id}>
                  <div className="row-main">
                    <strong>{rule.name}</strong>
                    <small className="muted">
                      {rule.sender} · {rule.enabled ? 'Aktif' : 'Nonaktif'}
                    </small>
                    <small className="muted">
                      {data.accounts.find((account) => account.id === rule.account_id)?.name} →{' '}
                      {rule.kind === 'transfer'
                        ? data.accounts.find((account) => account.id === rule.to_account_id)?.name
                        : data.categories.find((category) => category.id === rule.category_id)
                            ?.name}
                    </small>
                  </div>
                  <button
                    className="btn small"
                    aria-label={`Ubah aturan ${rule.name}`}
                    disabled={busy}
                    onClick={() => setEditor({ rule })}
                  >
                    <Pencil size={15} />
                    Ubah
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">
                Belum ada aturan. Buat aturan agar email bank bisa dipetakan ke rekening dan
                kategori.
              </p>
            )}
          </section>
          <section className="card integration-card">
            <div className="section-head">
              <h2>Riwayat impor terbaru</h2>
              <button className="btn small" onClick={() => setRevision((value) => value + 1)}>
                Perbarui
              </button>
            </div>
            {status.imports.length ? (
              status.imports.map((item) => (
                <div className="email-rule-row" key={item.id}>
                  <div className="row-main">
                    <strong>{item.rule_name ?? 'Email bank'}</strong>
                    <small>
                      {item.reason}
                      {item.status === 'imported' && !item.transaction_id
                        ? ' Transaksi telah dihapus.'
                        : ''}
                    </small>
                    <small className="muted">{dateTime(item.received_at)}</small>
                  </div>
                  <span className="badge">
                    {
                      { imported: 'Tercatat', skipped: 'Dilewati', duplicate: 'Duplikat' }[
                        item.status
                      ]
                    }
                  </span>
                </div>
              ))
            ) : (
              <p className="muted">Belum ada email yang diproses.</p>
            )}
          </section>
        </div>
      )}
      {editor && data && (
        <Modal
          title={editor.rule ? 'Ubah aturan email' : 'Tambah aturan email'}
          onClose={() => {
            if (!busy) setEditor(undefined);
          }}
        >
          {error && (
            <p className="flash error" role="alert">
              {error}
            </p>
          )}
          <EmailRuleForm
            data={data}
            rule={editor.rule}
            busy={busy}
            onSave={(body) =>
              mutate(
                editor.rule ? `email-rules/${editor.rule.id}` : 'email-rules',
                editor.rule ? 'PATCH' : 'POST',
                body,
              )
            }
          />
        </Modal>
      )}
    </>
  );
}
