/** Public record shapes and the error type of the durable storage layer. */

/** Summary of a stored project, kept next to the project JSON so listing never parses projects. */
export interface ProjectMeta {
  id: string;
  name: string;
  bpm: number;
  /** Display key, e.g. "D minor" */
  key: string;
  tracks: number;
  patterns: number;
  sections: number;
  /** Song length in seconds (one pass through the arrangement) */
  seconds: number;
  styles: string[];
  coverSeed: number;
  updatedAt: number;
}

export interface SnapshotMeta {
  id: string;
  projectId: string;
  name: string;
  /** Automatic snapshots are pruned before named ones. */
  auto: boolean;
  createdAt: number;
  bpm: number;
  seconds: number;
}

/** An uploaded audio file (raw encoded bytes; decoding happens elsewhere). */
export interface SampleMeta {
  id: string;
  name: string;
  /** MIME type, e.g. "audio/wav" */
  type: string;
  size: number;
  createdAt: number;
  duration?: number;
}

export type StorageErrorReason = 'quota' | 'too-large' | 'blocked' | 'unavailable' | 'unknown';

/** A storage failure with a message that can be shown to the user as-is. */
export class StorageError extends Error {
  readonly reason: StorageErrorReason;

  constructor(message: string, reason: StorageErrorReason = 'unknown', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.reason = reason;
  }
}

/** True for the quota errors thrown by the various browsers. */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** Wrap any low-level failure into a friendly StorageError. */
export function toStorageError(error: unknown, action: string): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaError(error)) {
    return new StorageError(
      'Browser storage is full. Delete old beats, snapshots or samples from the library to keep saving.',
      'quota',
      { cause: error },
    );
  }
  return new StorageError(`Could not ${action} in browser storage.`, 'unknown', { cause: error });
}
