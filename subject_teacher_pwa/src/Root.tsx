import { mobileHomeApi } from "./lib/homeroom";
import { ACCOUNT_ISSUE, confirmLegacyAccount, resetAccountGuard } from "./lib/accountGuard";
import { clearSyncedDeviceData, loadQueue } from "./lib/db";
import { useEffect, useState } from "react";
import App from "./App";
import BrandMark from "./BrandMark";
import Login from "./Login";
import Pairing from "./Pairing";
import { AUTH_CHANGED, usesServerAuth, restoreSession, hasValidAccessToken, initAuth, isConfigured, requestAccessToken, revoke } from "./lib/auth";
import { PairingRequiredError, resetSyncKeyCache } from "./lib/drive";
import {
  loadAll,
  loadMonthlyAttendance,
  saveSlotAttendance,
  type LoadedDriveData,
} from "./lib/driveData";
import { clearDriveCache, loadDriveCache, saveDriveCache } from "./lib/localCache";
import type { StudentEntry, TimetableSlot } from "./lib/schemas";
import "./entry.css";

// 담임 출결은 별도 개발 중이라 릴리스에서는 탭을 숨긴다. 다시 열려면 true로.
const HOMEROOM_ENABLED = false;

type Phase = "init" | "signedOut" | "loading" | "ready" | "error" | "pairing";

function toLocalIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toAttendanceByDate(data: LoadedDriveData) {
  return data.attendance?.records ?? {};
}

function toRosters(data: LoadedDriveData): Record<string, StudentEntry[]> {
  return {...data.students?.classes, ...Object.fromEntries(Object.values(data.mixedGroups?.groups ?? {}).map(g => [`mixed:${g.id}`, g.students.map(s => ({...s, name: ""}))]))};
}

function toSlots(data: LoadedDriveData): TimetableSlot[] {
  return (data.timetable?.slots ?? []).map(slot => {
    const groups = Object.values(data.mixedGroups?.groups ?? {}).filter(g => !g.archived && g.grade === slot.grade && g.classNo === slot.classNo && [g.subjectName, g.neisSubjectLabel].filter(Boolean).includes(slot.subjectName));
    if (groups.length > 1) throw new Error("수업에 연결된 혼합 명부가 중복됩니다. PC에서 확인해 주세요.");
    return groups.length === 1 ? {...slot, groupId: groups[0].id} : slot;
  });
}

