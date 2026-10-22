import React from "react";
import { HomeroomView } from "./homeroom-view";
import { desktopHomeApi } from "./homeroom-api";
import { BrandMark, Icon } from "./components";
import { LogDock } from "./log-panel";
import { RegistrationView } from "./registration-view";
import { RunView } from "./run-view";
import { TimetableWorkspace } from "./timetable-workspace";
import { ClassManager } from "./class-workspace";
import { HistoryView } from "./attendance-history-view";
import { emptyMixedDocument, matchesMixedGroup, type MixedDocument, type MixedGroup } from "./mixed-class";
import { BasicsView, TimetableView, RosterView, PlaceholderView, ConnectionView } from "./setup-view";
import { OnboardingGuide } from "./onboarding";
import { PrivacyPolicy } from "./privacy-policy";
import { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakToggle, TweakSlider, TweakColor, TweakSelect } from "./tweaks-panel";
import { TODAY_SLOTS, TIMETABLE, ROSTERS } from "./data";
import {
  now, todayIso, toIsoDate, weekKeyFromIsoDate, toGradeNumber, normalizeSubjectName,
  DAY_TO_KEY, KEY_TO_DAY, parseJsonResult, formatApiError, isTransientNetworkError, parseTextResult,
  settingsFromApi, settingsToApi, timetableRowsFromTsv, timetableRowsToTsv, rostersFromTsv, rostersToTsv,
  classKeyFromTimetableRow, rosterKeysFromTimetable, syncRostersToTimetable,
} from "./lib/transforms";

const { useState, useEffect, useMemo, useRef } = React;

// 담임 출결은 별도 개발 중이라 릴리스에서는 숨긴다. 다시 열려면 true로.
const HOMEROOM_ENABLED = false;

