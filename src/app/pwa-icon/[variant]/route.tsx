import { ImageResponse } from 'next/og';
import { IconArt } from '../../iconArt';

/** PNG icons for installing the app: Chrome and Android need raster 192/512 px and a maskable one. */
const VARIANTS = {
  '192': { size: 192, glyph: 0.78 },
  '512': { size: 512, glyph: 0.78 },
  // Maskable icons get cropped to a circle or squircle: keep the glyph inside the 80% safe zone.
  maskable: { size: 512, glyph: 0.56 },
} as const;

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  const spec = VARIANTS[variant as keyof typeof VARIANTS];
  if (!spec) return new Response('Not found', { status: 404 });
  return new ImageResponse(<IconArt size={spec.size} glyph={spec.glyph} />, {
    width: spec.size,
    height: spec.size,
  });
}
