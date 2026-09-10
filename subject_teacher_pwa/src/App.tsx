import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  slotAttendanceToMarks,
  marksToSlotAttendance,
  studentKey,
  type MarksByStudent,
  type StudentMark,
} from "./lib/attendance";
import { loadQueue, persistQueue } from "./lib/db";
import { resetSyncKeyCache } from "./lib/drive";
import { clearSyncKey, loadSyncKey } from "./lib/keyStore";
import {
  computeLessonDisplayStatus,
  getLessonsForDate,
  selectedDateLabel,
} from "./lib/lessonStatus";
import {
  enqueueSave,
  failedItems,
  markStatusByTarget,
  pendingItems,
  type SaveQueueItem,
} from "./lib/offlineQueue";
import type { MixedGroups, SlotAttendance, StudentEntry, TimetableSlot } from "./lib/schemas";
import { sampleRosters, sampleSlots } from "./sampleData";
import { PrivacyPolicy } from "./PrivacyPolicy";
import Pairing from "./Pairing";

type AttendanceByDate = Record<string, Record<string, SlotAttendance>>;
type RostersByClass = Record<string, StudentEntry[]>;

/** Persists one slot's attendance (e.g. to Drive). Resolves on success. */
export type SaveSlotHandler = (
  date: string,
  slotId: string,
  payload: SlotAttendance,
  baseline?: SlotAttendance | null,
) => Promise<void>;

interface AppProps {
  mixedGroups?: MixedGroups;
  initialDate?: string;
  /** Timetable slots. Defaults to bundled sample data for tests/offline demo. */
  slots?: TimetableSlot[];
  /** Rosters keyed by `grade-classNo`. Defaults to sample data. */
  rosters?: RostersByClass;
  /** Attendance already on Drive, keyed by date then slot id. */
  initialAttendance?: AttendanceByDate;
  /** Month (YYYY-MM) already in initialAttendance, so it is not refetched. */
  initialMonth?: string;
  /** Called after each local save to persist to Drive. Omit for demo mode. */
  onSaveSlot?: SaveSlotHandler;
  /** Loads another month's attendance when the user navigates across months. */
  onLoadMonth?: (month: string) => Promise<AttendanceByDate>;
  /** Signs the teacher out (revoke token) — wired from Root. */
  onSignOut?: () => void;
  /** True when rendering from a cached copy (Drive not yet re-fetched). */
  stale?: boolean;
  canSync?: boolean;
  connecting?: boolean;
  connectionError?: string;
  /** Re-fetch from Drive. Surfaced by the stale badge and after pairing. */
  onRefresh?: () => void;
}

function toLocalIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function classKey(slot: TimetableSlot): string {
  if (slot.groupId) return `mixed:${slot.groupId}`;
  return `${slot.grade}-${slot.classNo}`;
}

function dateAtLocalMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

function addDays(isoDate: string, days: number): string {
  const date = dateAtLocalMidnight(isoDate);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
}

