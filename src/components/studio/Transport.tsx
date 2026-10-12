'use client';

import { KeyboardMusic, ListMusic, Play, Repeat1, Square, Timer } from 'lucide-react';
import { engine } from '@/lib/audio/engine';
import { useStudio } from '@/lib/store/studio';
import { setPlayMode, togglePlayback } from '@/lib/transport';
import { useIsPlaying } from '@/hooks/usePlayhead';
import { ui, useUi } from '@/lib/store/ui';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { RecordButton, useLiveInput } from './KeyboardDock';
import { liveInput } from '@/lib/input/live';

export function Transport({ compact = false }: { compact?: boolean }) {
  const playing = useIsPlaying();
  const metronome = useUi((s) => s.metronome);
  const mode = useStudio((s) => s.project.playMode);
  const piano = useLiveInput().pianoOn;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void togglePlayback()}
        aria-label={playing ? 'Stop (Space)' : 'Play (Space)'}
        data-tour="play"
        aria-pressed={playing}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-full transition-all duration-150 active:scale-95 [&_svg]:size-[18px]',
          playing
            ? 'bg-fg text-bg'
            : 'bg-accent text-accent-fg shadow-[0_6px_24px_-6px_var(--glow)] hover:brightness-110',
        )}
      >
        {playing ? <Square className="fill-current" /> : <Play className="translate-x-px fill-current" />}
        {playing && <span className="bg-fg/20 absolute inset-0 animate-ping rounded-full [animation-duration:2s]" />}
      </button>
      <IconButton
        label={
          mode === 'song'
            ? 'Playing the whole song (click to loop the pattern)'
            : 'Looping the pattern (click to play the song)'
        }
        active={mode === 'song'}
        onClick={() => setPlayMode(mode === 'song' ? 'pattern' : 'song')}
      >
        {mode === 'song' ? <ListMusic /> : <Repeat1 />}
      </IconButton>
      <RecordButton />
      {!compact && (
        <IconButton
          label={piano ? 'Keyboard piano on (Esc to leave)' : 'Play from your keyboard (P)'}
          active={piano}
          onClick={() => liveInput.togglePiano()}
        >
          <KeyboardMusic />
        </IconButton>
      )}
      {!compact && (
        <IconButton
          label={metronome ? 'Metronome on (K)' : 'Metronome off (K)'}
          active={metronome}
          onClick={() => {
            const next = !metronome;
            ui.set({ metronome: next });
            engine.setMetronome(next);
          }}
        >
          <Timer />
        </IconButton>
      )}
    </div>
  );
}
