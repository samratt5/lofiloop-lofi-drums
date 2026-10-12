/**
 * A/B compare: flip between the open project (A) and a saved version (B) while
 * it plays, without changing anything. The engine plays B through an override.
 */
import { create } from 'zustand';
import { engine } from '@/lib/audio/engine';
import type { Project } from '@/lib/project/types';
import { stopListening, isListening } from '@/lib/listen';
import { hydrateSamples } from '@/lib/storage/hydrate';

interface CompareState {
  /** The version being compared against, or null when not comparing */
  other: Project | null;
  otherName: string;
  side: 'A' | 'B';
}

export const useCompare = create<CompareState>()(() => ({ other: null, otherName: '', side: 'A' }));

function apply() {
  const { other } = useCompare.getState();
  engine.setOverride(other ? () => (useCompare.getState().side === 'B' ? other : null) : null);
}

export function startCompare(other: Project, name: string): void {
  if (isListening()) stopListening();
  void hydrateSamples(other);
  useCompare.setState({ other, otherName: name, side: 'B' });
  apply();
}

export function setCompareSide(side: 'A' | 'B'): void {
  if (!useCompare.getState().other) return;
  useCompare.setState({ side });
  apply();
}

export function toggleCompareSide(): void {
  setCompareSide(useCompare.getState().side === 'A' ? 'B' : 'A');
}

export function stopCompare(): void {
  if (!useCompare.getState().other) return;
  useCompare.setState({ other: null, otherName: '', side: 'A' });
  engine.setOverride(null);
}