const NAV = [
  { group: "", items: [
    { key: "run", label: "NEIS 출결 등록", icon: "bolt" },
    ...(HOMEROOM_ENABLED ? [{ key: "homeroom", label: "담임 출결", icon: "users" }] : []),
    { key: "history", label: "출결 내역", icon: "board" },
  ]},
  { group: "설정", items: [
    { key: "basics",    label: "기본 정보", icon: "gear" },
    { key: "roster",    label: "학급·명단", icon: "users" },
    { key: "timetable", label: "시간표",   icon: "board" },
    { key: "connect",   label: "연결",     icon: "cloud" },
  ]},
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#0A84FF",
  "theme": "light",
  "density": "cozy",
  "sidebarMode": "expanded",
  "showLog": true,
  "corner": 18
}/*EDITMODE-END*/;


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const [page, setPage] = useState<any>("run");
  const [homeOpened,setHomeOpened]=useState(false);
  useEffect(()=>{if(page==="homeroom")setHomeOpened(true);},[page]);
  const [slots, setSlots] = useState<any>(TODAY_SLOTS);
  const [timetable, setTimetable] = useState<any>(TIMETABLE);
  const [rosters, setRosters] = useState<any>(ROSTERS);
  const [mixedDocument, setMixedDocument] = useState<MixedDocument>(emptyMixedDocument);
  const [mixedEncryption, setMixedEncryption] = useState(false);
  const [date, setDate] = useState<any>(todayIso());
  const [password, setPassword] = useState<any>("");
  const [closeAfter, setCloseAfter] = useState<any>(false);
  const [running, setRunning] = useState<any>(false);
  const [progress, setProgress] = useState<any>({ done: 0, total: 0, current: "", state: "idle" });
  const [logOpen, setLogOpen] = useState<any>(false);
  const [showOnboarding, setShowOnboarding] = useState<any>(() => {
    try { return localStorage.getItem("onboardingSeen") !== "1"; } catch { return true; }
  });
  const closeOnboarding = () => {
    try { localStorage.setItem("onboardingSeen", "1"); } catch {}
    setShowOnboarding(false);
  };
  const [showPrivacy, setShowPrivacy] = useState<any>(false);
  const [logLines, setLogLines] = useState<any>([
    { ts: "09:02:14", lv: "안내", msg: "앱 실행 — subject_teacher v0.4.1" },
    { ts: "09:02:14", lv: "완료", msg: "Google Drive 연결 · 3개 파일 감지" },
    { ts: "09:02:15", lv: "완료", msg: "설정·시간표·학생 명부 불러오기 완료" },
    { ts: "09:02:15", lv: "완료", msg: "오늘 수업 6건 로드 — 3건 반영됨, 3건 대기" },
  ]);
  const [settings, setSettings] = useState<any>({
    teacherName: "", schoolName: "", schoolCode: "", schoolKind: "", region: "서울", year: "2026", term: "1", effectiveFrom: "2026-03-02", closeByDefault: false,
    timetableMode: "neis", assignedLessons: []
  });
  const [driveUser, setDriveUser] = useState<any>(null);
  const [setupReady,setSetupReady]=useState(false);
  const [slotsLoadedDate,setSlotsLoadedDate]=useState("");
  const slotRequests=useRef(new Map<string,{id:number;promise:Promise<any>}>());
  const slotRequestId=useRef(0);
  const [slotLoading, setSlotLoading] = useState<any>(false);
  const [slotError, setSlotError] = useState<any>("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reconnecting, setReconnecting] = useState<any>(false);
  const [savedRosterSignature, setSavedRosterSignature] = useState(JSON.stringify(ROSTERS));
  const mobileTimetableSyncRef = useRef(new Set());
  const legacyTimetable = timetable.filter(lesson => !Object.values(mixedDocument.groups).some(group => matchesMixedGroup(group, lesson)));
  const legacyAssignedLessons = (settings.assignedLessons || []).filter(lesson => !Object.values(mixedDocument.groups).some(group => matchesMixedGroup(group, lesson)));
  const rosterKeySignature = useMemo(
    () => rosterKeysFromTimetable(legacyTimetable, legacyAssignedLessons).join("\t"),
    [timetable, JSON.stringify(settings.assignedLessons || []), mixedDocument],
  );

  // Visible feedback for menu actions. The log dock is hidden by default, so
  // 저장/불러오기/가져오기 results were invisible; surface 완료/오류 as a toast.
  const [toast, setToast] = useState<any>(null);
  const toastTimer = React.useRef<any>(null);
  const appendLog = (lv, msg) => {
    setLogLines(l => [...l, { ts: now(), lv, msg }]);
    // Stay quiet during a NEIS run (the progress bar already shows that);
    // otherwise pop a toast so button results are visible without the log.
    if (!running && (lv === "완료" || lv === "오류")) {
      setToast({ lv, msg });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 2800);
    }
  };
  const clearLog = () => setLogLines([]);

  const reconnect = () => {
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("안내", "브라우저 미리보기에서는 다시 연결을 사용할 수 없습니다");
      return;
    }
    setReconnecting(true);
    appendLog("안내", "브라우저에서 구글 계정으로 로그인해 주세요…");
    window.pywebview!.api.reconnect()
      .then(raw => { const u = parseJsonResult(raw); setDriveUser(u); appendLog("완료", `다시 연결됨 · ${u.emailAddress || "계정"}`); return loadSetupData(); })
      .catch(err => appendLog("오류", `다시 연결 실패: ${formatApiError(err)}`))
      .finally(() => setReconnecting(false));
  };

  const refreshSlots = (dateStr = toIsoDate(date), options: { attempts?: number; silentRetry?: boolean; force?: boolean } = {}) => {
    if (!(window.__isPywebview && window.__isPywebview())) return Promise.resolve();
    const requestKey=`${dateStr}/${!!options.force}`;
    const existing=slotRequests.current.get(requestKey);
    if(existing?.id===slotRequestId.current)return existing.promise;
    const requestId=++slotRequestId.current;
    const attempts = options.attempts || 3;
    setSlotLoading(true);
    setSlotError("");
    const run = (attempt) => window.pywebview!.api.get_today_slots(dateStr, !!options.force)
      .then(raw => {
        const data = parseJsonResult(raw);
        if (Array.isArray(data)&&requestId===slotRequestId.current) {setSlots(data);setSlotsLoadedDate(dateStr);}
        return data;
      })
      .catch(err => {
        if (attempt < attempts && isTransientNetworkError(err)) {
          if (attempt === 1 && !options.silentRetry) {
            appendLog("안내", "네트워크가 불안정해 수업을 다시 불러오는 중...");
          }
          return sleep(600 * attempt).then(() => run(attempt + 1));
        }
        const message = formatApiError(err);
        if(requestId===slotRequestId.current)setSlotError(message);
        appendLog("오류", `수업 불러오기 실패: ${message}`);
      });
    const promise=run(1).finally(()=>{if(slotRequests.current.get(requestKey)?.id===requestId)slotRequests.current.delete(requestKey);if(requestId===slotRequestId.current)setSlotLoading(false);});
    slotRequests.current.set(requestKey,{id:requestId,promise});return promise;
  };

  const loadMixedGroups = async () => {
    if (!window.pywebview?.api) return;
    setMixedEncryption(false);
    const data = parseJsonResult(await window.pywebview.api.get_mixed_groups());
    if (data.document?.schemaVersion !== 1) throw new Error("혼합수업 형식을 지원하지 않습니다. 체크온을 업데이트해 주세요.");
    setMixedDocument(data.document); setMixedEncryption(!!data.encryptionEnabled);
    return data.document as MixedDocument;
  };
  const saveMixedGroup = async (payload) => {
    if (!window.pywebview?.api) throw new Error("데스크톱 앱에서 암호화를 연결한 후 저장해 주세요.");
    const data = parseJsonResult(await window.pywebview.api.save_mixed_group(JSON.stringify(payload)));
    setMixedDocument(data.document);
    await refreshSlots(toIsoDate(date));
    appendLog("완료", "혼합수업 명부 저장 완료");
    return data;
  };
  const importMixedStudents = async (grade) => {
    if (!window.pywebview?.api) return { cancelled: true };
    return parseJsonResult(await window.pywebview.api.import_mixed_students_file(grade));
  };
  const bindMixedGroup = async (group: MixedGroup, schedule?: {day:string;period:number}) => {
    if ((settings.timetableMode || "neis") === "neis") {
      if ((settings.assignedLessons || []).some(lesson => matchesMixedGroup(group, lesson))) return;
      const next = {...settings, assignedLessons:[...(settings.assignedLessons || []), {grade:group.grade,classNo:group.classNo,subjectName:group.subjectName,neisSubjectLabel:group.neisSubjectLabel || group.subjectName,subjectAliases:[]}]};
      if(window.pywebview?.api) parseJsonResult(await window.pywebview.api.save_settings(JSON.stringify(settingsToApi(next))));
      setSettings(next);
    } else {
      if(timetable.some(lesson => matchesMixedGroup(group,lesson))) return;
      if(!schedule) throw new Error("명단은 저장되었습니다. 시간표에서 이 학급의 요일과 교시를 지정해 주세요.");
      if(timetable.some(l=>l.day===schedule.day && Number(l.period)===schedule.period)) throw new Error("명단은 저장되었습니다. 해당 교시에 다른 수업이 있어 시간표에서 조정해 주세요.");
      const next=[...timetable,{...schedule,grade:group.grade,classNo:group.classNo,subject:group.subjectName,neis:group.neisSubjectLabel || group.subjectName}];
      if(window.pywebview?.api) parseJsonResult(await window.pywebview.api.save_timetable_tsv(timetableRowsToTsv(next),settings.effectiveFrom));
      setTimetable(next);
    }
    mobileTimetableSyncRef.current.clear();
  };

  const loadSetupData = () => {
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("안내", "브라우저 미리보기에서는 샘플 설정을 사용합니다");
      return Promise.resolve();
    }
    ++slotRequestId.current;
    setSetupReady(false);setSlotsLoadedDate("");setSlotLoading(true);setSlots([]);
    appendLog("안내", "설정을 불러오는 중...");
    return window.pywebview!.api.get_drive_user()
      .then(userRaw => window.pywebview!.api.get_settings().then(settingsRaw => ({ userRaw, settingsRaw })))
      .then(({ userRaw, settingsRaw }) => (
        window.pywebview!.api.get_timetable_tsv()
          .then(timetableRaw => ({ userRaw, settingsRaw, timetableRaw }))
      ))
      .then(({ userRaw, settingsRaw, timetableRaw }) => (
        window.pywebview!.api.get_students_tsv()
          .then(studentsRaw => ({ userRaw, settingsRaw, timetableRaw, studentsRaw }))
      ))
      .then(({ userRaw, settingsRaw, timetableRaw, studentsRaw }) => {
      const loadedUser = parseJsonResult(userRaw);
      const loadedSettings = settingsFromApi(parseJsonResult(settingsRaw));
      const loadedTimetable = timetableRowsFromTsv(parseTextResult(timetableRaw));
      const loadedRosters = rostersFromTsv(parseTextResult(studentsRaw));
      setDriveUser(loadedUser);
      setSettings(loadedSettings);
      setCloseAfter(loadedSettings.closeByDefault);
      setTimetable(loadedTimetable);
      setRosters(syncRostersToTimetable(loadedRosters, loadedTimetable, loadedSettings.assignedLessons));
      setSavedRosterSignature(JSON.stringify(syncRostersToTimetable(loadedRosters, loadedTimetable, loadedSettings.assignedLessons)));
      appendLog("완료", `설정 불러오기 완료 · ${loadedUser.emailAddress || "계정 미확인"} · 수업 ${loadedTimetable.length}개`);
      return loadMixedGroups().then(() => setSetupReady(true));
    }).catch(err => {setSlotLoading(false);setSlotError(formatApiError(err));appendLog("오류", `설정 불러오기 실패: ${formatApiError(err)}`);});
  };

  useEffect(() => {
    setRosters(prev => syncRostersToTimetable(prev, legacyTimetable, legacyAssignedLessons));
  }, [rosterKeySignature]);

  const saveSettings = (successMessage = "기본 정보 저장됨", settingsSnapshot = settings) => {
    if (!(window.__isPywebview && window.__isPywebview())) {
      setSettings(settingsSnapshot);
      appendLog("완료", `${successMessage} (미리보기)`);
      return Promise.resolve();
    }
    return window.pywebview!.api.save_settings(JSON.stringify(settingsToApi(settingsSnapshot)))
      .then(raw => {
        parseJsonResult(raw);
        setSettings(settingsSnapshot);
        appendLog("완료", successMessage);
        return refreshSlots(toIsoDate(date));
      })
      .catch(err => {appendLog("오류", `기본 정보 저장 실패: ${formatApiError(err)}`);throw err;});
  };

  const saveTimetable = () => {
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("완료", "시간표 저장됨 (미리보기)");
      return;
    }
    return window.pywebview!.api.save_timetable_tsv(timetableRowsToTsv(timetable), settings.effectiveFrom)
      .then(raw => {
        parseJsonResult(raw);
        appendLog("완료", "시간표 저장됨");
        return refreshSlots(toIsoDate(date));
      })
      .catch(err => {appendLog("오류", `시간표 저장 실패: ${formatApiError(err)}`);throw err;});
  };

  const previewNeisPublicTimetable = (payload) => {
    const request = {
      ...payload,
      region: payload.region || settings.region,
      schoolName: payload.schoolName || settings.schoolName,
      schoolCode: payload.schoolCode || settings.schoolCode,
      schoolKind: payload.schoolKind || settings.schoolKind,
    };
    if (!(window.__isPywebview && window.__isPywebview())) {
      const targetDay = ["일","월","화","수","목","금","토"][new Date(`${request.date}T00:00:00`).getDay()];
      const lessons = timetable
        .filter(row => row.day === targetDay && Number(row.grade) === Number(request.grade) && String(row.classNo) === String(request.classNo))
        .map(row => ({ day: row.day, period: row.period, grade: row.grade, classNo: row.classNo, subject: row.subject, neis: row.neis || row.subject }));
      appendLog("안내", "브라우저 미리보기에서는 현재 시간표에서 후보를 만듭니다");
      return Promise.resolve({ school: { name: request.schoolName || "미리보기 학교" }, date: request.date, lessons });
    }
    return window.pywebview!.api.preview_neis_public_timetable(JSON.stringify(request))
      .then(raw => parseJsonResult(raw));
  };

  const findNeisSubjectCandidates = (payload) => {
    const request = {
      ...payload,
      region: payload.region || settings.region,
      schoolName: payload.schoolName || settings.schoolName,
      schoolCode: payload.schoolCode || settings.schoolCode,
      schoolKind: payload.schoolKind || settings.schoolKind,
    };
    if (!(window.__isPywebview && window.__isPywebview())) {
      const input = normalizeSubjectName(request.subjectName || "");
      const subjects = [...new Set(timetable.map(row => row.neis || row.subject).filter(Boolean))];
      const candidates = subjects
        .map(subject => ({ subject, score: normalizeSubjectName(subject) === input ? 100 : 50 }))
        .filter(candidate => input && normalizeSubjectName(candidate.subject).includes(input))
        .slice(0, 8);
      appendLog("안내", "브라우저 미리보기에서는 현재 시간표 과목에서 후보를 만듭니다");
      return Promise.resolve({ scope: "preview", candidates });
    }
    return window.pywebview!.api.find_neis_subject_candidates(JSON.stringify(request))
      .then(raw => parseJsonResult(raw));
  };

  const searchSchools = (payload) => {
    const request = {
      region: (payload && payload.region) || settings.region,
      schoolName: (payload && payload.schoolName) || settings.schoolName,
    };
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("안내", "브라우저 미리보기에서는 예시 학교 목록을 보여줍니다");
      return Promise.resolve({ schools: [
        { name: request.schoolName || "예시고등학교", code: "0000001", kind: "고등학교", officeCode: "", district: "○○교육지원청", address: "예시 주소 1" },
        { name: request.schoolName || "예시고등학교", code: "0000002", kind: "고등학교", officeCode: "", district: "△△교육지원청", address: "예시 주소 2" },
      ] });
    }
    return window.pywebview!.api.search_schools(JSON.stringify(request))
      .then(raw => parseJsonResult(raw));
  };

  const savePassword = (pw: string) => {
    if (!(window.__isPywebview && window.__isPywebview())) return;
    window.pywebview!.api.save_password(pw).catch(() => {});
  };

  const publishNeisTimetableForMobile = (dateStr = toIsoDate(date), options: { force?: boolean; once?: boolean; silent?: boolean } = {}) => {
    const targetDate = toIsoDate(dateStr);
    const weekKey = weekKeyFromIsoDate(targetDate);
    if (!options.force && options.once && mobileTimetableSyncRef.current.has(weekKey)) {
      return Promise.resolve({ ok: true, skipped: true, effectiveFrom: weekKey });
    }
    if (!options.force && options.once) mobileTimetableSyncRef.current.add(weekKey);
    if (!(window.__isPywebview && window.__isPywebview())) {
      mobileTimetableSyncRef.current.add(weekKey);
      if (!options.silent) appendLog("완료", "모바일용 시간표 갱신 완료 (미리보기)");
      return Promise.resolve({ ok: true, effectiveFrom: weekKey });
    }
    return window.pywebview!.api.publish_neis_timetable_for_week(targetDate)
      .then(raw => {
        const data = parseJsonResult(raw);
        mobileTimetableSyncRef.current.add(data.effectiveFrom || weekKey);
        if (!options.silent) appendLog("완료", `모바일용 시간표 갱신 완료 · ${data.count || 0}건`);
        return data;
      })
      .catch(err => {
        mobileTimetableSyncRef.current.delete(weekKey);
        appendLog("오류", `모바일용 시간표 갱신 실패: ${formatApiError(err)}`);
        throw err;
      });
  };

  useEffect(() => {
    if (page !== "run" || !setupReady || slotLoading || slotsLoadedDate!==toIsoDate(date)) return;
    if ((settings.timetableMode || "neis") !== "neis") return;
    if (!(settings.assignedLessons || []).length) return;
    if (typeof window.__onPywebviewReady !== "function") return;
    const targetDate=toIsoDate(date);
    const timer=window.setTimeout(()=>{publishNeisTimetableForMobile(targetDate,{once:true,silent:true}).catch(()=>{});},1500);
    return()=>window.clearTimeout(timer);
  }, [page,date,setupReady,slotLoading,slotsLoadedDate,settings.timetableMode,settings.region,settings.schoolName,JSON.stringify(settings.assignedLessons || [])]);

  const saveRosters = (nextRosters = rosters) => {
    const snapshot = nextRosters;
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("완료", "학생 명부 저장됨 (미리보기)");
      setSavedRosterSignature(JSON.stringify(snapshot));
      setRosters(snapshot);
      return Promise.resolve();
    }
    return window.pywebview!.api.save_students_tsv(rostersToTsv(snapshot))
      .then(raw => {
        parseJsonResult(raw);
        appendLog("완료", "학생 명부 저장됨");
        setSavedRosterSignature(JSON.stringify(snapshot));
      setRosters(snapshot);
      })
      .catch(err => { appendLog("오류", `학생 명부 저장 실패: ${formatApiError(err)}`); throw err; });
  };

  const removeClass = async (key:string) => {
    if(window.__isPywebview?.()) {
      parseJsonResult(await window.pywebview!.api.remove_class(key));
      mobileTimetableSyncRef.current.clear();
      await loadSetupData();
    } else {
      const group=key.startsWith("mixed:")?mixedDocument.groups[key.slice(6)]:null;
      const removed=(l:any)=>group?matchesMixedGroup(group,l):`${l.grade}-${l.classNo}`===key;
      setTimetable(prev=>prev.filter(l=>!removed(l)));
      setSettings(prev=>({...prev,assignedLessons:(prev.assignedLessons||[]).filter(l=>!removed(l))}));
      setRosters(prev=>Object.fromEntries(Object.entries(prev).filter(([k])=>k!==key)));
      if(group)setMixedDocument(prev=>({...prev,groups:{...prev.groups,[group.id]:{...group,archived:true}}}));
    }
    appendLog("완료","학급과 모든 기간의 출결·명부를 삭제했습니다.");
  };

  const addClasses = async ({ grade, classNos, subject, day, period }) => {
    const assigned = [...(settings.assignedLessons || [])];
    const nextTimetable = [...timetable];
    for (const classNo of classNos) {
      if (!assigned.some(l => Number(l.grade) === grade && l.classNo === classNo && l.subjectName === subject)) assigned.push({ grade, classNo, subjectName: subject, neisSubjectLabel: subject, subjectAliases: [] });
      if ((settings.timetableMode || "neis") === "manual") {
        if (nextTimetable.some(l => l.day === day && Number(l.period) === period && Number(l.grade)===grade && l.classNo===classNo && l.subject===subject)) continue;
        if (nextTimetable.some(l => l.day === day && Number(l.period) === period)) throw new Error("해당 요일·교시에 이미 수업이 있습니다. 시간표 설정에서 확인해 주세요.");
        nextTimetable.push({ grade, classNo, subject, neis:subject, day, period });
      }
    }
    const nextSettings = { ...settings, assignedLessons: assigned };
    if (window.pywebview?.api) {
      parseJsonResult(await window.pywebview.api.save_settings(JSON.stringify(settingsToApi(nextSettings))));
      if ((settings.timetableMode || "neis") === "manual") parseJsonResult(await window.pywebview.api.save_timetable_tsv(timetableRowsToTsv(nextTimetable), settings.effectiveFrom));
    }
    setSettings(nextSettings); setTimetable(nextTimetable);
    setRosters(prev => syncRostersToTimetable(prev, nextTimetable, assigned));
    mobileTimetableSyncRef.current.clear();
    return `${grade}-${classNos[0]}`;
  };

  const startRange = async (history) => {
    if (!window.pywebview?.api) throw new Error("나이스 반영은 데스크톱 앱에서 실행해 주세요.");
    setRunning(true); setProgress({ done:0, total:0, current:"준비 중", state:"running" });
    try { parseJsonResult(await window.pywebview.api.start_range_run(history.start, history.end, password, history.token)); }
    catch (e) { setRunning(false); throw e; }
  };

  const importRosterFile = (klass) => {
    if (!klass) {
      appendLog("오류", "먼저 학급을 추가하거나 선택해 주세요");
      return Promise.resolve();
    }
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("안내", "브라우저 미리보기에서는 파일 가져오기를 사용할 수 없습니다");
      return Promise.resolve();
    }
    return window.pywebview!.api.import_students_file(klass)
      .then(raw => {
        const data = parseJsonResult(raw);
        return data;
      })
      .catch(err => { appendLog("오류", `명부 파일 가져오기 실패: ${formatApiError(err)}`); throw err; });
  };

  const saveSlotAttendance = (slotId, marks, snapshot = null as any) => {
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("완료", "attendance 저장 완료 (미리보기)");
      return Promise.resolve({ ok: true, checkedAt: new Date().toISOString() });
    }
    const slot = snapshot || slots.find(s => s.id === slotId);
    const expectedCheckedAt = slot?.checkedAt ?? "";
    return window.pywebview!.api.save_slot_attendance(toIsoDate(date), slotId, JSON.stringify(marks), expectedCheckedAt, slot?.groupId ?? null, slot?.rosterRevision ?? null)
      .then(raw => {
        const data = parseJsonResult(raw);
        appendLog("완료", "출결 저장됨");
        return refreshSlots(toIsoDate(date)).then(() => data);
      });
  };

  const deleteSlotAttendance = (slotId) => {
    if (!(window.__isPywebview && window.__isPywebview())) {
      appendLog("완료", "보강 삭제 (미리보기)");
      return Promise.resolve({ ok: true });
    }
    return window.pywebview!.api.delete_slot_attendance(toIsoDate(date), slotId)
      .then(raw => parseJsonResult(raw));
  };

  // Keep the latest refreshSlots/date for the once-registered bridge callback.
  const refreshSlotsRef = React.useRef(refreshSlots);
  refreshSlotsRef.current = refreshSlots;
  const dateRef = React.useRef(date);
  dateRef.current = date;

  /* Bridge: Python → React 로그/진행상황 수신 */
  useEffect(() => {
    if (typeof window.__registerBridge === "function") {
      window.__registerBridge(
        (entry) => setLogLines(l => [...l, { ts: now(), lv: entry.lv, msg: entry.msg }]),
        (p) => {
          setProgress({ done: p.done, total: p.total, current: p.current, state: p.state });
          if (p.state === "done" || p.state === "error") {
            setRunning(false);
            // Re-read slots so 반영됨 status reflects what was just written to NEIS.
            // (start_run clears the server cache before signalling done/error.)
            refreshSlotsRef.current(toIsoDate(dateRef.current));
          }
        }
      );
    }
  }, []);

  /* Load the selected date only after account/setup reads have finished. */
  useEffect(() => {
    if(!setupReady)return;
    if (typeof window.__onPywebviewReady !== "function") return;
    let cancelled = false;
    const dateStr = toIsoDate(date);
    window.__onPywebviewReady(() => {
      if (!cancelled) refreshSlots(dateStr);
    });
    return () => { cancelled = true; };
  }, [date,setupReady]);

  /* pywebview 환경에서 Drive 설정/시간표/명부 로드 */
  useEffect(() => {
    if (typeof window.__onPywebviewReady !== "function") return;
    window.__onPywebviewReady(() => {
      loadSetupData();
    });
  }, []);

  /* pywebview 환경에서 저장된 패스워드 로드 */
  useEffect(() => {
    if (typeof window.__onPywebviewReady !== "function") return;
    let cancelled = false;
    window.__onPywebviewReady(() => {
      window.pywebview!.api.get_password().then(pw => {
        if (!cancelled && pw) setPassword(pw);
      });

    });
    return () => { cancelled = true; };
  }, []);

  /* Apply fixed appearance globally */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = "light";
    root.dataset.density = "cozy";
    root.dataset.sidebar = sidebarCollapsed ? "collapsed" : "expanded";
    root.style.setProperty("--accent", "#0A84FF");
    root.style.setProperty("--accent-hover", "#0071e3");
    root.style.setProperty("--accent-soft", "#0A84FF22");
    root.style.setProperty("--radius-l", "18px");
  }, [sidebarCollapsed]);

  const startRun = () => {
    const pending = slots.filter(s => s.checked && !s.synced);
    if (!pending.length) { appendLog("안내", "모든 수업이 이미 반영됨"); return; }

    /* pywebview 환경이면 Python 백엔드 호출 */
    if (window.__isPywebview && window.__isPywebview()) {
      setRunning(true);
      setProgress({ done: 0, total: pending.length, current: "", state: "running" });
      appendLog("안내", `NEIS 반영 실행 — 대상 ${pending.length}건`);
      window.pywebview!.api.start_run(toIsoDate(date), password, closeAfter).then(parseJsonResult).catch(err => { setRunning(false); appendLog("오류", formatApiError(err)); });
      return;
    }

    /* 브라우저 미리보기용 mock 실행 */
    setRunning(true);
    setProgress({ done: 0, total: pending.length, current: pending[0] ? `${pending[0].grade}-${pending[0].classNo} ${pending[0].subject}` : "", state: "running" });
    appendLog("안내", `NEIS 반영 실행 — 대상 ${pending.length}건`);
    let i = 0;
    const tick = () => {
      if (i >= pending.length) {
        setRunning(false);
        setProgress(p => ({ ...p, current: "", state: "done" }));
        appendLog("완료", `실행 완료 — ${pending.length}건 반영${closeAfter ? ", 출결마감" : ""}`);
        return;
      }
      const cur = pending[i];
      setProgress({ done: i, total: pending.length, current: `${cur.grade}-${cur.classNo} ${cur.subject}`, state: "running" });
      appendLog("안내", `→ ${cur.grade}-${cur.classNo} ${cur.subject} (${cur.period}교시) 작성 중`);
      setTimeout(() => {
        setSlots(sl => sl.map(s => s.id === cur.id ? { ...s, synced: true } : s));
        appendLog("완료", `✓ ${cur.grade}-${cur.classNo} ${cur.subject} 반영됨`);
        i += 1;
        setProgress(p => ({ ...p, done: i }));
        setTimeout(tick, 260);
      }, 520);
    };
    setTimeout(tick, 300);
  };

  const pendingCount = slots.filter(s => !s.synced).length;
  const navWithBadges = NAV.map(g => ({
    ...g, items: g.items.map(it => it.key === "run" ? { ...it, badge: pendingCount ? `${pendingCount}` : null } : { ...it, badge: null as string | null })
  }));
  const sidebarName = driveUser?.displayName || driveUser?.emailAddress || "교과 담당교사";
  const sidebarInitial = sidebarName.trim().slice(0, 1) || "교";


  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-head">
          <div
            className="sb-logo"
            role={sidebarCollapsed ? "button" : undefined}
            title={sidebarCollapsed ? "메뉴 펼치기" : undefined}
            style={sidebarCollapsed ? { cursor: "pointer" } : undefined}
            onClick={sidebarCollapsed ? () => setSidebarCollapsed(false) : undefined}
          ><BrandMark size={24}/></div>
          <div className="sb-name-wrap">
            <div className="sb-name">체크온</div>
            <div className="sb-sub">교과 출결</div>
          </div>
          <button
            className="sb-collapse"
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? "메뉴 펼치기" : "메뉴 접기"}
            aria-label={sidebarCollapsed ? "메뉴 펼치기" : "메뉴 접기"}
            aria-expanded={!sidebarCollapsed}
          >
            <Icon name={sidebarCollapsed ? "panel-r" : "panel-l"} size={18}/>
          </button>
        </div>

        {navWithBadges.map(group => (
          <div key={group.group}>
            {group.group && <div className="sb-section">{group.group}</div>}
            <div className="sb-list">
              {group.items.map(it => (
                <button key={it.key}
                  className={`sb-item ${page === it.key ? "active" : ""}`}
                  onClick={() => setPage(it.key)}>
                  <span className="sb-ic"><Icon name={it.icon} size={17}/></span>
                  <span>{it.label}</span>
                  {it.badge && <span className="count">{it.badge}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button className="sb-loglink" onClick={() => setShowOnboarding(true)}>시작 가이드</button>
        <button className="sb-loglink" onClick={() => setShowPrivacy(true)}>개인정보 · 이용 안내</button>
        <button className="sb-loglink" onClick={() => setLogOpen(o => !o)}>진행 기록</button>
        <button className="sb-loglink" onClick={loadSetupData}>설정 다시 불러오기</button>

        <div className="sb-foot">
          <div className="avatar">{sidebarInitial}</div>
          <div className="sb-user-wrap">
            <div className="sb-user">{sidebarName}</div>
            <div className="sb-role">{driveUser?.emailAddress ? "연결됨" : "연결 필요"}</div>
          </div>
          <button className="sb-reconnect" disabled={reconnecting} onClick={reconnect}>
            {reconnecting ? "연결 중…" : "다시 연결"}
          </button>
        </div>
      </aside>

      <main className="main">
        {page === "run" && <RegistrationView password={password} setPassword={setPassword} running={running} progress={progress} runLog={logLines} onStart={startRange} dayView={<RunView embedded onHistory={() => setPage("history")} {...{date,setDate,password,setPassword,savePassword,closeAfter,setCloseAfter,slots,setSlots,rosters,running,progress,runLog:logLines,startRun,saveSlotAttendance,deleteSlotAttendance,appendLog,refreshSlots,publishNeisTimetableForMobile,slotLoading,slotError}}/>}/>}
        {page === "history" && <HistoryView onDelete={removeClass}/>}
        {page === "basics"    && <BasicsView settings={settings} setSettings={setSettings} driveUser={driveUser} appendLog={appendLog} loadSetupData={loadSetupData} saveSettings={saveSettings} searchSchools={searchSchools}/>}
        {page === "timetable" && <TimetableWorkspace mixedDocument={mixedDocument} onClasses={() => setPage("roster")} rows={timetable} setRows={setTimetable} settings={settings} setSettings={setSettings} appendLog={appendLog} loadSetupData={loadSetupData} saveSettings={saveSettings} saveTimetable={saveTimetable} previewNeisPublicTimetable={previewNeisPublicTimetable} findNeisSubjectCandidates={findNeisSubjectCandidates} publishNeisTimetableForMobile={publishNeisTimetableForMobile}/>}
        <div style={{display:page === "homeroom"?"flex":"none",flex:1,minHeight:0}}>{HOMEROOM_ENABLED && homeOpened && <HomeroomView api={desktopHomeApi} rosters={Object.fromEntries(Object.entries(rosters).map(([key,rows]:[string,any])=>[key,rows.map((s:any)=>({number:s.n,name:s.name}))]))} onClasses={()=>setPage("roster")}/>}</div>
        {page === "roster" && <ClassManager onDelete={removeClass} mixedDocument={mixedDocument} encryptionEnabled={mixedEncryption} onSaveMixed={saveMixedGroup} onImportMixed={importMixedStudents} onBindMixed={bindMixedGroup} rosters={rosters} onSave={saveRosters} onImport={importRosterFile} onAddClasses={addClasses} manual={settings.timetableMode === "manual"} onTimetable={() => setPage("timetable")}/>}
        {page === "connect"   && <ConnectionView driveUser={driveUser} reconnect={reconnect} reconnecting={reconnecting} loadSetupData={loadSetupData}/>}
      </main>

      {showOnboarding && (
        <OnboardingGuide
          steps={[
            { key: "connect", title: "구글 계정 연결", desc: "출결을 내 Google Drive에 저장합니다.", done: !!driveUser },
            { key: "basics", title: "학교 찾기", desc: "기본 정보에서 학교를 찾아 확정하세요.", done: !!(settings && settings.schoolCode) },
            { key: "timetable", title: "시간표 준비", desc: "학급·명단에서 담당 학급을 추가하세요.", done: (((settings && settings.assignedLessons) || []).length > 0) },
            { key: "roster", title: "학급·명단 등록", desc: "담당 반을 추가하고 명단을 채우세요.", done: Object.values(rosters || {}).some((r: any) => (r || []).length > 0) },
            { key: "run", title: "오늘 출결 실행", desc: "날짜 선택 후 NEIS에 반영합니다.", done: false },
          ]}
          onGo={(key) => { setPage(key); closeOnboarding(); }}
          onClose={closeOnboarding}
        />
      )}
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      {toast && (
        <div className={`app-toast ${toast.lv === "오류" ? "err" : "ok"}`} role="status">{toast.msg}</div>
      )}
      {logOpen && <LogDock lines={logLines} onClose={() => setLogOpen(false)} clear={clearLog}/>}
    </div>
  );
}

export default App;
