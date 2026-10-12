import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="bg-bg text-fg flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-accent font-mono text-sm">404</p>
      <h1 className="text-xl font-semibold">This track doesn&apos;t exist</h1>
      <Link href="/" className="bg-accent text-accent-fg mt-2 rounded-lg px-4 py-2 text-sm font-semibold">
        Back to the studio
      </Link>
    </main>
  );
}
