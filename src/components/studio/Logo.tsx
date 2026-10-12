export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <circle cx="11" cy="16" r="5.5" fill="none" strokeWidth="2.5" className="stroke-accent-fg" />
      <circle cx="21" cy="16" r="5.5" fill="none" strokeWidth="2.5" className="stroke-accent-fg" />
      <circle cx="11" cy="16" r="1.6" className="fill-accent-fg" />
      <circle cx="21" cy="16" r="1.6" className="fill-accent-fg" />
    </svg>
  );
}
