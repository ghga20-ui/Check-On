// High-level repository over the Drive appDataFolder JSON files.
//
// Reads are validated through the shared zod schemas so a corrupt or
// out-of-contract file fails loudly instead of silently rendering wrong data.
// Monthly writes use a metadata ETag and a three-way slot merge.

import { readJson, readJsonSnapshot, writeJsonSnapshot, DriveConflictError, DriveError } from "./drive";
import {
  MonthlyAttendanceSchema,
  SlotAttendanceSchema,
  MixedGroupsSchema,
  type MixedGroups,
  SCHEMA_VERSION,
  SettingsSchema,
  StudentsSchema,
  TimetableSchema,
  type MonthlyAttendance,
  type Settings,
  type SlotAttendance,
  type Students,
  type Timetable,
} from "./schemas";

export const FILE_NAMES = {
  settings: "settings.json",
  timetable: "timetable.json",
  students: "students.json",
  mixedGroups: "mixed-groups.json",
  attendance: (month: string) => `attendance-${month}.json`,
} as const;

export async function loadSettings(): Promise<Settings | null> {
  const file = await readJson(FILE_NAMES.settings);
  return file ? SettingsSchema.parse(file.data) : null;
}

export async function loadTimetable(): Promise<Timetable | null> {
  const file = await readJson(FILE_NAMES.timetable);
  return file ? TimetableSchema.parse(file.data) : null;
}

export async function loadStudents(): Promise<Students | null> {
  const file = await readJson(FILE_NAMES.students);
  return file ? StudentsSchema.parse(file.data) : null;
}

export async function loadMonthlyAttendance(month: string): Promise<MonthlyAttendance | null> {
  const file = await readJsonSnapshot(FILE_NAMES.attendance(month));
  return file.data ? MonthlyAttendanceSchema.parse(file.data) : null;
}

export interface LoadedDriveData {
  mixedGroups?: MixedGroups | null;
  settings: Settings | null;
  timetable: Timetable | null;
  students: Students | null;
  attendance: MonthlyAttendance | null;
}

/** Load every Drive file the home screen needs for a given month, in parallel. */
export async function loadAll(month: string): Promise<LoadedDriveData> {
  const [settings, timetable, students, attendance, mixedGroups] = await Promise.all([
    loadSettings(),
    loadTimetable(),
    loadStudents(),
    loadMonthlyAttendance(month),
    loadMixedGroups(),
  ]);
  return { settings, timetable, students, attendance, mixedGroups };
}

export async function loadMixedGroups(): Promise<MixedGroups | null> {
  const file = await readJson(FILE_NAMES.mixedGroups);
  return file ? MixedGroupsSchema.parse(file.data) : null;
}

/**
 * Merge one slot's attendance into the monthly file and upload it.
 * Creates the monthly file when it does not exist yet.
 */
export async function saveSlotAttendance(
  month: string,
  date: string,
  slotId: string,
  payload: SlotAttendance,
  baseline?: SlotAttendance | null,
): Promise<void> {
  payload = SlotAttendanceSchema.parse(payload);
  const validateRoster = async () => { if (payload.groupId) {
    const group = (await loadMixedGroups())?.groups[payload.groupId];
    if (!group || group.revision !== payload.rosterRevision) throw new DriveConflictError("명부가 변경되었습니다. 기기의 초안을 보관했습니다. 최신 명부를 불러와 확인해 주세요.");
    if (payload.absences.some(a => !group.students.some(s => s.studentId === a.studentId))) throw new DriveConflictError("명부에 없는 학생이 포함되어 있습니다.");
  }};
  await validateRoster();
  const name = FILE_NAMES.attendance(month);
  let base = baseline;
  const normalized = (value: SlotAttendance | null | undefined) => value == null ? null : {
    absences: [...value.absences].sort((a, b) => String(a.studentId ?? a.studentNumber).localeCompare(String(b.studentId ?? b.studentNumber), undefined, {numeric: true})),
    groupId: value.groupId, rosterRevision: value.rosterRevision,
    checkedAt: value.checkedAt, source: value.source,
    // PC synchronization bookkeeping does not change the teacher's attendance edit.
    // Keep checkedAt/source/roster identity in the comparison to protect real edits.
  };
  const equal = (a: SlotAttendance | null | undefined, b: SlotAttendance | null | undefined) =>
    JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await readJsonSnapshot(name);
    const doc: MonthlyAttendance = snapshot.data
      ? MonthlyAttendanceSchema.parse(snapshot.data)
      : { schemaVersion: SCHEMA_VERSION, month, records: {} };
    const current = doc.records[date]?.[slotId] ?? null;
    if (equal(current, payload)) return; // Lost response after a successful save.
    if (attempt === 0 && base === undefined) {
      if (current !== null) throw new DriveConflictError("이전 버전에서 보관한 대기 기록입니다. 최신 기록과 비교한 뒤 저장해 주세요.");
      base = null;
    }
    if (!equal(current, base)) throw new DriveConflictError();
    doc.records[date] = { ...(doc.records[date] ?? {}), [slotId]: {...payload, syncedToNeis: false, closedOnNeis: false} };
    if (payload.groupId) doc.schemaVersion = 2;
    try {
      await validateRoster();
      await writeJsonSnapshot(name, doc, snapshot);
      return;
    } catch (error) {
      if (!(error instanceof DriveError) || error.status !== 412) throw error;
    }
  }
  throw new DriveConflictError("다른 기기에서 저장 중입니다. 잠시 후 다시 시도해 주세요.");
}
