'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@money/api-client';
const api = createClient();
type Status = { configured: boolean; connected: boolean; username: string | null };
export function TelegramConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () =>
      api
        .request<Status>('integrations/telegram')
        .then((value) => {
          if (active) {
            setStatus(value);
            if (value.connected) setUrl('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function act(disconnect: boolean) {
    setBusy(true);
    setError('');
    try {
      if (disconnect) {
        await api.request('integrations/telegram', 'DELETE', {});
        setUrl('');
      } else {
        const result = await api.request<{ url: string }>('integrations/telegram/link', 'POST', {});
        setUrl(result.url);
      }
      setStatus(await api.request<Status>('integrations/telegram'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card integration-card" aria-label="Integrasi Telegram">
      <h2>Bot Telegram</h2>
      <p>
        Ceritakan pengeluaran, pemasukan, atau transfer dengan bahasa sehari-hari di chat pribadi.
        Bot akan bertanya jika belum jelas. Periksa ringkasan, lalu tekan Simpan di bot.
      </p>
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p role="status">Memuat status Telegram?</p>
      ) : !status.configured ? (
        <p className="muted">
          Pengelola perlu mengisi TELEGRAM_BOT_TOKEN dan TELEGRAM_BOT_USERNAME di server, lalu
          menjalankan worker Telegram.
        </p>
      ) : (
        <>
          <p role="status">
            {status.connected ? 'Telegram terhubung' : 'Telegram belum terhubung'} ? @
            {status.username}
          </p>
          <button className="btn" disabled={busy} onClick={() => act(status.connected)}>
            {busy ? 'Memproses?' : status.connected ? 'Putuskan Telegram' : 'Buat tautan Telegram'}
          </button>
          {url && (
            <p>
              <a className="btn primary" href={url} target="_blank" rel="noreferrer">
                Buka bot Telegram
              </a>{' '}
              Tautan berlaku 10 menit. Tekan Start di bot; jangan bagikan tautan ini.
            </p>
          )}
          <p className="muted">
            Ketik /bantuan, /akun, atau /kategori di bot. Worker harus tetap aktif.
          </p>
        </>
      )}
    </section>
  );
}
