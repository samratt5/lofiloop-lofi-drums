'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f0e16', color: '#ede8f6' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
          <div>
            <h1 style={{ fontSize: 20 }}>LofiLoop couldn&apos;t start</h1>
            <p style={{ color: '#a8a1bb', fontSize: 14 }}>Your saved beats are safe in this browser.</p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 12,
                padding: '8px 16px',
                borderRadius: 8,
                border: 0,
                background: '#ffb86b',
                color: '#1e1408',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
