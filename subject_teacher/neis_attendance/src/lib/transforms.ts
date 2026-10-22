export type TimetableRow = Readonly<{
  id?: string; day: string; period: number; grade: number; classNo: string; subject: string; neis?: string;
}>;

export type RosterStudent = Readonly<{ n: number; name: string }>;

export type Rosters = Record<string, readonly RosterStudent[]>;

export type AssignedLesson = Readonly<{
  grade: number | string; classNo: string; subjectName: string; neisSubjectLabel?: string; subjectAliases?: readonly string[] | string;
}>;

export type SettingsUi = Readonly<{
  teacherName: string; schoolName: string; schoolCode: string; schoolKind: string;
  region: string; year: string; term: string; effectiveFrom: string;
  closeByDefault: boolean; timetableMode: string; assignedLessons: readonly AssignedLesson[];
}>;

export type SettingsApi = Readonly<{
  schemaVersion: 1; teacherName: string; schoolName: string; schoolCode: string; schoolKind: string;
  region: string;
  semester: Readonly<{ year: number; term: number }>; closeByDefault: boolean; timetableMode: string;
  assignedLessons: readonly AssignedLesson[]; updatedAt: string;
}>;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const recordValue = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const numberValue = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const now = (): string => {
  const date = new Date();
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
};

export const todayIso = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const toIsoDate = (value: unknown): string => {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : todayIso();
};

