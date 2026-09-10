import { z } from "zod";

export const SCHEMA_VERSION = 1;

const schemaVersion = z.literal(SCHEMA_VERSION);
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const classKey = z.string().regex(/^\d+-[^\t\r\n]+$/);

const classNo = z.preprocess((value) => {
  if (value === null || value === undefined) return value;
  return String(value).trim();
}, z.string().min(1).max(40).refine((value) => !/[\t\r\n]/.test(value), {
  message: "classNo must not contain tabs or line breaks",
}));

export const SemesterSchema = z.object({
  year: z.number().int().min(2024).max(2100),
  term: z.union([z.literal(1), z.literal(2)]),
});

export const SettingsSchema = z.object({
  schemaVersion: schemaVersion.default(SCHEMA_VERSION),
  teacherName: z.string(),
  schoolName: z.string(),
  region: z.string().min(1),
  semester: SemesterSchema,
  closeByDefault: z.boolean().default(false),
  updatedAt: z.string().min(1),
});

export const TimetableSlotSchema = z.object({
  id: z.string().min(1),
  dayOfWeek: z.number().int().min(1).max(5),
  period: z.number().int().min(1).max(7),
  grade: z.number().int().min(1).max(3),
  classNo,
  subjectName: z.string().min(1),
  neisSubjectLabel: z.string().min(1),
  groupId: z.string().uuid().optional(),
});

export const TimetableSchema = z.object({
  schemaVersion: schemaVersion.default(SCHEMA_VERSION),
  effectiveFrom: isoDate,
  slots: z.array(TimetableSlotSchema),
});

export const StudentEntrySchema = z.object({
  number: z.number().int().min(1).max(99),
  name: z.string().default(""),
  studentId: z.string().uuid().optional(),
  homeClassNo: z.number().int().positive().optional(),
});

export const StudentsSchema = z.object({
  schemaVersion: schemaVersion.default(SCHEMA_VERSION),
  classes: z.record(classKey, z.array(StudentEntrySchema)),
});

export const MarkTypeSchema = z.union([z.literal("absent"), z.literal("excused")]);

export const AbsenceSchema = z.object({
  studentNumber: z.number().int().min(1).max(99).optional(),
  studentId: z.string().uuid().optional(),
  markType: MarkTypeSchema,
  note: z.string().default(""),
}).refine(a => (a.studentNumber !== undefined) !== (a.studentId !== undefined), "학생 식별자는 하나만 필요합니다.");

export const SlotAttendanceSchema = z.object({
  absences: z.array(AbsenceSchema),
  checkedAt: z.string().min(1),
  source: z.union([z.literal("mobile"), z.literal("pc")]).default("mobile"),
  syncedToNeis: z.boolean().default(false),
  closedOnNeis: z.boolean().default(false),
  groupId: z.string().uuid().optional(),
  rosterRevision: z.number().int().positive().optional(),
}).refine(s => s.groupId ? s.rosterRevision !== undefined && s.absences.every(a => a.studentId !== undefined) : s.rosterRevision === undefined && s.absences.every(a => a.studentNumber !== undefined), "혼합수업 명부 버전과 학생 식별자를 확인해 주세요.");

export const MonthlyAttendanceSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(SCHEMA_VERSION),
  month: isoMonth,
  records: z.record(isoDate, z.record(z.string().min(1), SlotAttendanceSchema)),
}).refine(doc => doc.schemaVersion === 2 || Object.values(doc.records).every(day => Object.values(day).every(s => !s.groupId)), "혼합수업 출결은 버전 2가 필요합니다.");

export const MixedStudentSchema = z.object({
  studentId: z.string().uuid(), grade: z.number().int().min(1).max(3),
  homeClassNo: z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe())]), number: z.number().int().min(1).max(99),
});
const MixedGroupSchema = z.object({
  id: z.string().uuid(), grade: z.number().int().min(1).max(3), classNo,
  subjectName: z.string().min(1), neisSubjectLabel: z.string().default(""),
  revision: z.number().int().positive(), students: z.array(MixedStudentSchema),
  history: z.record(z.string(), z.array(MixedStudentSchema)),
}).refine(g => [g.students, ...Object.values(g.history)].every(rows =>
  rows.every(s => s.grade === g.grade) && new Set(rows.map(s => s.studentId)).size === rows.length &&
  new Set(rows.map(s => `${s.homeClassNo}:${s.number}`)).size === rows.length), "같은 학년의 중복 없는 명부가 필요합니다.").refine(g => {
  if (JSON.stringify(g.history[String(g.revision)]) !== JSON.stringify(g.students)) return false;
  const identities = new Map<string, string>();
  for (const row of [g.students, ...Object.values(g.history)].flat()) {
    const identity = `${row.grade}:${row.homeClassNo}:${row.number}`;
    if (identities.has(row.studentId) && identities.get(row.studentId) !== identity) return false;
    identities.set(row.studentId, identity);
  }
  return true;
}, "현재 명부와 이력이 다르거나 과거 학생의 소속이 변경되었습니다.");
export const MixedGroupsSchema = z.object({
  schemaVersion: schemaVersion.default(1), revision: z.number().int().nonnegative(),
  groups: z.record(z.string().uuid(), MixedGroupSchema),
}).refine(doc => {
  const seen = new Set<string>();
  for (const [id, group] of Object.entries(doc.groups)) {
    if (id !== group.id) return false;
    for (const label of new Set([group.subjectName, group.neisSubjectLabel].filter(Boolean))) {
      const identity = JSON.stringify([group.grade, group.classNo, label]);
      if (seen.has(identity)) return false;
      seen.add(identity);
    }
  }
  return true;
}, "수업 ID가 다르거나 동일한 수업 집단이 중복되었습니다.");
export type MixedGroups = z.infer<typeof MixedGroupsSchema>;

export type Settings = z.infer<typeof SettingsSchema>;
export type TimetableSlot = z.infer<typeof TimetableSlotSchema>;
export type Timetable = z.infer<typeof TimetableSchema>;
export type StudentEntry = z.infer<typeof StudentEntrySchema>;
export type Students = z.infer<typeof StudentsSchema>;
export type MarkType = z.infer<typeof MarkTypeSchema>;
export type Absence = z.infer<typeof AbsenceSchema>;
export type SlotAttendance = z.infer<typeof SlotAttendanceSchema>;
export type MonthlyAttendance = z.infer<typeof MonthlyAttendanceSchema>;
