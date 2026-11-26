'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  Wallet,
  House,
  ArrowLeftRight,
  Landmark,
  Tags,
  ChartPie,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { createClient } from '@money/api-client';
export function ThemeButton() {
  const [changing, setChanging] = useState(false);
  return (
    <button
      type="button"
      className="icon-button theme-button"
      aria-label="Ganti tema"
      disabled={changing}
      onClick={async (event) => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        const root = document.documentElement;
        const apply = () => {
          root.dataset.theme = theme;
          document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
            meta.removeAttribute('media');
            meta.content = theme === 'dark' ? '#101c1a' : '#f4f6f3';
          });
          try {
            localStorage.setItem('money-theme', theme);
          } catch {}
        };
        if (
          !document.startViewTransition ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          apply();
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const x = rect.left + rect.width / 2,
          y = rect.top + rect.height / 2;
        root.style.setProperty('--theme-x', `${x}px`);
        root.style.setProperty('--theme-y', `${y}px`);
        root.style.setProperty(
          '--theme-radius',
          `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`,
        );
        root.dataset.themeTransition = 'true';
        setChanging(true);
        try {
          await document.startViewTransition(apply).finished;
        } catch {
          apply();
        } finally {
          delete root.dataset.themeTransition;
          setChanging(false);
        }
      }}
    >
      <Moon className="moon" size={20} />
      <Sun className="sun" size={20} />
    </button>
  );
}
export function AppShell({ username, children }: { username: string; children: React.ReactNode }) {
  const path = usePathname(),
    router = useRouter();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const links = [
    ['/dashboard', 'Beranda', House],
    ['/transactions', 'Transaksi', ArrowLeftRight],
    ['/accounts', 'Akun', Landmark],
    ['/categories', 'Kategori', Tags],
    ['/budgets', 'Anggaran', ChartPie],
  ] as const;
  const nav = links.map(([href, label, Icon]) => (
    <Link href={href} key={href} aria-current={path === href ? 'page' : undefined}>
      <Icon size={20} />
      <span>{label}</span>
    </Link>
  ));
  return (
    <>
      <header className="topbar">
        <Link href="/dashboard" className="brand">
          <span className="brand-icon">
            <Wallet size={21} />
          </span>
          Money Tracker
        </Link>
        <nav className="desktop-nav" aria-label="Navigasi utama">
          {nav}
        </nav>
        <div className="top-actions">
          <ThemeButton />
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" aria-label={`Akun ${username}`} className="avatar">
                {username[0].toUpperCase()}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="user-panel"
                sideOffset={10}
                align="end"
                collisionPadding={12}
              >
                <strong>{username}</strong>
                <Link href="/integrations" className="btn">
                  Google & email transaksi
                </Link>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await createClient().request('auth/logout', 'POST', {});
                      router.replace('/login');
                      router.refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <LogOut size={16} />
                  Keluar
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
      <main className="main">
        <div key={path} className="page-transition">
          {children}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Navigasi utama">
        {nav}
      </nav>
    </>
  );
}
