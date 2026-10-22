vi.mock("./accountGuard", () => ({ ensureAccount: vi.fn().mockResolvedValue(undefined) }));
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptEnvelope, encryptEnvelope, importSyncKey, isEnvelope } from "./crypto";
import { clearSyncKey, saveSyncKey } from "./keyStore";
import { PairingRequiredError, readJson, resetSyncKeyCache, writeJson,
  readJsonSnapshot, writeJsonSnapshot, DriveConflictError } from "./drive";

vi.mock("./auth", () => ({ getValidAccessToken: () => Promise.resolve("tok") }));

const KEY_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

function mockFetchSequence(responses: Array<{ json: unknown; status?: number }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const response = responses[Math.min(i++, responses.length - 1)];
    const body = JSON.stringify(response.json);
    return Promise.resolve(new Response(body, { status: response.status ?? 200 }));
  });
  return calls;
}

describe("drive gateway encryption", () => {
  it("requires encryption for homeroom reasons and encrypts the wire payload", async () => {
    await clearSyncKey();resetSyncKeyCache();
    const snapshot={id:'f',etag:'v1',data:null};
    await expect(writeJsonSnapshot('homeroom-2026-09.json',{reason:'synthetic-reason'},snapshot)).rejects.toBeInstanceOf(PairingRequiredError);
    await saveSyncKey(KEY_BYTES);resetSyncKeyCache();
    const calls=mockFetchSequence([{json:{id:'f'}}]);
    await writeJsonSnapshot('homeroom-2026-09.json',{reason:'synthetic-reason'},snapshot);
    const body=calls[0].init?.body as string;
    expect(body).not.toContain('synthetic-reason');
    expect(await decryptEnvelope('homeroom-2026-09.json',JSON.parse(body),await importSyncKey(KEY_BYTES))).toEqual({reason:'synthetic-reason'});
  });
  it("strips names from ordinary rosters before encrypting snapshots", async () => {
    await saveSyncKey(KEY_BYTES); resetSyncKeyCache();
    const calls = mockFetchSequence([{json:{id:"f"}}]);
    await writeJsonSnapshot("students.json", {schemaVersion:1,classes:{"2-1":[{number:1,name:"LOCAL_FIXTURE_NAME"}]}}, {id:"f",etag:"v1",data:null});
    const decoded = await decryptEnvelope("students.json", JSON.parse(calls[0].init?.body as string), await importSyncKey(KEY_BYTES));
    expect(JSON.stringify(decoded)).not.toContain("LOCAL_FIXTURE_NAME");
    expect(decoded).toMatchObject({classes:{"2-1":[{number:1}]}});
  });

  it("writes numeric mobile home classes as Python-compatible strings in current and historical encrypted rosters", async () => {
    await saveSyncKey(KEY_BYTES); resetSyncKeyCache();
    const id = "00000000-0000-4000-8000-000000000001";
    const student = {studentId: "00000000-0000-4000-8000-000000000002", grade:2, homeClassNo:1, number:5, name:"local-only"};
    const document = {schemaVersion:1, revision:1, groups:{[id]:{id, grade:2, classNo:"선택A", subjectName:"문학", neisSubjectLabel:"", revision:1, students:[student], history:{"1":[student]}}}};
    const calls = mockFetchSequence([{json:{id:"f"}}]);
    await writeJsonSnapshot("mixed-groups.json", document, {id:"f", etag:"v1", data:null});
    const decoded = await decryptEnvelope("mixed-groups.json", JSON.parse(calls[0].init?.body as string), await importSyncKey(KEY_BYTES)) as typeof document;
    expect(decoded.groups[id].students[0]).toEqual({studentId:student.studentId, grade:2, homeClassNo:"1", number:5});
    expect(decoded.groups[id].history["1"][0]).toEqual(decoded.groups[id].students[0]);
  });
  it("blocks mixed roster and all-present mixed attendance writes without a key", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(writeJson("mixed-groups.json", {groups: {}})).rejects.toBeInstanceOf(PairingRequiredError);
    const doc = {records: {"2026-09-10": {mixed: {groupId: "group", rosterRevision: 1, absences: []}}}};
    await expect(writeJsonSnapshot("attendance-2026-09.json", doc, {id: "f", etag: "v1", data: null})).rejects.toBeInstanceOf(PairingRequiredError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a plaintext mixed roster even when pairing already exists", async () => {
    await saveSyncKey(KEY_BYTES); resetSyncKeyCache();
    mockFetchSequence([{json:{files:[{id:"f"}]}}, {json:{schemaVersion:1, revision:0, groups:{}}}]);
    await expect(readJson("mixed-groups.json")).rejects.toThrow("암호화되어야");
  });
  it("sends a conditional encrypted update and never retries 412 unconditionally", async () => {
    await saveSyncKey(KEY_BYTES);
    resetSyncKeyCache();
    const calls = mockFetchSequence([{ json: {}, status: 412 }]);
    await expect(writeJsonSnapshot("attendance-2026-09.json", { records: {} },
      { id: "f", etag: '"v1"', data: {} })).rejects.toMatchObject({ status: 412 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/upload/drive/v2/files/f");
    expect(calls[0].init?.method).toBe("PUT");
    expect(calls[0].init?.headers).toMatchObject({ "If-Match": '"v1"' });
    expect(isEnvelope(JSON.parse(calls[0].init?.body as string))).toBe(true);
  });

  it("re-reads a snapshot when content changes between metadata reads", async () => {
    mockFetchSequence([
      { json: { files: [{ id: "f" }] } }, { json: { etag: '"v1"' } }, { json: { old: true } }, { json: { etag: '"v2"' } },
      { json: { files: [{ id: "f" }] } }, { json: { etag: '"v2"' } }, { json: { newest: true } }, { json: { etag: '"v2"' } },
    ]);
    expect(await readJsonSnapshot("attendance-2026-09.json")).toEqual({ id: "f", etag: '"v2"', data: { newest: true } });
  });

  it("preserves duplicate first-created months and stops instead of picking one", async () => {
    const calls = mockFetchSequence([{ json: { files: [{ id: "a" }, { id: "b" }] } }]);
    await expect(readJsonSnapshot("attendance-2026-09.json")).rejects.toBeInstanceOf(DriveConflictError);
    expect(calls).toHaveLength(1);
  });
  beforeEach(async () => {
    await clearSyncKey();
    resetSyncKeyCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("readJson transparently decrypts an envelope when the key exists", async () => {
    await saveSyncKey(KEY_BYTES);
    resetSyncKeyCache();
    const envelope = await encryptEnvelope(
      "settings.json",
      { schemaVersion: 1 },
      await importSyncKey(KEY_BYTES),
    );
    mockFetchSequence([{ json: { files: [{ id: "f1" }] } }, { json: envelope }]);
    const file = await readJson("settings.json");
    expect(file?.data).toEqual({ schemaVersion: 1 });
  });

  it("readJson throws PairingRequiredError on envelope without key", async () => {
    const envelope = await encryptEnvelope(
      "settings.json",
      { schemaVersion: 1 },
      await importSyncKey(KEY_BYTES),
    );
    mockFetchSequence([{ json: { files: [{ id: "f1" }] } }, { json: envelope }]);
    await expect(readJson("settings.json")).rejects.toBeInstanceOf(PairingRequiredError);
  });

  it("readJson passes legacy plaintext through", async () => {
    mockFetchSequence([{ json: { files: [{ id: "f1" }] } }, { json: { schemaVersion: 1 } }]);
    const file = await readJson("settings.json");
    expect(file?.data).toEqual({ schemaVersion: 1 });
  });

  it("writeJson uploads an envelope when the key exists", async () => {
    await saveSyncKey(KEY_BYTES);
    resetSyncKeyCache();
    const calls = mockFetchSequence([{ json: { id: "f1" } }]);
    await writeJson("settings.json", { schemaVersion: 1 }, "f1");
    const uploaded = JSON.parse(calls[0].init?.body as string);
    expect(isEnvelope(uploaded)).toBe(true);
  });

  it("writeJson uploads plaintext without a key", async () => {
    const calls = mockFetchSequence([{ json: { id: "f1" } }]);
    await writeJson("settings.json", { schemaVersion: 1 }, "f1");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ schemaVersion: 1 });
  });
});
