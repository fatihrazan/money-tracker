'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-wrap">
      <section className="card">
        <h1>Aplikasi belum bisa dimuat</h1>
        <p>Periksa koneksi PostgreSQL dan konfigurasi server, lalu coba lagi.</p>
        <button className="btn primary" onClick={reset}>
          Coba lagi
        </button>
      </section>
    </main>
  );
}
