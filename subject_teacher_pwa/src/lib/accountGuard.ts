import { CACHE_STORE, hasIndexedDB, loadQueue, openDb } from './db';
import { loadSyncKey } from './keyStore';
import { loadDriveCache } from './localCache';
const OWNER = 'driveAccount';
export const ACCOUNT_ISSUE = 'checkon-account-issue';
export class AccountBoundaryError extends Error {
  constructor(readonly reason: 'legacy' | 'different') {
    super(reason === 'legacy'
      ? '이 기기에 남은 기록이 현재 Google 계정의 기록인지 한 번 확인해 주세요.'
      : '기기에 저장된 기록과 다른 Google 계정입니다. 기존 계정으로 다시 연결해 주세요.');
    this.name = 'AccountBoundaryError';
  }
}
let generation = 0;
let verifiedToken: string | null = null;
let checking: {token: string; promise: Promise<void>} | null = null;
let legacyCandidate: string | null = null;
async function owner(value?: string): Promise<string | null> {
  if (!hasIndexedDB()) throw new Error('기기 저장소를 사용할 수 없어 계정과 기록을 안전하게 연결하지 못했습니다.');
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      const request = value === undefined ? store.get(OWNER) : store.put(value, OWNER);
      tx.oncomplete = () => resolve(value ?? request.result ?? null);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export function resetAccountGuard(): void { generation++; verifiedToken = null; checking = null; legacyCandidate = null; }
export async function confirmLegacyAccount(): Promise<void> {
  if (!legacyCandidate) throw new Error('Google 계정을 다시 확인해 주세요.');
  await owner(legacyCandidate); legacyCandidate = null; verifiedToken = null; checking = null;
}
/** Must complete before any Drive file read/write or automatic queue upload. */
export function ensureAccount(token: string): Promise<void> {
  if (verifiedToken === token) return Promise.resolve();
  if (checking?.token === token) return checking.promise;
  const current = generation;
  const previous = checking?.promise;
  const active = () => { if (current !== generation) throw new Error("계정 확인이 취소되었습니다."); };
  const promise = (async () => {
    await previous?.catch(() => {});
    active();
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)', {
      headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Google 계정을 확인하지 못했습니다. 저장을 보류했습니다.');
    const identity = (await response.json()).user?.permissionId;
    if (typeof identity !== 'string' || !identity) throw new Error('Google 계정 식별 정보를 확인하지 못했습니다.');
    active();
    const stored = await owner();
    active();
    let reason: 'legacy' | 'different' | null = stored && stored !== identity ? 'different' : null;
    if (!stored) {
      const [cache, queue, key] = await Promise.all([loadDriveCache(), loadQueue(), loadSyncKey()]);
      active();
      if (cache || queue.length || key) { legacyCandidate = identity; reason = 'legacy'; }
      else await owner(identity);
    }
    if (reason) {
      window.dispatchEvent(new CustomEvent(ACCOUNT_ISSUE, {detail: reason}));
      throw new AccountBoundaryError(reason);
    }
    active();
    verifiedToken = token;
  })().finally(() => { if (checking?.token === token) checking = null; });
  checking = {token, promise};
  return promise;
}
