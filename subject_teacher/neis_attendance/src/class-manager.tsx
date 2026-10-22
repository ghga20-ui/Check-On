import React, { useMemo, useState } from "react";
import { Icon } from "./components";
import type { RosterStudent } from "./lib/transforms";
import "./management.css";

export function parseRosterPaste(text: string): RosterStudent[] {
  const rows = text.split(/\r?\n/).filter(line => line.trim());
  if (/^(번호|학번)[\t, ]/.test(rows[0] || "")) rows.shift();
  const seen = new Set<number>();
  return rows.map((line, i) => {
    const match = line.trim().match(/^(\d+)(?:[\t, ]+(.*))?$/);
    const n = Number(match?.[1]);
    if (!match || n < 1 || n > 99 || seen.has(n)) throw new Error(`${i + 1}행의 번호를 확인해 주세요. 1~99 사이의 중복 없는 번호가 필요합니다.`);
    seen.add(n);
    return { n, name: (match[2] || "").trim() };
  });
}

export function parseClassNumbers(text: string): string[] {
  const classes = new Set<string>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error("반은 1, 2, 3 또는 1-5처럼 입력해 주세요. 여러 반 학생이 함께 수강하면 학급 유형에서 혼합학급을 선택해 주세요.");
    const start = Number(match[1]), end = Number(match[2] || start);
    if (start < 1 || end > 99 || start > end) throw new Error("반 번호는 1~99 사이로 입력해 주세요.");
    for (let n = start; n <= end; n++) classes.add(String(n));
  }
  if (!classes.size) throw new Error("담당하는 반을 입력해 주세요.");
  return [...classes].sort((a, b) => Number(a) - Number(b));
}