export const weekKeyFromIsoDate = (value: unknown): string => {
  const date = new Date(`${toIsoDate(value)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return toIsoDate(value);
  const dayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const toGradeNumber = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? "").match(/\d+/)?.[0] || "", 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 3 ? parsed : 1;
};

export const normalizeSubjectName = (value: unknown): string =>
  String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s|[-_().,·]/g, "");

export const DAY_TO_KEY: Record<string, string> = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri" };
export const KEY_TO_DAY: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" };

export class ApiResultError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiResultError";
    this.code = code;
  }
}

export const parseJsonResult = (raw: string): any => {
  const data: unknown = JSON.parse(raw);
  if (isRecord(data) && data.error) {
    throw new ApiResultError(String(data.error), typeof data.code === "string" ? data.code : undefined);
  }
  return data;
};

export const formatApiError = (error: unknown): string => {
  if (error instanceof ApiResultError && error.code === "reauth_required") {
    return "Google 계정 연결이 만료됐어요. 왼쪽 아래 '다시 연결' 버튼을 눌러 주세요.";
  }
  if (error instanceof Error) return error.message;
  return String(error);
};

export const isTransientNetworkError = (error: unknown): boolean => {
  const message = formatApiError(error).toLowerCase();
  return (
    message.includes("ssl:") ||
    message.includes("wrong_version_number") ||
    message.includes("wrong version number") ||
    message.includes("decryption_failed_or_bad_record_mac") ||
    message.includes("bad record mac") ||
    message.includes("timed out") ||
    message.includes("temporarily unavailable")
  );
};

export const parseTextResult = (raw: unknown): string => {
  const text = String(raw || "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    parseJsonResult(trimmed);
  }
  return text;
};

export const settingsFromApi = (data: unknown): SettingsUi => {
  const source = recordValue(data);
  const semester = recordValue(source.semester);
  const lessons = Array.isArray(source.assignedLessons) ? source.assignedLessons : [];
  return {
    teacherName: stringValue(source.teacherName),
    schoolName: stringValue(source.schoolName),
    schoolCode: stringValue(source.schoolCode),
    schoolKind: stringValue(source.schoolKind),
    region: stringValue(source.region, "서울"),
    year: String(semester.year || new Date().getFullYear()),
    term: String(semester.term || "1"),
    effectiveFrom: stringValue(source.effectiveFrom, "2026-03-02"),
    closeByDefault: Boolean(source.closeByDefault),
    timetableMode: stringValue(source.timetableMode, "neis"),
    assignedLessons: lessons.map((rawLesson) => {
      const lesson = recordValue(rawLesson);
      const subjectName = stringValue(lesson.subjectName);
      return {
        grade: toGradeNumber(lesson.grade),
        classNo: stringValue(lesson.classNo).trim() || "1",
        subjectName,
        neisSubjectLabel: stringValue(lesson.neisSubjectLabel, subjectName),
        subjectAliases: Array.isArray(lesson.subjectAliases) ? lesson.subjectAliases.map(String) : [],
      };
    }),
  };
};

export const settingsToApi = (settings: SettingsUi): SettingsApi => ({
  schemaVersion: 1,
  teacherName: settings.teacherName || "",
  schoolName: settings.schoolName || "",
  schoolCode: settings.schoolCode || "",
  schoolKind: settings.schoolKind || "",
  region: settings.region,
  semester: { year: Number(settings.year), term: Number(settings.term) },
  closeByDefault: Boolean(settings.closeByDefault),
  timetableMode: settings.timetableMode || "neis",
  assignedLessons: (settings.assignedLessons || [])
    .filter((lesson) => String(lesson.subjectName || "").trim())
    .map((lesson) => {
      const subjectName = String(lesson.subjectName || "").trim();
      const aliases = Array.isArray(lesson.subjectAliases)
        ? lesson.subjectAliases.map((alias) => String(alias).trim()).filter(Boolean)
        : String(lesson.subjectAliases || "")
            .split(",")
            .map((alias) => alias.trim())
            .filter(Boolean);
      return {
        grade: toGradeNumber(lesson.grade),
        classNo: String(lesson.classNo || "").trim(),
        subjectName,
        neisSubjectLabel: String(lesson.neisSubjectLabel || "").trim() || subjectName,
        subjectAliases: aliases,
      };
    }),
  updatedAt: new Date().toISOString(),
});

export const timetableRowsFromTsv = (raw: string): TimetableRow[] =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("slot_id\t"))
    .map((line) => {
      const [id = "", dayKey = "", period = "", grade = "", classNo = "", subject = "", neis = ""] = line.split("\t");
      return {
        id,
        day: KEY_TO_DAY[dayKey] || dayKey || "월",
        period: Number(period) || 1,
        grade: Number(grade) || 1,
        classNo: String(classNo || "").trim() || "1",
        subject,
        neis: neis && neis !== subject ? neis : "",
      };
    });

export const timetableRowsToTsv = (rows: readonly TimetableRow[]): string => {
  const body = rows
    .filter((row) => String(row.subject || "").trim())
    .map((row, index) => {
      const dayKey = DAY_TO_KEY[row.day] || row.day || "mon";
      const subject = String(row.subject || "").trim();
      const classNo = String(row.classNo || "").trim();
      const neis = String(row.neis || "").trim() || subject;
      const id = row.id || `${dayKey}-${row.period}-${row.grade}-${classNo || "class"}-${index + 1}`;
      return [id, dayKey, row.period, row.grade, classNo, subject, neis].join("\t");
    });
  return ["slot_id\tday\tperiod\tgrade\tclass_no\tsubject_name\tneis_subject_label", ...body].join("\n");
};

export const rostersFromTsv = (raw: string): Rosters => {
  const next: Record<string, RosterStudent[]> = {};
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("class_key\t"))
    .forEach((line) => {
      const [classKey, number, name] = line.split("\t");
      if (!classKey || !number) return;
      next[classKey] = next[classKey] || [];
      next[classKey].push({ n: Number(number), name: name || "" });
    });
  return next;
};

export const rostersToTsv = (rosters: Rosters): string => {
  const lines = ["class_key\tnumber\tname"];
  Object.keys(rosters)
    .sort()
    .forEach((classKey) => {
      (rosters[classKey] || []).forEach((student) => {
        lines.push([classKey, student.n, student.name].join("\t"));
      });
    });
  return lines.join("\n");
};

export const classKeyFromTimetableRow = (row: Pick<TimetableRow, "grade" | "classNo"> | undefined): string => {
  const grade = Number(row?.grade);
  const classNo = String(row?.classNo || "").trim();
  if (!grade || !classNo) return "";
  return `${grade}-${classNo}`;
};

export const rosterKeysFromTimetable = (
  rows: readonly TimetableRow[],
  assignedLessons: readonly AssignedLesson[] = [],
): string[] => {
  const keys: string[] = [];
  rows.forEach((row) => {
    const key = classKeyFromTimetableRow(row);
    if (key && !keys.includes(key)) keys.push(key);
  });
  assignedLessons.forEach((lesson) => {
    const key = classKeyFromTimetableRow({ grade: toGradeNumber(lesson.grade), classNo: lesson.classNo });
    if (key && !keys.includes(key)) keys.push(key);
  });
  return keys;
};

export const syncRostersToTimetable = (
  rosters: Rosters,
  rows: readonly TimetableRow[],
  assignedLessons: readonly AssignedLesson[] = [],
): Rosters => {
  const next: Record<string, readonly RosterStudent[]> = {};
  rosterKeysFromTimetable(rows, assignedLessons).forEach((key) => {
    next[key] = rosters[key] || [];
  });
  return next;
};