function addMonths(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(year, mon - 1 + delta, 1);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

function monthTitle(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return `${year}년 ${mon}월`;
}

/** 42-cell (6×7) grid of ISO dates for a month, leading/trailing nulls. */
function buildMonthGrid(month: string): (string | null)[] {
  const [year, mon] = month.split("-").map(Number);
  const startWeekday = new Date(year, mon - 1, 1).getDay();
  const days = new Date(year, mon, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    cells.push(`${year}-${mon.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Rough bell schedule so the current lesson can be focused ("지금"). */
function currentPeriodNow(now = new Date()): number | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const schedule: Array<[number, number, number]> = [
    [1, 530, 590],
    [2, 600, 650],
    [3, 660, 710],
    [4, 720, 770],
    [5, 830, 890],
    [6, 900, 950],
    [7, 960, 1010],
  ];
  for (const [period, start, end] of schedule) {
    if (minutes >= start - 10 && minutes < end) return period;
  }
  return null;
}

function markLabel(mark: StudentMark): string {
  if (mark === "absent") return "결과";
  if (mark === "excused") return "인정결과";
  return "출석";
}

function marksEqual(a: MarksByStudent, b: MarksByStudent): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const na = key;
    if ((a[na] ?? "present") !== (b[na] ?? "present")) return false;
  }
  return true;
}

function exceptionSummaryFromMarks(marks: MarksByStudent, roster: StudentEntry[] = []): string {
  const parts = Object.entries(marks)
    .filter(([, mark]) => mark !== "present")
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([number, mark]) => {
      const s = roster.find(s => studentKey(s) === number);
      return `${s?.homeClassNo ? `${s.homeClassNo}반 ` : ""}${s?.number ?? number}번 ${mark === "excused" ? "인정결과" : "결과"}`;
    });
  return parts.length ? parts.join(", ") : "저장하면 전원 출석";
}

function formatSavedAt(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "마지막 저장 알 수 없음";
  return `마지막 저장 ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

const PRIVACY_ACK_KEY = "privacyNoticeAck";
const DOUBLE_TAP_MS = 350;

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App({
  initialDate = toLocalIsoDate(),
  slots = sampleSlots,
  rosters = sampleRosters,
  mixedGroups,
  initialAttendance,
  initialMonth,
  onSaveSlot,
  onLoadMonth,
  onSignOut,
  stale,
  onRefresh,
  canSync = true,
  connecting = false,
  connectionError,
}: AppProps = {}) {
  const [tab, setTab] = useState<"today" | "record">("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [privacyAcked, setPrivacyAcked] = useState<boolean>(
    () => localStorage.getItem(PRIVACY_ACK_KEY) === "1",
  );
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [dateInputValue, setDateInputValue] = useState(initialDate);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => selectedDate.slice(0, 7));
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [homeClassFilter, setHomeClassFilter] = useState<number | null>(null);
  const [useCurrentRoster, setUseCurrentRoster] = useState(false);
  const [openedRevision, setOpenedRevision] = useState<number | undefined>();
  const [attendanceByDate, setAttendanceByDate] = useState<AttendanceByDate>(initialAttendance ?? {});
  const [drafts, setDrafts] = useState<Record<string, MarksByStudent>>({});
  const [queue, setQueue] = useState<SaveQueueItem[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );
  const [toast, setToast] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  // E2E pairing state for the 설정 보안 section (null = still loading).
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSyncKey()
      .then((key) => {
        if (!cancelled) setPaired(key !== null);
      })
      .catch(() => {
        if (!cancelled) setPaired(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const disconnectPairing = async () => {
    const ok = window.confirm(
      "이 기기의 암호화 연결(열쇠)을 삭제할까요?\n다시 사용하려면 데스크톱 QR로 다시 연결해야 합니다.",
    );
    if (!ok) return;
    await clearSyncKey();
    resetSyncKeyCache();
    setPaired(false);
  };

  // Toast is a state machine: a save shows a sticky "반영 중…" that later
  // transitions to success/failure. A monotonic token guards against a newer
  // toast being clobbered by a stale Drive result.
  const toastTimer = useRef<number | null>(null);
  const toastSeq = useRef(0);
  const showToast = useCallback((message: string, sticky = false) => {
    const id = ++toastSeq.current;
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (!sticky) {
      toastTimer.current = window.setTimeout(() => {
        if (toastSeq.current === id) setToast(null);
      }, 2600);
    }
    return id;
  }, []);
  const resolveToast = useCallback((id: number, message: string) => {
    if (toastSeq.current !== id) return; // a newer toast has taken over
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (toastSeq.current === id) setToast(null);
    }, 2600);
  }, []);

  const realTodayValue = toLocalIsoDate();
  const visibleSlots = getLessonsForDate(slots, selectedDate);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedRecord = selectedSlot ? attendanceByDate[selectedDate]?.[selectedSlot.id] : undefined;
  const selectedGroup = selectedSlot?.groupId ? mixedGroups?.groups[selectedSlot.groupId] : undefined;
  const selectedRevision = useCurrentRoster ? openedRevision : selectedRecord?.rosterRevision ?? openedRevision;
  const selectedRoster = selectedGroup
    ? (selectedGroup.history[String(selectedRevision)] ?? (selectedRevision === selectedGroup.revision ? selectedGroup.students : [])).map(s => ({...s, name: ""})).sort((a,b) => a.homeClassNo - b.homeClassNo || a.number - b.number)
    : selectedSlot ? rosters[classKey(selectedSlot)] ?? [] : [];
  const selectedDraftKey = selectedSlot ? `${selectedDate}:${selectedSlot.id}` : "";
  const selectedBaseline = selectedSlot
    ? slotAttendanceToMarks(selectedRoster, attendanceByDate[selectedDate]?.[selectedSlot.id])
    : {};
  const selectedDraft = selectedSlot ? drafts[selectedDraftKey] ?? selectedBaseline : {};
  const draftSummary = selectedSlot ? exceptionSummaryFromMarks(selectedDraft, selectedRoster) : "";
  const attendanceForDate = attendanceByDate[selectedDate] ?? {};

  const counts = useMemo(() => {
    const visibleSlotIds = new Set(visibleSlots.map((slot) => slot.id));
    const checked = Object.keys(attendanceForDate).filter((slotId) => visibleSlotIds.has(slotId)).length;
    const pending = pendingItems(queue).length;
    const failed = failedItems(queue).length;
    const unchecked = Math.max(visibleSlots.length - checked, 0);
    return { checked, failed, pending, unchecked };
  }, [attendanceForDate, queue, visibleSlots]);
  const lastSyncedAt = useMemo(() => {
    const times = queue
      .filter((item) => item.status === "synced" && item.syncedAt)
      .map((item) => item.syncedAt as string);
    return times.length ? times.sort().at(-1) ?? null : null;
  }, [queue]);

  const nowPeriod = selectedDate === realTodayValue ? currentPeriodNow() : null;
  const nowCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const card = nowCardRef.current;
    if (tab === "today" && card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "center", behavior: "auto" });
    }
    // Only re-run on view changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedDate]);

  const openLesson = (slot: TimetableSlot) => {
    setHomeClassFilter(null);
    setUseCurrentRoster(false);
    const group = slot.groupId ? mixedGroups?.groups[slot.groupId] : undefined;
    const savedRevision = attendanceByDate[selectedDate]?.[slot.id]?.rosterRevision;
    setOpenedRevision(savedRevision ?? group?.revision);
    const roster = group ? (group.history[String(savedRevision ?? group.revision)] ?? (savedRevision === undefined || savedRevision === group.revision ? group.students : [])).map(s => ({...s, name: ""})) : rosters[classKey(slot)] ?? [];
    const draftKey = `${selectedDate}:${slot.id}`;
    // Seed from the synced record (not all-present) so marks checked on the
    // desktop show up here — and saving doesn't wipe them back to present.
    const record = attendanceByDate[selectedDate]?.[slot.id];
    setDrafts((current) => ({
      ...current,
      [draftKey]: current[draftKey] ?? slotAttendanceToMarks(roster, record),
    }));
    setSelectedSlotId(slot.id);
  };

  const setMark = (studentNumber: string, next: StudentMark) => {
    if (!selectedSlot) return;
    setDrafts((current) => {
      const draft = current[selectedDraftKey] ?? selectedBaseline;
      return {
        ...current,
        [selectedDraftKey]: { ...draft, [studentNumber]: next },
      };
    });
  };
  const lastTap = useRef<{ key: string; number: string; at: number } | null>(null);
  useEffect(() => { lastTap.current = null; }, [selectedDraftKey]);
  const clickStudent = (studentNumber: string) => {
    const now = Date.now();
    const previous = lastTap.current;
    if (previous?.key === selectedDraftKey && previous.number === studentNumber && now - previous.at <= DOUBLE_TAP_MS) {
      setMark(studentNumber, "excused");
      lastTap.current = null;
    } else {
      const mark = selectedDraft[studentNumber] ?? "present";
      setMark(studentNumber, mark === "present" ? "absent" : "present");
      lastTap.current = { key: selectedDraftKey, number: studentNumber, at: now };
    }
  };

  // Mirror the latest queue so flush callbacks read fresh data without being
  // re-created (and re-triggering effects) on every queue change.
  const queueRef = useRef(queue);
  const [conflictReview, setConflictReview] = useState<{
    item: SaveQueueItem; latest: SlotAttendance | null;
  } | null>(null);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const hydratedRef = useRef(false);
  const flushingRef = useRef(false);

  // Upload one enqueued save to Drive and resolve its queue status. Identified
  // by date+slot rather than id because enqueueSave dedupes pending items.
  const flushSave = async (date: string, slotId: string, payload: SlotAttendance, baseline?: SlotAttendance | null) => {
    if (!onSaveSlot || !canSync) return;
    try {
      await onSaveSlot(date, slotId, payload, baseline);
      setQueue((current) => markStatusByTarget(current, date, slotId, "synced", payload.checkedAt));
    } catch (error) {
      setQueue((current) => markStatusByTarget(current, date, slotId, "failed", payload.checkedAt,
        error instanceof Error ? error.message : "저장 실패"));
    }
  };

  // Re-upload every not-yet-synced item. Used on startup, on reconnect, and by
  // the manual retry button. Guarded so overlapping triggers don't double-run;
  // saves are idempotent so a rare duplicate upload is harmless.
  const flushAll = useCallback(async () => {
    if (!onSaveSlot || !canSync || !navigator.onLine || flushingRef.current) return;
    flushingRef.current = true;
    try {
      for (const item of queueRef.current.filter((entry) => entry.status !== "synced")) {
        try {
          await onSaveSlot(item.date, item.slotId, item.payload, item.baseline);
          setQueue((current) => markStatusByTarget(current, item.date, item.slotId, "synced", item.payload.checkedAt));
        } catch (error) {
          setQueue((current) => markStatusByTarget(current, item.date, item.slotId, "failed", item.payload.checkedAt,
            error instanceof Error ? error.message : "저장 실패"));
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [onSaveSlot, canSync]);

  const flushAllRef = useRef(flushAll);
  useEffect(() => {
    flushAllRef.current = flushAll;
    if (hydratedRef.current) void flushAll();
  }, [flushAll]);

  // Restore the persisted queue on startup, overlay its payloads onto the view,
  // then retry anything left unsynced from a previous session.
  useEffect(() => {
    let cancelled = false;
    loadQueue()
      .then((items) => {
        if (cancelled) return;
        if (items.length) {
          queueRef.current = items;
          setQueue(items);
          setAttendanceByDate((current) => {
            const next = { ...current };
            for (const item of items) {
              next[item.date] = { ...(next[item.date] ?? {}), [item.slotId]: item.payload };
            }
            return next;
          });
        }
        hydratedRef.current = true;
        void flushAllRef.current();
      })
      .catch(() => {
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the queue after every change (once hydration has run, so the empty
  // initial state never clobbers a stored queue).
  useEffect(() => {
    if (!hydratedRef.current) return;
    void persistQueue(queue);
  }, [queue]);

  // Track connectivity for the offline banner, and auto-retry uploads when the
  // device comes back online.
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void flushAllRef.current();
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Drive splits attendance into monthly files; we preload only the current
  // month. Fetch a month once, on demand, and merge it in (local entries win so
  // an in-flight save isn't lost).
  const loadedMonthsRef = useRef(new Set<string>(initialMonth ? [initialMonth] : []));
  const ensureMonthLoaded = useCallback(
    (month: string) => {
      if (!onLoadMonth) return;
      if (loadedMonthsRef.current.has(month)) return;
      loadedMonthsRef.current.add(month);
      onLoadMonth(month)
        .then((records) => {
          setAttendanceByDate((current) => {
            const next = { ...current };
            for (const [date, daySlots] of Object.entries(records)) {
              next[date] = { ...daySlots, ...(next[date] ?? {}) };
            }
            return next;
          });
        })
        .catch(() => {
          loadedMonthsRef.current.delete(month);
        });
    },
    [onLoadMonth],
  );
  useEffect(() => {
    ensureMonthLoaded(selectedDate.slice(0, 7));
  }, [selectedDate, ensureMonthLoaded]);
  useEffect(() => {
    if (tab === "record") ensureMonthLoaded(calendarMonth);
  }, [tab, calendarMonth, ensureMonthLoaded]);

  // Persist locally, enqueue, and reconcile the toast to the real Drive result.
  const commitSlot = (date: string, slotId: string, saved: SlotAttendance) => {
    // Carry the edit's original remote baseline through offline restarts.
    const previous = queueRef.current.find(item => item.date === date && item.slotId === slotId && item.status !== "synced");
    const baseline = previous ? previous.baseline : attendanceByDate[date]?.[slotId] ?? null;
    setAttendanceByDate((current) => ({
      ...current,
      [date]: { ...(current[date] ?? {}), [slotId]: saved },
    }));
    setQueue((current) => enqueueSave(current, { date, slotId, payload: saved, baseline }));

    if (onSaveSlot && !canSync) {
      showToast("기기 저장 완료 · Google 연결 필요");
    } else if (onSaveSlot && isOnline) {
      const id = showToast("기기 저장 완료 · 동기화 중", true);
      onSaveSlot(date, slotId, saved, baseline)
        .then(() => {
          setQueue((current) => markStatusByTarget(current, date, slotId, "synced", saved.checkedAt));
          resolveToast(id, "저장 완료");
        })
        .catch((error) => {
          const message = error instanceof Error && error.name === "DriveConflictError"
            ? error.message : error instanceof Error && error.name === "AuthRequiredError"
              ? "기기 저장 완료 · Google 연결 필요" : "저장 실패 — 아래에서 다시 시도";
          setQueue((current) => markStatusByTarget(current, date, slotId, "failed", saved.checkedAt, message));
          resolveToast(id, message);
        });
    } else if (onSaveSlot && !isOnline) {
      showToast("기기에 저장됨 · 연결되면 자동 반영");

    } else {
      showToast("기기에 저장됨");
    }
  };

  const compareFailed = async (item: SaveQueueItem) => {
    if (!onLoadMonth) return;
    try {
      const records = await onLoadMonth(item.date.slice(0, 7));
      setConflictReview({ item, latest: records[item.date]?.[item.slotId] ?? null });
    } catch {
      showToast("최신 기록을 불러오지 못했습니다. 연결 상태를 확인해 주세요.");
    }
  };
  const acceptLatest = () => {
    if (!conflictReview) return;
    const { item, latest } = conflictReview;
    setAttendanceByDate(current => {
      const day = { ...(current[item.date] ?? {}) };
      if (latest) day[item.slotId] = latest;
      else delete day[item.slotId];
      return { ...current, [item.date]: day };
    });
    setQueue(current => current.filter(entry => !(entry.date === item.date && entry.slotId === item.slotId)));
    setConflictReview(null);
  };
  const keepLocal = () => {
    if (!conflictReview) return;
    const { item, latest } = conflictReview;
    const payload = { ...item.payload, checkedAt: new Date().toISOString(), syncedToNeis: false, closedOnNeis: false };
    setQueue(current => enqueueSave(current, { date: item.date, slotId: item.slotId, payload, baseline: latest }));
    setAttendanceByDate(current => ({ ...current, [item.date]: { ...(current[item.date] ?? {}), [item.slotId]: payload } }));
    setConflictReview(null);
    void flushSave(item.date, item.slotId, payload, latest);
  };
  const describeAttendance = (record: SlotAttendance | null) => !record ? "미확인" :
    record.absences.length === 0 ? "전원 출석" : record.absences.map(a => {
      const g = record.groupId ? mixedGroups?.groups[record.groupId] : undefined;
      const s = (g?.history[String(record.rosterRevision)] ?? (g?.revision === record.rosterRevision ? g?.students : []))?.find(s => s.studentId === a.studentId);
      return `${s ? `${s.homeClassNo}반 ${s.number}번` : a.studentNumber !== undefined ? `${a.studentNumber}번` : "명부 확인 필요"} ${a.markType === "excused" ? "인정결과" : "결과"}`;
    }).join(", ");

  const saveLesson = () => {
    if (!selectedSlot) return;
    if (selectedSlot.groupId && (!selectedGroup || selectedRevision !== selectedGroup.revision)) {
      showToast("명부가 변경되었습니다. 최신 명부로 다시 확인해 주세요."); return;
    }
    const date = selectedDate;
    const slotId = selectedSlot.id;
    const saved = marksToSlotAttendance(selectedDraft, new Date().toISOString(), selectedGroup ? {groupId: selectedGroup.id, rosterRevision: selectedGroup.revision} : undefined);
    commitSlot(date, slotId, saved);
    setDrafts((current) => {
      const next = { ...current };
      delete next[`${date}:${slotId}`];
      return next;
    });
    setSelectedSlotId(null);
  };

  const saveAllPresent = (slot: TimetableSlot) => {
    const roster = rosters[classKey(slot)] ?? [];
    const marks: MarksByStudent = Object.fromEntries(
      roster.map((student) => [studentKey(student), "present" as StudentMark]),
    );
    const group = slot.groupId ? mixedGroups?.groups[slot.groupId] : undefined;
    if (slot.groupId && !group) { showToast("혼합수업 명부를 불러와 주세요."); return; }
    const saved = marksToSlotAttendance(marks, new Date().toISOString(), group ? {groupId: group.id, rosterRevision: group.revision} : undefined);
    commitSlot(selectedDate, slot.id, saved);
  };

  // Cancel = discard: drop the draft and close. Confirm once if there are
  // unsaved changes. Backdrop tap uses the same path.
  const closeLesson = () => {
    if (!selectedSlot) {
      setSelectedSlotId(null);
      return;
    }
    const draft = drafts[selectedDraftKey];
    const dirty = draft && !marksEqual(draft, selectedBaseline);
    if (dirty && !window.confirm("변경 내용을 버릴까요?")) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[selectedDraftKey];
      return next;
    });
    setSelectedSlotId(null);
  };

  const retryFailed = () => {
    void flushAll();
  };

  const ackPrivacy = () => {
    localStorage.setItem(PRIVACY_ACK_KEY, "1");
    setPrivacyAcked(true);
  };

  const dayStatus = (date: string): "done" | "unchecked" | "failed" | null => {
    const lessons = getLessonsForDate(slots, date);
    if (!lessons.length) return null;
    const records = attendanceByDate[date] ?? {};
    if (queue.some((item) => item.date === date && item.status === "failed")) return "failed";
    const checked = lessons.filter((lesson) => records[lesson.id]).length;
    if (checked === lessons.length) return "done";
    // Future lessons are not "missed" yet — flag 미확인 only up to today.
    return date > realTodayValue ? null : "unchecked";
  };

  const renderLessonList = (date: string, showNow: boolean) => {
    const lessons = getLessonsForDate(slots, date);
    const records = attendanceByDate[date] ?? {};
    if (lessons.length === 0) {
      return <div className="empty-card">선택한 날짜에 표시할 수업이 없습니다.</div>;
    }
    return (
      <div className="lesson-list">
        {lessons.map((slot) => {
          const saved = records[slot.id];
          const summary = computeLessonDisplayStatus(saved);
          const queued = queue.find((item) => item.date === date && item.slotId === slot.id);
          const driveStatus =
            queued?.status === "failed"
              ? { className: "failed", label: "Drive 실패" }
              : queued?.status === "pending"
                ? { className: "pending", label: "Drive 대기" }
                : { className: "synced", label: "Drive 완료" };
          const neisLabel = saved?.syncedToNeis
            ? saved.closedOnNeis
              ? "NEIS 마감됨"
              : "NEIS 반영됨"
            : "NEIS 미반영";
          const isNow = showNow && date === realTodayValue && slot.period === nowPeriod;
          return (
            <div
              className={`lesson-card ${summary.checked ? "checked" : ""} ${isNow ? "now" : ""}`}
              key={slot.id}
              ref={isNow ? nowCardRef : undefined}
            >
              <button
                className="lesson-open"
                type="button"
                onClick={() => openLesson(slot)}
                aria-label={`${slot.grade}-${slot.classNo} ${slot.subjectName} ${slot.period}교시 열기`}
              >
                <span className="period">{slot.period}교시</span>
                <span className="lesson-main">
                  <strong>
                    {slot.grade}-{slot.classNo} {slot.subjectName}
                    {isNow && <span className="now-badge">지금</span>}
                  </strong>
                  {/* Unchecked cards already say 미확인 in the status chip — skip the duplicate detail line. */}
                  {summary.checked && <small>{summary.compactLabel}</small>}
                  {saved?.groupId && <small>{describeAttendance(saved)}</small>}
                  {saved && <small className="saved-at">{formatSavedAt(saved.checkedAt)}</small>}
                  {saved && (
                    <span className="meta-row">
                      <span className={`mini-status ${driveStatus.className}`}>{driveStatus.label}</span>
                      <span className="mini-status">{neisLabel}</span>
                    </span>
                  )}
                </span>
                <span className={summary.checked ? "status done" : "status"}>
                  {summary.checked ? "확인함" : "미확인"}
                </span>
              </button>
              {!summary.checked && (
                <button
                  className="lesson-allpresent"
                  type="button"
                  onClick={() => saveAllPresent(slot)}
                >
                  전원 출석으로 저장
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mobile-app">
      {!privacyAcked && (
        <div className="privacy-banner" role="alert">
          <span>이 앱은 학생 학번·출결만 처리합니다. 학생 이름은 외부로 전송·저장되지 않습니다.</span>
          <button type="button" className="privacy-banner-btn" onClick={ackPrivacy}>확인</button>
        </div>
      )}

      {tab === "today" && (
        <>
          <header className="top">
            <div>
              <p className="muted">교과 출결</p>
              <h1>{selectedDate === initialDate ? "오늘 수업" : "선택 날짜"}</h1>
            </div>
            <div className="top-actions">
              {stale && <span className="stale-badge">저장된 사본</span>}
              {stale && onRefresh && (
                <button className="round-btn" type="button" onClick={onRefresh} aria-label="새로 불러오기">↻</button>
              )}
              {counts.pending > 0 && (
                <div className="sync-pill" aria-label={`동기화 대기 ${counts.pending}건`}>
                  동기화 대기 {counts.pending}건
                </div>
              )}
              <button className="round-btn" type="button" aria-label="설정" onClick={() => setSettingsOpen(true)}>
                <GearIcon />
              </button>
            </div>
          </header>

          <button
            className="date-card"
            type="button"
            aria-label="날짜 선택"
            onClick={() => {
              setDateInputValue(selectedDate);
              setDateSheetOpen(true);
            }}
          >
            <div>
              <strong>{selectedDateLabel(selectedDate)}</strong>
              <span>{onSaveSlot ? "Google Drive 연동 · 모바일 입력" : "샘플 데이터 · 데모"}</span>
            </div>
            <div
              className={`ring ${counts.checked === visibleSlots.length && visibleSlots.length > 0 ? "complete" : ""}`}
              style={{
                "--ring-pct": `${visibleSlots.length ? Math.round((counts.checked / visibleSlots.length) * 100) : 0}%`,
              } as CSSProperties}
            >
              {counts.checked}/{visibleSlots.length}
            </div>
          </button>

          {onRefresh && (!canSync || connectionError) && (
            <div className="status-banner offline" role="status">
              <span>{connectionError || "Google 연결이 만료되었습니다. 입력은 기기에 보관됩니다."}</span>
              <button type="button" onClick={onRefresh} disabled={connecting}>
                {connecting ? "연결 중…" : "Google 다시 연결"}
              </button>
            </div>
          )}
          {!isOnline && (
            <div className="status-banner offline" role="status">
              인터넷에 연결되어 있지 않아요. 저장은 기기에 보관되고, 연결되면 자동으로 반영됩니다.
            </div>
          )}
          {onSaveSlot && counts.failed > 0 && (
            <div className="status-banner failed" role="alert">
              <span>저장 실패 {counts.failed}건이 있어요.</span>
              <span>{queue.find(item => item.status === "failed" && item.error)?.error}</span>
              <button type="button" onClick={retryFailed}>다시 시도</button>
              {onLoadMonth && failedItems(queue).map(item => (
                <button type="button" key={item.id} onClick={() => void compareFailed(item)}>
                  {item.date} · {item.slotId} 최신 기록과 비교
                </button>
              ))}
            </div>
          )}

          {conflictReview && (
            <section className="status-banner failed" role="dialog" aria-label="동시 수정 확인">
              <div>기기에 보관한 기록: {describeAttendance(conflictReview.item.payload)}</div>
              <div>Drive 최신 기록: {describeAttendance(conflictReview.latest)}</div>
              <button type="button" onClick={acceptLatest}>최신 기록 사용</button>
              <button type="button" onClick={keepLocal}>내 기록으로 다시 저장</button>
              <button type="button" onClick={() => setConflictReview(null)}>닫기</button>
            </section>
          )}
          <main>{renderLessonList(selectedDate, true)}</main>
        </>
      )}

      {tab === "record" && (
        <>
          <header className="top">
            <div>
              <p className="muted">교과 출결</p>
              <h1>기록</h1>
            </div>
            <button className="round-btn" type="button" aria-label="설정" onClick={() => setSettingsOpen(true)}>
              <GearIcon />
            </button>
          </header>

          <section className="calendar-card">
            <div className="calendar-head">
              <button type="button" className="round-btn" aria-label="이전 달" onClick={() => setCalendarMonth((m) => addMonths(m, -1))}>‹</button>
              <strong>{monthTitle(calendarMonth)}</strong>
              <button type="button" className="round-btn" aria-label="다음 달" onClick={() => setCalendarMonth((m) => addMonths(m, 1))}>›</button>
            </div>
            <div className="calendar-weekdays">
              {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {buildMonthGrid(calendarMonth).map((date, index) => {
                if (!date) return <span key={`e-${index}`} className="cal-cell empty" />;
                const status = dayStatus(date);
                const day = Number(date.slice(8));
                return (
                  <button
                    key={date}
                    type="button"
                    className={`cal-cell ${date === selectedDate ? "sel" : ""}`}
                    aria-label={`${date} ${status === "done" ? "완료" : status === "failed" ? "저장 실패" : status === "unchecked" ? "미확인" : ""}`}
                    onClick={() => setSelectedDate(date)}
                  >
                    <span className="cal-day">{day}</span>
                    {status && <span className={`cal-dot ${status}`} />}
                  </button>
                );
              })}
            </div>
            <div className="calendar-legend">
              <span><i className="cal-dot done" />완료</span>
              <span><i className="cal-dot unchecked" />미확인</span>
              <span><i className="cal-dot failed" />실패</span>
            </div>
          </section>

          <section className="record-day">
            <h2 className="record-day-title">{selectedDateLabel(selectedDate)}</h2>
            <main>{renderLessonList(selectedDate, false)}</main>
          </section>
        </>
      )}

      <nav className="bottom-nav" aria-label="모바일 메뉴">
        <button className={tab === "today" ? "on" : ""} type="button" onClick={() => setTab("today")}>오늘</button>
        <button className={tab === "record" ? "on" : ""} type="button" onClick={() => setTab("record")}>기록</button>
      </nav>

      {settingsOpen && (
        <div className="settings-screen" role="dialog" aria-modal="true" aria-label="설정">
          <header className="settings-head">
            <h1>설정</h1>
            <button className="icon-btn" type="button" aria-label="설정 닫기" onClick={() => setSettingsOpen(false)}>×</button>
          </header>
          <div className="settings-body">
            <section className="info-card">
              <strong>보안</strong>
              {paired === true && (
                <>
                  <p><b>암호화로 보호 중</b> — 출결 데이터가 암호화되어 저장되며, 이
                    기기와 데스크톱만 읽을 수 있습니다. QR 연결은 기기마다 처음 한 번만
                    필요합니다.</p>
                  <button className="secondary danger" type="button" onClick={() => void disconnectPairing()}>
                    기기 연결 해제
                  </button>
                </>
              )}
              {paired === false && (
                <>
                  <p>암호화 기기 연결되지 않음 — 데스크톱 앱의 <b>설정 → 모바일 연결
                    암호화</b>에서 QR을 띄운 뒤, 아래 버튼으로 연결하세요.</p>
                  <button className="primary wide" type="button" onClick={() => setPairingOpen(true)}>
                    지금 연결하기
                  </button>
                </>
              )}
            </section>
            <section className="info-card">
              <strong>개인정보</strong>
              <p>학생 이름은 Drive에 보내지 않습니다. 학번·출결 등은 본인 Google Drive에 저장하며,
                연결 암호화를 사용하면 기기에서 암호화한 뒤 전송합니다.</p>
              <button className="policy-link" type="button" onClick={() => setShowPrivacy(true)}>개인정보처리방침 · 이용 안내</button>
            </section>
            <section className="info-card">
              <strong>시간표</strong>
              <p className="page-note">편집은 PC(데스크톱 앱)에서 합니다.</p>
              {slots.map((slot) => (
                <p key={slot.id}>{slot.period}교시 · {slot.grade}-{slot.classNo} {slot.subjectName}</p>
              ))}
            </section>
            <section className="info-card">
              <strong>학생 명부</strong>
              {Object.entries(rosters).map(([key, roster]) => (
                <p key={key}>{key.startsWith("mixed:") ? (() => { const g = mixedGroups?.groups[key.slice(6)]; return g ? `${g.grade}학년 ${g.classNo} · ${g.subjectName}` : "혼합수업"; })() : key} · {roster.length}명</p>
              ))}
            </section>
            <section className="info-card">
              <strong>계정</strong>
              <p>Google 계정에 연결되어 출결이 내 Drive에 저장됩니다.</p>
              {lastSyncedAt && <p>마지막 동기화: {formatSavedAt(lastSyncedAt)}</p>}
              {onSignOut && (
                <button className="secondary danger" type="button" onClick={onSignOut}>로그아웃 (연결 해제)</button>
              )}
            </section>
          </div>
        </div>
      )}

      {dateSheetOpen && (
        <div className="sheet" role="presentation" onClick={() => setDateSheetOpen(false)}>
          <div
            className="sheet-panel compact-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="날짜 선택"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grabber" />
            <div className="sheet-head">
              <div>
                <p className="muted">수업 날짜</p>
                <h2>날짜 선택</h2>
              </div>
              <button className="icon-btn" type="button" onClick={() => setDateSheetOpen(false)} aria-label="닫기">×</button>
            </div>
            <div className="quick-dates">
              <button type="button" onClick={() => { const nextDate = addDays(selectedDate, -1); setSelectedDate(nextDate); setDateInputValue(nextDate); setDateSheetOpen(false); }}>어제</button>
              <button type="button" onClick={() => { const nextDate = toLocalIsoDate(); setSelectedDate(nextDate); setDateInputValue(nextDate); setDateSheetOpen(false); }}>오늘</button>
              <button type="button" onClick={() => { const nextDate = addDays(selectedDate, 1); setSelectedDate(nextDate); setDateInputValue(nextDate); setDateSheetOpen(false); }}>내일</button>
            </div>
            <input
              className="date-input"
              type="date"
              aria-label="직접 날짜 선택"
              value={dateInputValue}
              onChange={(event) => {
                const nextDate = event.target.value;
                setDateInputValue(nextDate);
                if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
                  setSelectedDate(nextDate);
                }
              }}
            />
          </div>
        </div>
      )}

      {selectedSlot && (
        <div className="sheet" role="presentation" onClick={() => closeLesson()}>
          <div
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedSlot.grade}-${selectedSlot.classNo} ${selectedSlot.subjectName} 출결 입력`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grabber" />
            <div className="sheet-head">
              <div>
                <p className="muted">{selectedSlot.period}교시 · {selectedSlot.grade}학년 {selectedSlot.classNo}</p>
                <h2>{selectedSlot.grade}-{selectedSlot.classNo} {selectedSlot.subjectName}</h2>
              </div>
              <button className="icon-btn" type="button" onClick={() => closeLesson()} aria-label="닫기">×</button>
            </div>

            <div className="legend">
              <span><i className="dot present" />출석</span>
              <span><i className="dot absent" />결과</span>
              <span><i className="dot excused" />인정결과</span>
              <span className="legend-hint">한 번 눌러 결과 · 두 번 연속 눌러 인정결과</span>
            </div>

            {selectedSlot.groupId && <div className="quick-dates" aria-label="원소속 반 필터">
              {[null, ...Array.from(new Set(selectedRoster.map(s => s.homeClassNo!)))].map(c => <button key={c ?? "all"} type="button" aria-pressed={homeClassFilter === c} onClick={() => setHomeClassFilter(c)}>{c === null ? "전체" : `${c}반`}</button>)}
            </div>}
            {selectedSlot.groupId && selectedRevision !== selectedGroup?.revision && <div role="alert">
              이전 명부의 기록입니다. 저장하려면 최신 명부에서 다시 확인해 주세요.
              <button type="button" onClick={() => { setUseCurrentRoster(true); setOpenedRevision(selectedGroup?.revision); setDrafts(current => {const next = {...current}; delete next[selectedDraftKey]; return next;}); }}>최신 명부로 다시 확인</button>
            </div>}
            <div className="chip-grid">
              {selectedRoster.filter(s => homeClassFilter === null || s.homeClassNo === homeClassFilter).map((student, index, visible) => {
                const key = studentKey(student);
                const mark = selectedDraft[key] ?? "present";
                return (
                  <Fragment key={key}>
                  {student.homeClassNo && (index === 0 || visible[index - 1].homeClassNo !== student.homeClassNo) && <strong style={{gridColumn: "1 / -1"}}>{student.homeClassNo}반</strong>}
                  <button
                    key={key}
                    className="chip"
                    data-mark={mark}
                    type="button"
                    aria-pressed={mark !== "present"}
                    aria-label={`${student.homeClassNo ? `${student.homeClassNo}반 ` : ""}${student.number}번 ${!student.studentId && student.name ? `${student.name} ` : ""}${markLabel(mark)}`}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={() => clickStudent(key)}
                  >
                    <span className="chip-no">{student.number}</span>
                    {student.homeClassNo && <span className="chip-name">{student.homeClassNo}반</span>}
                    {!student.studentId && student.name && <span className="chip-name">{student.name}</span>}
                  </button>
                  </Fragment>
                );
              })}
            </div>

            <div className="draft-summary">
              <strong>저장 전 요약</strong>
              <span>{draftSummary}</span>
            </div>

            <div className="sheet-actions">
              <button className="secondary" type="button" onClick={() => closeLesson()}>취소</button>
              <button className="primary" type="button" onClick={saveLesson}>저장</button>
            </div>
          </div>
        </div>
      )}

      {pairingOpen && (
        <div className="fs-overlay">
          <Pairing
            onPaired={() => {
              setPairingOpen(false);
              setPaired(true);
              onRefresh?.();
            }}
          />
        </div>
      )}

      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