export const ClassManager = ({ rosters, setRosters, onAddClasses, onSave, onImport, mixedPanel, manual, onTimetable, savedSignature }: any) => {
  const keys = Object.keys(rosters).sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  const [selected, setSelected] = useState("");
  const klass = keys.includes(selected) ? selected : keys[0] || "";
  const list: RosterStudent[] = rosters[klass] || [];
  const [mode, setMode] = useState("regular");
  const [adding, setAdding] = useState(false);
  const [grade, setGrade] = useState(2);
  const [classes, setClasses] = useState("");
  const [subject, setSubject] = useState("");
  const [day, setDay] = useState("월");
  const [period, setPeriod] = useState(1);
  const [count, setCount] = useState(25);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<{ classKey: string; rows: RosterStudent[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = savedSignature !== JSON.stringify(rosters);
  const subjectsCount = useMemo(() => keys.filter(k => (rosters[k] || []).length).length, [rosters]);
  const perform = async (action: () => Promise<void> | void) => {
    setError(""); setNotice(""); setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const update = (rows: RosterStudent[]) => setRosters((prev: any) => ({ ...prev, [klass]: rows }));
  const validate = () => {
    for (const key of keys) {
      const rows = rosters[key];
      const numbers = rows.map((r: RosterStudent) => r.n);
      if (numbers.some((n: number) => !Number.isInteger(n) || n < 1 || n > 99) || new Set(numbers).size !== numbers.length)
        throw new Error(`${key}의 번호를 확인해 주세요. 중복 없이 1~99까지 입력할 수 있습니다.`);
      if (rows.some((r: RosterStudent) => /[\t\r\n]/.test(r.name))) throw new Error(`${key} 이름의 줄바꿈을 제거해 주세요.`);
    }
  };
  return <>
    <div className="topbar"><Icon name="users" size={16}/><span className="title">학급·명단 관리</span>
      <div className="topbar-actions"><button className="tb-btn" onClick={onTimetable}>시간표 설정</button></div></div>
    <div className="content management">
      <div className="page-hero"><div><h1>내 학급과 학생</h1><div className="subtitle">학급을 등록한 뒤 명단을 바로 채우세요. 이름은 이 PC에만 보관됩니다.</div></div></div>
      <div className="manage-actions"><button className={`tb-btn ${mode === "regular" ? "primary" : ""}`} onClick={() => setMode("regular")}>한 반 수업</button><button className={`tb-btn ${mode === "mixed" ? "primary" : ""}`} onClick={() => setMode("mixed")}>혼합수업</button></div>
      {mode === "mixed" ? mixedPanel : <>
        <div className="manage-actions"><span>{keys.length}개 학급 · 명단 준비 {subjectsCount}개</span><button className="tb-btn primary" onClick={() => setAdding(!adding)} disabled={busy}>{adding ? "추가 접기" : "+ 학급 추가"}</button></div>
        {adding && <form className="card card-pad manage-form" onSubmit={e => { e.preventDefault(); void perform(async () => {
          const classNos = parseClassNumbers(classes);
          if (manual && classNos.length > 1) throw new Error("직접 입력 시간표는 같은 교시에 한 반만 등록해 주세요.");
          if (!subject.trim() || /[\t\r\n]/.test(subject)) throw new Error("과목명을 입력해 주세요.");
          const key = await onAddClasses({ grade, classNos, subject: subject.trim(), day, period });
          setSelected(key); setAdding(false); setNotice("학급을 저장했습니다. 아래에서 명단을 채워 주세요.");
        }); }}>
          <h2>학급과 담당 과목 등록</h2>
          <div className="manage-fields"><label>학년<select className="select" value={grade} onChange={e => setGrade(+e.target.value)}>{[1,2,3].map(n => <option key={n} value={n}>{n}학년</option>)}</select></label>
            <label>담당 반<input className="input" value={classes} onChange={e => setClasses(e.target.value)} placeholder="예: 1-5 또는 1, 3, 5"/></label>
            <label>과목명<input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="예: 문학"/></label>
            {manual && <><label>요일<select className="select" value={day} onChange={e => setDay(e.target.value)}>{["월","화","수","목","금"].map(d => <option key={d}>{d}</option>)}</select></label><label>교시<select className="select" value={period} onChange={e => setPeriod(+e.target.value)}>{[1,2,3,4,5,6,7].map(n => <option key={n}>{n}</option>)}</select></label></>}
          </div><button className="tb-btn primary" disabled={busy}>{busy ? "저장 중…" : "학급 저장하고 명단 채우기"}</button>
        </form>}
        {error && <div className="manage-error" role="alert">{error}</div>}{notice && <div className="manage-notice" role="status">{notice}</div>}
        {!keys.length ? <div className="card card-pad"><h2>첫 학급을 추가해 주세요</h2><p>같은 과목을 가르치는 여러 반을 한 번에 등록할 수 있습니다.</p><button className="tb-btn primary" onClick={() => setAdding(true)}>학급 등록 시작</button></div> :
        <div className="class-workspace">
          <nav className="class-list" aria-label="학급 선택">{keys.map(key => <button key={key} className={`class-choice ${key === klass ? "selected" : ""}`} aria-pressed={key === klass} onClick={() => { setSelected(key); setPreview(null); setPaste(""); setError(""); }} disabled={busy}><strong>{key}</strong><span>{rosters[key].length ? `${rosters[key].length}명` : "명단 필요"}</span></button>)}</nav>
          <section className="class-editor"><div className="manage-actions"><h2>{klass} 명단 · {list.length}명</h2><span>{dirty ? "저장하지 않은 변경 있음" : "저장됨"}</span><button className="tb-btn primary" disabled={busy || !dirty} onClick={() => void perform(async () => { validate(); await onSave(); setNotice("전체 학급의 명단을 저장했습니다."); })}>{busy ? "처리 중…" : "명단 저장"}</button></div>
            <div className="manage-actions"><button className="tb-btn" disabled={busy} onClick={() => void perform(async () => { const data = await onImport(klass); if (data && !data.cancelled) setPreview({ classKey: klass, rows: data.students }); })}>CSV / 엑셀 불러오기</button>
              <label>학생 수 <input className="input student-count" type="number" aria-label="학생 수" min="1" max="99" value={count} onChange={e => setCount(+e.target.value)}/></label><button className="tb-btn" disabled={busy} onClick={() => void perform(() => { if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error("학생 수는 1~99명으로 입력해 주세요."); setPreview({ classKey: klass, rows: Array.from({ length: count }, (_, i) => ({ n: i + 1, name: "" })) }); })}>번호로 채우기</button></div>
            <details className="manage-paste"><summary>엑셀에서 복사해 붙여넣기</summary><label>번호·이름 (이름 생략 가능)<textarea className="textarea" rows={4} value={paste} onChange={e => setPaste(e.target.value)} placeholder={"번호\t이름\n1\t\n2\t"}/></label><button className="tb-btn" disabled={busy || !paste.trim()} onClick={() => void perform(() => { const rows = parseRosterPaste(paste); if (!rows.length) throw new Error("학생 번호를 입력해 주세요."); setPreview({ classKey: klass, rows }); })}>미리보기</button></details>
            {preview && preview.classKey === klass && <div className="card card-pad"><h3>가져온 명단 {preview.rows.length}명</h3><p>{preview.rows.slice(0,8).map(s => `${s.n}번 ${s.name}`).join(" · ")}{preview.rows.length > 8 ? " …" : ""}</p><p>번호가 같은 학생은 이름을 갱신합니다. 새로 채우기를 선택하면 현재 {list.length}명의 명단을 교체합니다.</p><div className="manage-actions"><button className="tb-btn primary" onClick={() => { const merged = new Map(list.map(s => [s.n, s])); preview.rows.forEach(s => merged.set(s.n, s)); update([...merged.values()].sort((a,b) => a.n-b.n)); setPreview(null); }}>기존 명단에 합치기</button><button className="tb-btn" onClick={() => { update(preview.rows); setPreview(null); }}>이 명단으로 새로 채우기</button><button className="tb-btn" onClick={() => setPreview(null)}>취소</button></div></div>}
            <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>번호</th><th>이름 · PC에서만 표시</th><th>관리</th></tr></thead><tbody>{list.map((s, i) => <tr key={i}><td><input className="input" aria-label={`${i+1}행 번호`} type="number" min="1" max="99" value={s.n || ""} onChange={e => update(list.map((r, j) => i === j ? { ...r, n: +e.target.value } : r))}/></td><td><input className="input" aria-label={`${i+1}행 이름`} value={s.name} placeholder="선택 입력" onChange={e => update(list.map((r,j) => i === j ? { ...r, name: e.target.value } : r))}/></td><td><button className="tb-btn" aria-label={`${s.n}번 삭제`} onClick={() => update(list.filter((_,j) => j !== i))}>삭제</button></td></tr>)}</tbody></table></div>
            {!list.length && <p>명단을 불러오거나 학생 수만 입력해 번호를 만들어 주세요.</p>}
            <button className="tb-btn" disabled={list.length >= 99} onClick={() => { const n = Array.from({ length:99 },(_,i) => i+1).find(n => !list.some(s => s.n === n)); if (n) update([...list, { n, name:"" }]); }}>+ 학생 한 명 추가</button>
          </section>
        </div>}
      </>}
    </div>
  </>;
};
