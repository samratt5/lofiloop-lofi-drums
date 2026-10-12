import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { THEME_INIT_SCRIPT } from '@/lib/themes';
import './globals.css';

const title = 'LofiLoop: make lofi beats in your browser';
const description =
  'A free lofi beat studio in the browser. Sequence synthesized drums, 808s, electric piano and pads, add tape crackle and wow, generate ideas, and export WAV, MP3, MIDI or stems.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: title, template: '%s · LofiLoop' },
  description,
  applicationName: 'LofiLoop',
  keywords: ['lofi', 'beat maker', 'step sequencer', 'drum machine', '808', 'web audio', 'music production'],
  openGraph: { title, description, type: 'website', siteName: 'LofiLoop' },
  twitter: { card: 'summary', title, description },
  appleWebApp: { capable: true, title: 'LofiLoop', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f0e16' },
    { media: '(prefers-color-scheme: light)', color: '#efe9df' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="midnight"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="grain">{children}</body>
    </html>
  );
}
