/**
 * Durable offline/retry queue for mobile business mutations.
 * Stores ONLY non-secret mutation payloads and stable X-Idempotency-Key values
 * (NEVER stores passwords, bearer tokens, or OAuth tokens).
 */

const QUEUE_STORAGE_KEY = 'sunviloz_pending_mutations_v1';

export interface QueuedMobileMutation {
  idempotencyKey: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  bodyJson: string;
  label: string;
  createdAt: string;
  attempts: number;
  lastError: string;
}

type QueueListener = (items: QueuedMobileMutation[]) => void;
const listeners = new Set<QueueListener>();

function emit(items: QueuedMobileMutation[]) {
  for (const cb of listeners) {
    try {
      cb(items);
    } catch {
      // Ignore listener errors
    }
  }
}

export function listPendingMutations(): QueuedMobileMutation[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedMobileMutation[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(items: QueuedMobileMutation[]): void {
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
  emit(items);
}

export function subscribePendingMutations(cb: QueueListener): () => void {
  listeners.add(cb);
  cb(listPendingMutations());
  return () => {
    listeners.delete(cb);
  };
}

export function createIdempotencyKey(prefix = 'mut'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueuePendingMutation(item: Omit<QueuedMobileMutation, 'createdAt' | 'attempts' | 'lastError'>): void {
  const existing = listPendingMutations();
  if (existing.some((x) => x.idempotencyKey === item.idempotencyKey)) return;
  const next: QueuedMobileMutation[] = [
    ...existing,
    {
      ...item,
      createdAt: new Date().toISOString(),
      attempts: 1,
      lastError: 'Waiting for connection to retry safely.',
    },
  ];
  saveQueue(next);
}

export function removePendingMutation(idempotencyKey: string): void {
  const next = listPendingMutations().filter((x) => x.idempotencyKey !== idempotencyKey);
  saveQueue(next);
}

export function updatePendingMutationFailure(idempotencyKey: string, errorMessage: string): void {
  const next = listPendingMutations().map((x) =>
    x.idempotencyKey === idempotencyKey
      ? { ...x, attempts: x.attempts + 1, lastError: errorMessage }
      : x
  );
  saveQueue(next);
}

export function clearPendingMutations(): void {
  saveQueue([]);
}
