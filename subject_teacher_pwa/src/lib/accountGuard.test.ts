import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ensureAccount, resetAccountGuard, confirmLegacyAccount } from "./accountGuard";
import { saveSyncKey, loadSyncKey } from "./keyStore";
import { clearSyncedDeviceData, persistQueue, loadQueue } from "./db";
import type { SaveQueueItem } from "./offlineQueue";
const identity = (id: string) => new Response(JSON.stringify({user:{permissionId:id}}));
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetAccountGuard(); });
afterEach(() => vi.unstubAllGlobals());
it("binds an empty device, coalesces checks and blocks another account", async () => {
 const fetcher=vi.fn().mockResolvedValue(identity("first")); vi.stubGlobal("fetch",fetcher);
 await Promise.all([ensureAccount("one"),ensureAccount("one")]);
 expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockResolvedValue(identity("second"));
 await expect(ensureAccount("two")).rejects.toMatchObject({reason:"different"});
});
it("requires explicit confirmation for old local keys", async () => {
 await saveSyncKey(new Uint8Array(32));
 vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(identity("first"))));
 await expect(ensureAccount("one")).rejects.toMatchObject({reason:"legacy"});
 await confirmLegacyAccount(); await ensureAccount("one");
 expect(await loadSyncKey()).not.toBeNull();
});
it("fails closed when account lookup fails",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("",{status:503})));
 await expect(ensureAccount("one")).rejects.toThrow("저장");
});
it("does not accept a response from before logout",async()=>{
 let finish!: (value:Response)=>void;
 vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>new Promise<Response>(r=>{finish=r;})));
 const pending=ensureAccount("old"); await Promise.resolve(); resetAccountGuard(); finish(identity("old"));
 await expect(pending).rejects.toThrow("취소");
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(identity("new"))); await ensureAccount("new");
});
it.each(["pending","failed"] as const)("preserves %s attendance and keys on logout",async status=>{
 const item={id:"fixture",status} as SaveQueueItem;
 await persistQueue([item]);await saveSyncKey(new Uint8Array(32));
 await expect(clearSyncedDeviceData()).rejects.toThrow("전송하지 못한");
 expect(await loadQueue()).toEqual([item]);expect(await loadSyncKey()).not.toBeNull();
});
it("clears synced rows, keys and account binding together",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(identity("first"))); await ensureAccount("one");
 await persistQueue([{id:"fixture",status:"synced"} as SaveQueueItem]); await saveSyncKey(new Uint8Array(32));
 await clearSyncedDeviceData(); resetAccountGuard();
 expect(await loadQueue()).toEqual([]);expect(await loadSyncKey()).toBeNull();
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(identity("second"))); await ensureAccount("two");
});
