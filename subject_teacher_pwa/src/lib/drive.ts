// Thin Google Drive REST client scoped to the hidden appDataFolder.
//
// Only JSON read/write against appDataFolder is needed. The teacher's
// settings/timetable/students/attendance files live here and are shared with
// the desktop Python app, which uses the same file names and camelCase JSON.

import { ensureAccount } from "./accountGuard";
import { invalidateAccessToken, getValidAccessToken } from "./auth";
import { decryptEnvelope, encryptEnvelope, importSyncKey, isEnvelope } from "./crypto";
import { loadSyncKey } from "./keyStore";
import { MixedGroupsSchema, StudentsSchema } from "./schemas";

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

function studentsForWire(data: unknown): unknown {
  const document = StudentsSchema.parse(data);
  return {...document, classes: Object.fromEntries(Object.entries(document.classes).map(([key, rows]) =>
    [key, rows.map(({number}) => ({number}))]))};
}

function mixedGroupsForWire(data: unknown): unknown {
  const document = MixedGroupsSchema.parse(data);
  const rowsForWire = (rows: (typeof document.groups)[string]["students"]) => rows.map(s => ({...s, homeClassNo: String(s.homeClassNo)}));
  return {...document, groups: Object.fromEntries(Object.entries(document.groups).map(([id, group]) => [id, {
    ...group, students: rowsForWire(group.students),
    history: Object.fromEntries(Object.entries(group.history).map(([revision, rows]) => [revision, rowsForWire(rows)])),
  }]))};
}

function requiresEncryption(name: string, data: unknown): boolean {
  if (name === "mixed-groups.json") return true;
  if (!name.startsWith("attendance-") || !data || typeof data !== "object") return false;
  const records = (data as {records?: Record<string, Record<string, {groupId?: string; absences?: {studentId?: string}[]}>>}).records;
  return Object.values(records ?? {}).some(day => Object.values(day).some(slot => slot.groupId || slot.absences?.some(a => a.studentId)));
}

export class DriveConflictError extends Error {
  constructor(message = "다른 기기에서 이 수업을 수정했습니다. 최신 기록을 불러온 뒤 확인해 주세요.") {
    super(message);
    this.name = "DriveConflictError";
  }
}

export interface JsonSnapshot<T = unknown> {
  id: string | null;
  etag: string | null;
  data: T | null;
}

async function uniqueFileId(name: string): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder", q: `name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id),nextPageToken", pageSize: "2",
  });
  const response = await ensureOk(await fetch(`${FILES_URL}?${params}`, { headers: await authHeaders() }));
  const body = await response.json() as { files?: { id: string }[]; nextPageToken?: string };
  if ((body.files?.length ?? 0) > 1 || body.nextPageToken) {
    throw new DriveConflictError("같은 월의 출결 파일이 여러 개 있습니다. 원본은 보존했습니다. PC에서 파일 통합이 필요합니다.");
  }
  return body.files?.[0]?.id ?? null;
}

/** Read content between matching metadata versions; content ETags are different. */
export async function readJsonSnapshot<T = unknown>(name: string): Promise<JsonSnapshot<T>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = await uniqueFileId(name);
    if (!id) return { id: null, etag: null, data: null };
    const metadata = async () => {
      const response = await ensureOk(await fetch(`https://www.googleapis.com/drive/v2/files/${id}?fields=id,etag`, {
        headers: await authHeaders(),
      }));
      return await response.json() as { etag?: string };
    };
    const before = (await metadata()).etag;
    if (!before) throw new DriveConflictError("기록 버전을 확인할 수 없어 저장하지 않았습니다.");
    const response = await ensureOk(await fetch(`${FILES_URL}/${id}?alt=media`, { headers: await authHeaders() }));
    let data = await response.json() as unknown;
    if (before !== (await metadata()).etag) continue;
    if (!isEnvelope(data) && requiresEncryption(name, data)) throw new Error("혼합수업 파일은 암호화되어야 합니다. PC에서 암호화 연결을 확인해 주세요.");
    if (isEnvelope(data)) {
      const key = await getSyncKey();
      if (!key) throw new PairingRequiredError();
      data = await decryptEnvelope(name, data, key);
    }
    return { id, etag: before, data: data as T };
  }
  throw new DriveConflictError("다른 기기에서 저장 중입니다. 잠시 후 다시 불러와 주세요.");
}

