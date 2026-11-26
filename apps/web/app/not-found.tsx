import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="auth-wrap">
      <section className="card">
        <h1>Halaman tidak ditemukan</h1>
        <Link href="/dashboard">Kembali ke beranda</Link>
      </section>
    </main>
  );
}
