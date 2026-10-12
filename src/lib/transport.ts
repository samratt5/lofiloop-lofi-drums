/** Transport helpers shared by the play button, hotkeys and the arrangement view. */
import { engine } from '@/lib/audio/engine';
import { actions, getProject } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import { isListening, toggleListening } from '@/lib/listen';

/** Start from the song cursor (song mode) or the top of the pattern; stop if playing. */
export async function togglePlayback(): Promise<void> {
  // While a listening session runs, play/pause controls it instead of the editor.
  if (isListening()) {
    toggleListening();
    return;
  }
  if (engine.isPlaying) {
    engine.stop();
    return;
  }
  const project = getProject();
  const fromBar = project.playMode === 'song' ? (project.loop?.start ?? useUi.getState().songCursor) : undefined;
  await engine.play({ fromBar });
}

/** Move the song position: jumps while playing, otherwise sets where playback will start. */
export function seekSong(bar: number): void {
  const target = Math.max(0, bar);
  useUi.setState({ songCursor: target });
  if (engine.isPlaying && !isListening() && getProject().playMode === 'song') engine.seek(target);
}

/** Switch between editing patterns and arranging the song; the arrangement plays the song. */
export function setMainView(view: 'pattern' | 'song'): void {
  useUi.setState({ mainView: view, stepEditor: null });
  if (view === 'song' && getProject().playMode !== 'song') {
    actions.setPlayMode('song');
    if (engine.isPlaying && !isListening()) void engine.restart({ fromBar: useUi.getState().songCursor });
  }
}

export function setPlayMode(mode: 'pattern' | 'song'): void {
  if (getProject().playMode === mode) return;
  actions.setPlayMode(mode);
  if (engine.isPlaying && !isListening())
    void engine.restart({ fromBar: mode === 'song' ? useUi.getState().songCursor : undefined });
}