/** Server-side compare-and-swap; never fall back to an unconditional update. */
export async function writeJsonSnapshot(name: string, data: unknown, snapshot: JsonSnapshot): Promise<void> {
  if (name === "students.json") data = studentsForWire(data);
  if (name === "mixed-groups.json") data = mixedGroupsForWire(data);
  if (!snapshot.id) {
    if (await uniqueFileId(name)) throw new DriveError(412, "동시에 월별 기록이 생성됐습니다.");
    await writeJson(name, data, null);
    await uniqueFileId(name); // Preserve and flag both files on simultaneous first creation.
    return;
  }
  if (!snapshot.etag) throw new DriveConflictError("기록 버전이 없어 저장하지 않았습니다.");
  const key = await getSyncKey();
  if (!key && requiresEncryption(name, data)) throw new PairingRequiredError();
  await ensureOk(await fetch(`https://www.googleapis.com/upload/drive/v2/files/${snapshot.id}?uploadType=media`, {
    method: "PUT",
    headers: await authHeaders({ "Content-Type": "application/json", "If-Match": snapshot.etag }),
    body: JSON.stringify(key ? await encryptEnvelope(name, data, key) : data),
  }));
}

/** Thrown when an encrypted file is found but this device has no sync key yet. */
export class PairingRequiredError extends Error {
  constructor() {
    super("데스크톱과 연결(페어링)이 필요합니다.");
    this.name = "PairingRequiredError";
  }
}

let cachedKey: CryptoKey | null = null;
let cachedKeyLoaded = false;

async function getSyncKey(): Promise<CryptoKey | null> {
  if (!cachedKeyLoaded) {
    const bytes = await loadSyncKey();
    cachedKey = bytes ? await importSyncKey(bytes) : null;
    cachedKeyLoaded = true;
  }
  return cachedKey;
}

/** Call after pairing or 연결 해제 so the next request re-reads the stored key. */
export function resetSyncKeyCache(): void {
  cachedKey = null;
  cachedKeyLoaded = false;
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Drive API ${status}: ${detail}`);
    this.name = "DriveError";
  }

  /** Token expired / revoked — caller should re-authenticate. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getValidAccessToken();
  await ensureAccount(token);
  return { Authorization: `Bearer ${token}`, ...(extra ?? {}) };
}

async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) {
    if (response.status === 401) invalidateAccessToken();
    throw new DriveError(response.status, await response.text());
  }
  return response;
}

/** Find a file in appDataFolder by exact name. Returns its id or null. */
export async function findFileId(name: string): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${name.replace(/'/g, "\\'")}'`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "1",
  });
  const response = await ensureOk(
    await fetch(`${FILES_URL}?${params.toString()}`, { headers: await authHeaders() }),
  );
  const data = (await response.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

/** Read and parse a JSON file from appDataFolder. Returns null if absent. */
export async function readJson<T = unknown>(name: string): Promise<{ id: string; data: T } | null> {
  const id = await findFileId(name);
  if (!id) return null;
  const response = await ensureOk(
    await fetch(`${FILES_URL}/${id}?alt=media`, { headers: await authHeaders() }),
  );
  let data = (await response.json()) as unknown;
  if (!isEnvelope(data) && requiresEncryption(name, data)) throw new Error("혼합수업 파일은 암호화되어야 합니다. PC에서 암호화 연결을 확인해 주세요.");
  if (isEnvelope(data)) {
    const key = await getSyncKey();
    if (!key) throw new PairingRequiredError();
    data = await decryptEnvelope(name, data, key);
  }
  return { id, data: data as T };
}

/**
 * Write a JSON file to appDataFolder. Updates `existingId` when given,
 * otherwise creates a new file. Returns the file id.
 */
export async function writeJson(
  name: string,
  data: unknown,
  existingId?: string | null,
): Promise<string> {
  const key = await getSyncKey();
  if (!key && requiresEncryption(name, data)) throw new PairingRequiredError();
  if (name === "students.json") data = studentsForWire(data);
  if (name === "mixed-groups.json") data = mixedGroupsForWire(data);
  const body = JSON.stringify(key ? await encryptEnvelope(name, data, key) : data);

  if (existingId) {
    const response = await ensureOk(
      await fetch(`${UPLOAD_URL}/${existingId}?uploadType=media&fields=id`, {
        method: "PATCH",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body,
      }),
    );
    const json = (await response.json()) as { id: string };
    return json.id;
  }

  const boundary = `neis-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: ["appDataFolder"] };
  const multipart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${body}\r\n` +
    `--${boundary}--`;

  const response = await ensureOk(
    await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
      body: multipart,
    }),
  );
  const json = (await response.json()) as { id: string };
  return json.id;
}
