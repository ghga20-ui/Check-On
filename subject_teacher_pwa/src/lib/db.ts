// IndexedDB persistence for the offline save queue.
//
// The queue must survive page refresh, tab close, and offline periods so that
// attendance typed without a network connection is never lost. All functions
// degrade to a no-op when IndexedDB is unavailable (e.g. jsdom in tests), so
// callers can use them unconditionally.

import type { SaveQueueItem } from "./offlineQueue";

const DB_NAME = "neis-subject";
const STORE = "saveQueue";
// v2: adds the `keys` store holding the E2E sync key (see keyStore.ts).
// v3: adds the `driveCache` store for the stale-while-revalidate snapshot of
//     LoadedDriveData (see localCache.ts). Student names may appear here, but
//     that is fine on-device; tokens are never cached.
const VERSION = 3;
export const KEYS_STORE = "keys";
export const CACHE_STORE = "driveCache";

export function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE);
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Load the persisted queue. Returns [] when storage is empty or unavailable. */
export async function loadQueue(): Promise<SaveQueueItem[]> {
  if (!hasIndexedDB()) return [];
  const db = await openDb();
  try {
    return await new Promise<SaveQueueItem[]>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as SaveQueueItem[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Replace the persisted queue with `items`. No-op when storage is unavailable. */
export async function persistQueue(items: SaveQueueItem[]): Promise<void> {
  if (!hasIndexedDB()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Atomically refuse logout while any attendance is unsent, otherwise clear device data. */
export async function clearSyncedDeviceData(): Promise<void> {
  if (!hasIndexedDB()) throw new Error("기기 저장소를 확인하지 못했습니다.");
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, CACHE_STORE, KEYS_STORE], "readwrite");
      let blocked = false;
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => {
        if ((request.result as SaveQueueItem[]).some(item => item.status !== "synced")) { blocked = true; tx.abort(); return; }
        for (const name of [STORE, CACHE_STORE, KEYS_STORE]) tx.objectStore(name).clear();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(blocked ? new Error("전송하지 못한 출결이 있습니다. 먼저 기존 계정으로 저장을 완료해 주세요.") : tx.error);
    });
  } finally { db.close(); }
}
