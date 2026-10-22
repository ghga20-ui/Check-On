import React, { useEffect, useRef, useState } from "react";
import { getApi } from "./bridge";
import { parseJsonResult, todayIso } from "./lib/transforms";
import "./management.css";

type Row = { date: string; slotId: string; classKey: string; period: number | null; subject: string; synced: boolean; closed: boolean; checkedAt: string; resolvable: boolean; marks: { student: string; mark: string }[] };
type History = { start: string; end: string; classes: { key: string; label: string }[]; rows: Row[]; token: string; year: number; term: number };
export const HistoryView = ({ password, setPassword, running, progress, onStart, runLog = [] }: any) => {
  const today = todayIso();
  const [start, setStart] = useState(today.slice(0,8) + "01");
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<History | null>(null);
  const [klass, setKlass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const request = useRef(0);
  const stale = data?.start !== start || data?.end !== end;
  const load = async () => {
    const id = ++request.current;
    setBusy(true); setError(""); setConfirm(false);
    try {
      if (!start || !end || start > end) throw new Error("시작일과 종료일을 확인해 주세요.");
      const result = parseJsonResult(await (await getApi()).get_attendance_history(start, end)) as History;
      if (id === request.current) setData(result);
    } catch (e) { if (id === request.current) { setData(null); setError(e instanceof Error ? e.message : String(e)); } }
    finally { if (id === request.current) setBusy(false); }
  };
  useEffect(() => { void load(); return () => { request.current++; }; }, []);
  const wasRunning = useRef(running);
  useEffect(() => { if (wasRunning.current && !running) void load(); wasRunning.current = running; }, [running]);
  const all = data?.rows || [];
  const rows = all.filter(r => !klass || r.classKey === klass).sort((a,b) => a.date.localeCompare(b.date) || (a.period || 0)-(b.period || 0));
  const pending = all.filter(r => !r.synced);
  const days = [...new Set(pending.map(r => r.date))];
  const changePreset = (preset: string) => {
    const d = new Date(`${today}T12:00:00`);
    if (preset === "week") d.setDate(d.getDate() - ((d.getDay()+6)%7));
    if (preset === "last") { d.setDate(1); d.setMonth(d.getMonth()-1); const last = new Date(d.getFullYear(), d.getMonth()+1, 0, 12); setEnd(localIso(last)); }
    else setEnd(today);
    if (preset === "month") d.setDate(1);
    setStart(localIso(d)); setConfirm(false);
  };
  return <><div className="topbar"><span className="title">출결 내역</span><span className="sub">기간별 조회 · 여러 날짜 반영</span></div>
    <div className="content management"><div className="page-hero"><div><h1>학급별 출결 내역</h1><div className="subtitle">체크온에 저장한 수업을 모아 봅니다. 기록이 없는 날은 전원 출석으로 계산하지 않습니다.</div></div></div>
      <form className="manage-actions" onSubmit={e => { e.preventDefault(); void load(); }}><label>시작일<input className="input" type="date" value={start} disabled={running || busy} onChange={e => { setStart(e.target.value); setConfirm(false); }}/></label><label>종료일<input className="input" type="date" value={end} disabled={running || busy} onChange={e => { setEnd(e.target.value); setConfirm(false); }}/></label><button className="tb-btn primary" disabled={busy || running}>{busy ? "불러오는 중…" : "내역 조회"}</button>{[["week","이번 주"],["month","이번 달"],["last","지난달"]].map(([value,label]) => <button key={value} className="tb-btn" type="button" disabled={running || busy} onClick={() => changePreset(value)}>{label}</button>)}</form>
      {error && <p role="alert" className="manage-error">{error}</p>}
      {stale && data && <p role="status">기간을 변경했습니다. ‘내역 조회’를 눌러 주세요.</p>}
      {data && !stale && <>
        <div className="history-summary"><table className="manage-table"><caption>{data.start} ~ {data.end} · 학급을 누르면 상세 내역만 표시합니다.</caption><thead><tr><th>학급</th><th>저장 수업</th><th>결과 건</th><th>인정결과 건</th><th>미반영 수업</th></tr></thead><tbody>{data.classes.map(c => { const group = all.filter(r => r.classKey === c.key); return <tr key={c.key} className={klass === c.key ? "active-row" : ""}><td><button className="tb-btn" aria-pressed={klass === c.key} onClick={() => setKlass(klass === c.key ? "" : c.key)}>{c.label}</button></td><td>{group.length || "기록 없음"}</td><td>{group.reduce((sum,r) => sum+r.marks.filter(m => m.mark === "absent").length,0)}</td><td>{group.reduce((sum,r) => sum+r.marks.filter(m => m.mark === "excused").length,0)}</td><td>{group.filter(r => !r.synced).length}</td></tr>; })}</tbody></table></div>
        <div className="manage-actions"><h2>{klass ? data.classes.find(c => c.key === klass)?.label : "전체 학급"} 상세</h2>{klass && <button className="tb-btn" onClick={() => setKlass("")}>전체 보기</button>}<span>{rows.length}개 수업 · 결과 건수는 학생×수업 기준</span></div>
        {!rows.length ? <div className="card card-pad">이 기간에 저장된 출결이 없습니다.</div> : <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>날짜 / 교시</th><th>학급 / 과목</th><th>출결 기록</th><th>반영 상태</th></tr></thead><tbody>{rows.map(r => <tr key={`${r.date}/${r.slotId}`}><td>{r.date}<br/>{r.period ? `${r.period}교시` : "교시 확인 필요"}</td><td>{data.classes.find(c => c.key === r.classKey)?.label}<br/>{r.subject}</td><td>{r.marks.length ? r.marks.map(m => `${m.student} ${m.mark === "excused" ? "인정결과" : "결과"}`).join(" · ") : "전원 출석으로 저장"}</td><td>{r.closed ? "마감됨" : r.synced ? "반영됨" : "미반영"}{!r.resolvable && <div>학급 확인 필요</div>}</td></tr>)}</tbody></table></div>}
        <section className="card card-pad batch-section"><div className="manage-actions"><div><h2>여러 날짜 나이스 반영</h2><p>선택 기간의 <strong>전체 학급</strong> · 미반영 {pending.length}개 수업 / {days.length}일</p></div><button className="tb-btn primary" disabled={running || busy || !pending.length} onClick={() => setConfirm(true)}>반영 대상 확인</button></div>
          {confirm && <div><p>{days.join(" · ")}</p><p>기본 정보의 {data.year}학년도 {data.term}학기 화면에 입력합니다. 선택 기간이 해당 학기인지 확인해 주세요. 이미 반영한 수업은 제외하며, 마감은 실행하지 않습니다.</p><p>날짜 전환이나 저장에 실패하면 다음 날짜 진행을 중단합니다. 한 번에 최대 93일을 반영할 수 있습니다.</p><label>나이스 인증서 비밀번호<input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off"/></label><div className="manage-actions"><button className="tb-btn primary" disabled={running || !password} onClick={async () => { setError(""); setConfirm(false); try { await onStart(data); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>확인한 기간 반영 시작</button><button className="tb-btn" onClick={() => setConfirm(false)}>취소</button></div></div>}
          {running && <p role="status">{progress.current} 처리 중 · {progress.done}/{progress.total || "준비 중"}</p>}
          {progress.state === "error" && !running && <p role="alert" className="manage-error">반영 중 확인이 필요한 항목이 있습니다. 아래 실행 기록과 미반영 내역을 확인해 주세요.</p>}
          {runLog.length > 0 && <details><summary>최근 실행 기록</summary><ul>{runLog.slice(-12).map((line,i) => <li key={i}>{line.msg}</li>)}</ul></details>}
        </section>
      </>}
    </div></>;
};
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