export default function Root() {
  const [accountIssue, setAccountIssue] = useState<"legacy" | "different" | null>(null);
  const [phase, setPhase] = useState<Phase>("init");
  const [error, setError] = useState("");
  const [data, setData] = useState<LoadedDriveData | null>(null);
  // stale=true means `data` came from the local cache and has not been
  // reconciled with Drive yet (App shows a "refresh" affordance).
  const [stale, setStale] = useState(false);
  const [connected, setConnected] = useState(hasValidAccessToken);
  const [connecting, setConnecting] = useState(false);
  const today = toLocalIsoDate();

  useEffect(() => {
    const blocked = (event: Event) => { setAccountIssue((event as CustomEvent).detail); setConnected(false); };
    window.addEventListener(ACCOUNT_ISSUE, blocked);
    return () => window.removeEventListener(ACCOUNT_ISSUE, blocked);
  }, []);

  useEffect(() => {
    if (!isConfigured()) {
      setPhase("error");
      setError("VITE_GOOGLE_CLIENT_ID 가 설정되지 않았습니다.");
      return;
    }
    let cancelled = false;
    const callback = new URLSearchParams(window.location.search).get("auth");
    if (callback) {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      if (callback !== "connected") setError("Google 연결을 완료하지 못했습니다. 다시 연결해 주세요.");
    }
    void (async () => {
      const cached = await loadDriveCache().catch(() => null);
      if (cancelled) return;
      if (cached) { setData(cached.data); setStale(true); setPhase("ready"); }
      else setPhase("signedOut");
      if (!usesServerAuth) return;
      try {
        await restoreSession();
        if (cancelled) return;
        setConnected(true);
        const month = toLocalIsoDate().slice(0, 7);
        const loaded = await loadAll(month);
        if (cancelled) return;
        setData(loaded); setStale(false); setPhase("ready");
        await saveDriveCache(loaded, month);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof PairingRequiredError) setPhase("pairing");
        else if (!(cause instanceof Error && cause.name === "AuthRequiredError")) {
          setError("인터넷 연결을 확인해 주세요. 저장된 출결은 기기에 보관됩니다.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void initAuth().catch(() => {});
    let cancelled = false;
    const check = () => setConnected(hasValidAccessToken());
    const foreground = () => {
      if (document.visibilityState !== "visible") return;
      check();
      if (usesServerAuth && navigator.onLine && !hasValidAccessToken()) {
        void restoreSession().then(() => { if (!cancelled) { setConnected(true); setError(""); } }).catch(() => {});
      }
    };
    window.addEventListener(AUTH_CHANGED, check);
    window.addEventListener("pageshow", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    const timer = window.setInterval(foreground, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(AUTH_CHANGED, check);
      window.removeEventListener("pageshow", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, []);

  // Fetch fresh Drive data, render it, and refresh the local cache. Assumes a
  // valid access token is already in memory (caller obtained it under a gesture).
  const loadFresh = async () => {
    const month = today.slice(0, 7);
    const loaded = await loadAll(month);
    setData(loaded);
    setStale(false);
    setPhase("ready");
    await saveDriveCache(loaded, month);
  };

  // First sign-in from the login screen: obtain a token, load, cache.
  const signIn = async () => {
    setError("");
    setPhase("loading");
    try {
      await initAuth();
      if (!hasValidAccessToken()) await requestAccessToken();
      setConnected(true);
      await loadFresh();
    } catch (cause) {
      if (cause instanceof PairingRequiredError) {
        setPhase("pairing");
        return;
      }
      setPhase("signedOut");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Revalidate from Drive while App stays on screen (stale banner button).
  // Runs in the user-gesture context so requestAccessToken may show its window.
  const refresh = async () => {
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      await initAuth();
      if (!hasValidAccessToken()) await requestAccessToken();
      setConnected(true);
      await loadFresh();
    } catch (cause) {
      if (cause instanceof PairingRequiredError) {
        setPhase("pairing");
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const signOut = async () => {
    try {
      if ((await loadQueue()).some(item => item.status !== "synced")) throw new Error("전송하지 못한 출결이 있습니다. 먼저 기존 계정으로 저장을 완료해 주세요.");
      await revoke();
      await clearSyncedDeviceData();
      resetAccountGuard();
      resetSyncKeyCache();
      setConnected(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연결 해제를 완료하지 못했습니다.");
      return;
    }
    await clearDriveCache();
    setAccountIssue(null);
    setData(null);
    setStale(false);
    setError("");
    setPhase("signedOut");
  };

  const accountPanel = accountIssue ? <div className="login-screen" style={{position:"fixed", inset:0, zIndex:1000}}><div className="login-card" role="alert">
      <h1>Google 계정 확인</h1>
      <p>{accountIssue === "legacy" ? "이전 버전에서 저장한 출결과 암호화 연결이 남아 있습니다. 지금 로그인한 Google 계정이 기존에 쓰던 계정인지 확인해 주세요." : "기기에 저장된 기록과 다른 Google 계정입니다. 기록을 보내지 않고 보관했습니다."}</p>
      {accountIssue === "legacy" && <button className="login-btn" onClick={() => {
        void confirmLegacyAccount().then(() => { setAccountIssue(null); return loadFresh(); }).then(() => setConnected(true))
          .catch(cause => setError(cause instanceof Error ? cause.message : "계정을 확인하지 못했습니다."));
      }}>기존에 쓰던 계정이 맞습니다</button>}
      <button className="login-btn" onClick={() => { void initAuth().then(requestAccessToken).then(loadFresh).then(() => setAccountIssue(null)).catch(() => setError("다시 연결해 주세요.")); }}>기존 Google 계정으로 다시 연결</button>
      {error && <p>{error}</p>}
    </div></div> : null;

  if (accountIssue && !(phase === "ready" && data)) return accountPanel;

  if (phase === "init") {
    return (
      <div className="splash">
        <div className="splash-mark" aria-hidden="true"><BrandMark size={38} /></div>
        <p className="brand-wordmark splash-wordmark">체크온</p>
        <p>불러오는 중…</p>
      </div>
    );
  }

  if (phase === "error") {
    return <Login onSignIn={signIn} notConfigured={!isConfigured()} error={error} />;
  }

  if (phase === "pairing") {
    return (
      <Pairing
        onPaired={() => {
          setPhase("loading");
          loadFresh().catch((cause) => {
            setPhase("signedOut");
            setError(cause instanceof Error ? cause.message : String(cause));
          });
        }}
      />
    );
  }

  if (phase === "ready" && data) {
    // Keep the mounted attendance editor and its local drafts during reconnect.
    const swrProps = { stale, onRefresh: refresh };
    return (
      <>{accountPanel}<App
      homeroomApi={HOMEROOM_ENABLED ? mobileHomeApi : undefined}
        initialDate={today}
        slots={toSlots(data)}
        rosters={toRosters(data)}
        mixedGroups={data.mixedGroups ?? undefined}
        initialAttendance={toAttendanceByDate(data)}
        initialMonth={today.slice(0, 7)}
        onSaveSlot={(date, slotId, payload, baseline) =>
          saveSlotAttendance(date.slice(0, 7), date, slotId, payload, baseline)
        }
        onLoadMonth={async (month) => (await loadMonthlyAttendance(month))?.records ?? {}}
        canSync={connected && !accountIssue}
        connecting={connecting}
        connectionError={error}
        onSignOut={signOut}
        {...swrProps}
      /></>
    );
  }

  return <Login onSignIn={signIn} busy={phase === "loading"} error={error} />;
}
