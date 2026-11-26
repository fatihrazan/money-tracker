'use client';
import { useState } from 'react';

export function GoogleButton({
  purpose = 'login',
  disabled = false,
  children = 'Lanjutkan dengan Google',
}: {
  purpose?: 'login' | 'link' | 'gmail';
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        className="btn google-button"
        type="button"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/api/google/start', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ purpose }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error?.message ?? 'Tidak dapat menghubungkan Google.');
            window.location.assign(result.data.url);
          } catch (error) {
            setError((error as Error).message);
            setBusy(false);
          }
        }}
      >
        <span className="google-letter" aria-hidden="true">
          G
        </span>
        {busy ? 'Menghubungkan…' : children}
      </button>
      {error && (
        <p className="flash error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
