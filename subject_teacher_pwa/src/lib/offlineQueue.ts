import type { SlotAttendance } from "./schemas";

export type QueueStatus = "pending" | "synced" | "failed";

export interface SaveQueueItem {
  id: string;
  date: string;
  slotId: string;
  payload: SlotAttendance;
  baseline?: SlotAttendance | null;
  status: QueueStatus;
  createdAt: string;
  syncedAt?: string;
  error?: string;
}

export type SaveQueueInput = Pick<SaveQueueItem, "date" | "slotId" | "payload" | "baseline">;

export function enqueueSave(queue: SaveQueueItem[], input: SaveQueueInput): SaveQueueItem[] {
  const existingPending = queue.find(
    (item) => item.status !== "synced" && item.date === input.date && item.slotId === input.slotId,
  );
  const nextItem: SaveQueueItem = {
    ...input,
    id: existingPending?.id ?? `${input.date}:${input.slotId}:${queue.length + 1}`,
    status: "pending",
    createdAt: existingPending?.createdAt ?? new Date().toISOString(),
  };

  if (existingPending) {
    return queue.map((item) => (item.id === existingPending.id ? nextItem : item));
  }

  return [
    ...queue,
    nextItem,
  ];
}

export function pendingItems(queue: SaveQueueItem[]): SaveQueueItem[] {
  return queue.filter((item) => item.status === "pending");
}

export function markSynced(queue: SaveQueueItem[], id: string): SaveQueueItem[] {
  const syncedAt = new Date().toISOString();
  return queue.map((item) => (
    item.id === id ? { ...item, status: "synced", syncedAt } : item
  ));
}

export function failedItems(queue: SaveQueueItem[]): SaveQueueItem[] {
  return queue.filter((item) => item.status === "failed");
}

/**
 * Resolve the in-flight (pending or previously failed) item for a date+slot to
 * a final status. Used after a Drive upload settles, where we identify the item
 * by its target rather than by id. Already-synced items are left untouched.
 */
export function markStatusByTarget(
  queue: SaveQueueItem[],
  date: string,
  slotId: string,
  status: Exclude<QueueStatus, "pending">,
  checkedAt?: string,
  error?: string,
): SaveQueueItem[] {
  const syncedAt = status === "synced" ? new Date().toISOString() : undefined;
  return queue.map((item) =>
    item.date === date && item.slotId === slotId && item.status !== "synced"
      && (checkedAt === undefined || item.payload.checkedAt === checkedAt)
      ? { ...item, status, error, ...(syncedAt ? { syncedAt } : {}) }
      : item,
  );
}
