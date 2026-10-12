/** The tape-reel logo on the accent background, for generated PNG icons. */
export function IconArt({ size, glyph }: { size: number; glyph: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffb86b',
      }}
    >
      <svg width={Math.round(size * glyph)} height={Math.round(size * glyph)} viewBox="0 0 32 32">
        <g fill="none" stroke="#1e1408" strokeWidth="2.5">
          <circle cx="11" cy="16" r="5.5" />
          <circle cx="21" cy="16" r="5.5" />
        </g>
        <circle cx="11" cy="16" r="1.6" fill="#1e1408" />
        <circle cx="21" cy="16" r="1.6" fill="#1e1408" />
      </svg>
    </div>
  );
}
