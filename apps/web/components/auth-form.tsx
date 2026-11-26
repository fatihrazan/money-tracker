'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Wallet, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@money/api-client';
import { ThemeButton } from './shell';
import { GoogleButton } from './google-button';
export function AuthForm({
  signup = false,
  googleEnabled = false,
  googleError = '',
}: {
  signup?: boolean;
  googleEnabled?: boolean;
  googleError?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [show, setShow] = useState(false);
  const router = useRouter();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Wallet size={21} />
          </span>
          Money Tracker
        </Link>
        <ThemeButton />
      </header>
      <main className="auth-wrap">
        <section className="card auth-card">
          <span className="auth-mark">
            <Wallet size={25} />
          </span>
          <h1>{signup ? 'Buat akun' : 'Masuk'}</h1>
          {googleError && (
            <p className="flash error" role="alert">
              {googleError}
            </p>
          )}
          <GoogleButton disabled={!googleEnabled || busy} />
          {googleEnabled && (
            <p className="muted">
              Sudah punya akun dengan nama pengguna? Masuk dulu, lalu tautkan Google lewat menu
              profil agar data tetap pada akun yang sama.
            </p>
          )}
          {!googleEnabled && (
            <p className="muted">Login Google belum diaktifkan oleh pengelola aplikasi.</p>
          )}
          <p className="auth-divider muted">atau gunakan nama pengguna</p>
          {error && (
            <p className="flash error" role="alert">
              {error}
            </p>
          )}
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const form = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await createClient().request(`auth/${signup ? 'signup' : 'login'}`, 'POST', form);
                router.replace('/dashboard');
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nama pengguna
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                maxLength={30}
                required
                placeholder="Nama pengguna"
              />
              {signup && (
                <small className="muted">
                  3–30 karakter: huruf kecil, angka, titik, atau garis bawah.
                </small>
              )}
            </label>
            <label>
              Kata sandi
              <div className="password-wrap">
                <input
                  name="password"
                  type={show ? 'text' : 'password'}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  minLength={signup ? 8 : undefined}
                  maxLength={128}
                  required
                  placeholder={signup ? 'Minimal 8 karakter' : 'Kata sandimu'}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {signup && (
              <label>
                Ulangi kata sandi
                <input
                  name="confirm"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                />
              </label>
            )}
            <button className="btn primary full" disabled={busy}>
              {busy ? 'Memproses…' : signup ? 'Buat akun' : 'Masuk'}
            </button>
          </form>
          <p className="auth-switch">
            {signup ? 'Sudah punya akun?' : 'Belum punya akun?'}{' '}
            <Link href={signup ? '/login' : '/signup'}>{signup ? 'Masuk' : 'Daftar'}</Link>
          </p>
        </section>
      </main>
    </>
  );
}
