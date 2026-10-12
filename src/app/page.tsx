import { StudioLoader } from '@/components/studio/StudioLoader';

export default function Home() {
  return (
    <>
      <StudioLoader />
      <noscript>
        <p style={{ padding: 24, fontFamily: 'system-ui' }}>
          LofiLoop is an in-browser music studio and needs JavaScript to run.
        </p>
      </noscript>
    </>
  );
}
