// Client-only persistence for install deltas logged while offline. Scoped
// to installs specifically (not a generic "any action" queue): it's the
// one field action a crew repeats dozens of times a shift and the one the
// schema already carries idempotency_key/device_id for, so it's the one
// worth not losing to a warehouse wifi drop. Blockers/day-log edits are
// low-frequency enough that a plain "retry the button" on failure is
// enough.
export interface QueuedInstall {
  idempotencyKey: string;
  rowId: string;
  projectId: string;
  materialId: string;
  qty: number;
  crewId: string | null;
  rowLabel: string;
  materialName: string;
}

const QUEUE_KEY = "handy-pm-field-install-queue";
const DEVICE_ID_KEY = "handy-pm-device-id";

// Notified on every queue mutation so components can read pendingCount via
// useSyncExternalStore instead of each caller manually re-deriving it into
// its own state after every enqueue/drain.
const listeners = new Set<() => void>();

export function subscribeQueue(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function readQueue(): QueuedInstall[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedInstall[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedInstall[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  notify();
}

export function enqueueInstall(item: QueuedInstall): void {
  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);
}

export function peekQueue(): QueuedInstall[] {
  return readQueue();
}

export function removeFromQueue(idempotencyKey: string): void {
  writeQueue(readQueue().filter((item) => item.idempotencyKey !== idempotencyKey));
}

export function getPendingCount(): number {
  return readQueue().length;
}
