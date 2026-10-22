import type { MarkType, SlotAttendance, TimetableSlot } from "./schemas";

export type LessonStatusKind =
  | "unchecked"
  | "allPresent"
  | "exceptions"
  | "drivePending"
  | "driveSynced"
  | "driveFailed"
  | "neisSynced";

export type LessonSyncMetadata = {
  drivePending?: boolean;
  driveSynced?: boolean;
  driveError?: string | boolean | null;
};

export type LessonDisplayStatus = {
  kind: LessonStatusKind;
  checked: boolean;
  compactLabel: string;
  summaryText: string;
  absenceCount: number;
};

const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const MARK_LABELS: Record<MarkType, string> = {
  absent: "결과",
  excused: "인정결과",
};

export function selectedDateLabel(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  return `${date.month}월 ${date.day}일 ${WEEKDAY_LABELS[date.weekday]}`;
}

export function getLessonsForDate(slots: TimetableSlot[], isoDate: string): TimetableSlot[] {
  const isoWeekday = getIsoWeekday(isoDate);
  if (isoWeekday > 5) return [];

  return slots
    .filter((slot) => slot.dayOfWeek === isoWeekday)
    .slice()
    .sort((a, b) => a.period - b.period || a.grade - b.grade || a.classNo.localeCompare(b.classNo, "ko"));
}

export function computeLessonDisplayStatus(
  attendance?: SlotAttendance,
  sync: LessonSyncMetadata = {},
): LessonDisplayStatus {
  if (!attendance) {
    return {
      kind: "unchecked",
      checked: false,
      compactLabel: "미확인",
      summaryText: "아직 출결을 확인하지 않았습니다.",
      absenceCount: 0,
    };
  }

  const exceptionStatus = getExceptionStatus(attendance);
  const kind = getSyncedKind(attendance, sync) ?? exceptionStatus.kind;

  if (kind === exceptionStatus.kind) return exceptionStatus;

  return {
    ...exceptionStatus,
    kind,
    compactLabel: getSyncCompactLabel(kind),
    summaryText: getSyncSummaryText(kind, exceptionStatus.summaryText),
  };
}

function getExceptionStatus(attendance: SlotAttendance): LessonDisplayStatus {
  const absences = attendance.absences.slice().sort((a, b) => (a.studentNumber ?? 0) - (b.studentNumber ?? 0));

  if (absences.length === 0) {
    return {
      kind: "allPresent",
      checked: true,
      compactLabel: "전원 출석",
      summaryText: "모든 학생이 출석했습니다.",
      absenceCount: 0,
    };
  }

  const uniqueLabels = Array.from(new Set(absences.map((absence) => MARK_LABELS[absence.markType])));

  return {
    kind: "exceptions",
    checked: true,
    compactLabel: `${uniqueLabels.join("·")} ${absences.length}명`,
    summaryText: absences
      .map((absence) => `${absence.studentNumber !== undefined ? `${absence.studentNumber}번` : "혼합수업 학생"} ${MARK_LABELS[absence.markType]}`)
      .join(", "),
    absenceCount: absences.length,
  };
}

function getSyncedKind(attendance: SlotAttendance, sync: LessonSyncMetadata): LessonStatusKind | undefined {
  if (attendance.syncedToNeis) return "neisSynced";
  if (sync.driveError) return "driveFailed";
  if (sync.drivePending) return "drivePending";
  if (sync.driveSynced) return "driveSynced";
  return undefined;
}

function getSyncCompactLabel(kind: LessonStatusKind): string {
  if (kind === "neisSynced") return "NEIS 반영됨";
  if (kind === "driveFailed") return "Drive 실패";
  if (kind === "drivePending") return "Drive 대기";
  if (kind === "driveSynced") return "Drive 저장";
  return "";
}

function getSyncSummaryText(kind: LessonStatusKind, fallback: string): string {
  if (kind === "neisSynced") return "NEIS에 반영되었습니다.";
  if (kind === "driveFailed") return "Drive 저장에 실패했습니다.";
  if (kind === "drivePending") return "Drive 저장을 기다리는 중입니다.";
  if (kind === "driveSynced") return "Drive에 저장되었습니다.";
  return fallback;
}

function getIsoWeekday(isoDate: string): number {
  const weekday = parseIsoDate(isoDate).weekday;
  return weekday === 0 ? 7 : weekday;
}

function parseIsoDate(isoDate: string): { month: number; day: number; weekday: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  return {
    month,
    day,
    weekday: date.getUTCDay(),
  };
}
