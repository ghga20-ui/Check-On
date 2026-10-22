import React from "react";
import { Icon, Chip, StatusChip, Checkbox, Ring, Bar, Banner, EmptyState, Toggle, Segmented } from "./components";
import { TODAY_SLOTS, ROSTERS } from "./data";
const { useState, useEffect, useMemo } = React;

const formatSavedAt = (isoDate) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `마지막 저장 ${hh}:${mm}`;
};

const summarizeMarks = (marks, students: any[] = []) => {
  const items = Object.entries(marks || {})
    .filter(([, mark]) => mark && mark !== "present")
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([number, mark]) => {
      const student = students.find(s => String(s.n) === number);
      const label = student?.homeClassNo ? `${student.homeClassNo}반 ${student.number}번` : `${number}번`;
      return `${label} ${mark === "excused" ? "인정결과" : "결과"}`;
    });
  return items.length ? items.join(", ") : "저장하면 전원 출석";
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return todayIso();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const formatDateHeading = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "날짜 선택";
  const day = ["일","월","화","수","목","금","토"][d.getDay()];
  if (isoDate === todayIso()) return `오늘, ${day}요일`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일, ${day}요일`;
};

const formatDateSubtext = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/* Attendance mark config */
const MARK_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: "present", label: "출석",    color: "var(--green)" },
  { value: "absent",  label: "결과",    color: "var(--red)" },
  { value: "excused", label: "인정결과", color: "var(--orange)" },
];

/* Student-check sheet (modal) */
export const ClassSheet = ({ slot, rosters, onClose, onSaveMarks, currentMarks, appendLog }) => {
  const students = slot.groupId ? (slot.mixedStudents || []).map(s => ({ ...s, n: s.studentId })).sort((a, b) => Number(a.homeClassNo) - Number(b.homeClassNo) || a.number - b.number) : rosters[slot.roster] || ROSTERS[slot.roster] || [];
  const [marks, setMarks] = useState<any>(() => ({ ...currentMarks }));
  const [filter, setFilter] = useState<any>("all");
  const [saving, setSaving] = useState<any>(false);
  const [saveError, setSaveError] = useState<any>("");

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, excused: 0, unset: 0 };
    students.forEach(s => {
      const m = marks[s.n] || "present";
      c[m] = (c[m] || 0) + 1;
    });
    return c;
  }, [marks, students]);

  const setAll = (m) => {
    const next = {};
    students.forEach(s => next[s.n] = m);
    setMarks(next);
  };

  const setMark = (n, value) => {
    setMarks(m => ({ ...m, [n]: value }));
  };

  const save = () => {
    setSaving(true);
    setSaveError("");
    Promise.resolve(onSaveMarks(slot.id, marks, counts, slot))
      .then(() => {
        appendLog("완료", `${slot.grade}-${slot.classNo} ${slot.subject} 저장됨 (결과 ${counts.absent}, 인정결과 ${counts.excused})`);
        onClose();
      })
      .catch(err => {
        const message = err.message || String(err);
        setSaveError(message);
        appendLog("오류", `출결 저장 실패: ${message}`);
      })
      .finally(() => setSaving(false));
  };

  const filtered = filter === "all" ? students : students.filter(s => (marks[s.n] || "present") === filter);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <div>
            <div className="st-t">{slot.period}교시 · {slot.subject}</div>
            <div className="st-s">{slot.grade}학년 {slot.classNo}반 · {slot.room} · {slot.time}</div>
          </div>
          <button className="tb-iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="sheet-body">
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
            <Chip kind="info">총 {students.length}명</Chip>
            <Chip kind="ok">출석 {counts.present}</Chip>
            <Chip kind="bad">결과 {counts.absent}</Chip>
            <Chip kind="warn">인정결과 {counts.excused}</Chip>
            <div style={{flex:1}}/>
            <button className="tb-btn ghost" onClick={() => setAll("present")}>
              <Icon name="check" size={14}/> 전원 출석
            </button>
          </div>

          <div className="mark-legend">
            {[
              ["all",     "전체",    "var(--fg-3)"],
              ["present", "출석",    "var(--green)"],
              ["absent",  "결과",    "var(--red)"],
              ["excused", "인정결과", "var(--orange)"],
            ].map(([v, l, c]) => (
              <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>
                <span className="dot" style={{background: c}}/>{l}
              </button>
            ))}
          </div>

          <div className="save-summary-box">
            <strong>저장 전 요약</strong>
            <span>{summarizeMarks(marks, students)}</span>
          </div>
          {saveError && (
            <div className="save-summary-box error">
              <strong>저장 실패</strong>
              <span>{saveError}</span>
            </div>
          )}

          <div className="stu-grid">
            {filtered.map(s => {
              const m = marks[s.n] || "present";
              return (
                <div key={s.n} className="stu-row" data-mark={m} style={{cursor:"default", ...(slot.groupId ? { gridTemplateColumns: "72px 1fr auto" } : {})}}>
                  <span className="n">{slot.groupId ? `${s.homeClassNo}반 ${s.number}번` : s.n}</span>
                  <span className="nm">{s.name}</span>
                  <div style={{display:"flex",gap:4,alignItems:"center"}}>
                    {MARK_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setMark(s.n, opt.value)}
                        style={{
                          border: m === opt.value ? `2px solid ${opt.color}` : "1.5px solid var(--sep)",
                          background: m === opt.value ? `color-mix(in srgb, ${opt.color} 15%, var(--bg))` : "var(--bg)",
                          color: m === opt.value ? opt.color : "var(--fg-3)",
                          borderRadius: 8,
                          padding: "3px 8px",
                          fontSize: 12,
                          fontWeight: m === opt.value ? 700 : 500,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          transition: "all .12s",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: opt.color,
                          display: "inline-block",
                          opacity: m === opt.value ? 1 : 0.4,
                        }}/>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{fontSize:12,color:"var(--fg-3)",marginTop:14}}>각 학생의 출석/결과/인정결과를 눌러 정하세요.</p>
        </div>
        <div className="sheet-foot">
          <button className="tb-btn" onClick={onClose} disabled={saving}>취소</button>
          <button className="tb-btn primary" onClick={save} disabled={saving || (slot.groupId && !students.length)}>
            <Icon name={saving ? "clock" : "check"} size={14}/> {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const RunView = ({ date, setDate, password, setPassword, savePassword, closeAfter, setCloseAfter,
                   slots, setSlots, rosters, running, progress, runLog, startRun, saveSlotAttendance, deleteSlotAttendance, appendLog, refreshSlots, publishNeisTimetableForMobile, slotLoading, slotError, onHistory = () => {}, embedded = false }) => {
  const [openSlot, setOpenSlot] = useState<any>(null);
  const [marksById, setMarksById] = useState<any>({});
  const [boganOpen, setBoganOpen] = useState<any>(false);
  const [bgSaving, setBgSaving] = useState<any>(false);
  const [editingId, setEditingId] = useState<any>(null);
  const [bg, setBg] = useState<any>({ grade: 2, classNo: "", period: 1, subject: "", absent: "", excused: "" });

  const parseNums = (text) => String(text || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
    .map(Number).filter(n => Number.isInteger(n) && n > 0);
  const marksToNums = (marks, type) => Object.entries(marks || {}).filter(([, m]) => m === type).map(([n]) => n).join(", ");

  const resetBg = () => setBg({ grade: 2, classNo: "", period: 1, subject: "", absent: "", excused: "" });
  const closeBogan = () => { setBoganOpen(false); setEditingId(null); resetBg(); };
  const openBoganAdd = () => { setEditingId(null); resetBg(); setBoganOpen(true); };
  const openBoganEdit = (slot) => {
    setBg({
      grade: slot.grade || 2,
      classNo: String(slot.classNo || ""),
      period: slot.period || 1,
      subject: slot.subject || "",
      absent: marksToNums(slot.marks, "absent"),
      excused: marksToNums(slot.marks, "excused"),
    });
    setEditingId(slot.id);
    setBoganOpen(true);
  };

  const saveBogan = () => {
    const classNo = String(bg.classNo).trim();
    if (!classNo) { appendLog && appendLog("오류", "반을 입력해 주세요"); return; }
    const subj = String(bg.subject || "").replace(/[\s-]/g, "") || "subject";
    const id = `neis-${bg.grade}-${classNo}-${bg.period}-${subj}`;
    const prevId = editingId;
    const marks: any = {};
    parseNums(bg.absent).forEach(n => { marks[n] = "absent"; });
    parseNums(bg.excused).forEach(n => { marks[n] = "excused"; });
    const absCount = Object.keys(marks).length;
    setBgSaving(true);
    const cleanup = (prevId && prevId !== id && deleteSlotAttendance)
      ? Promise.resolve(deleteSlotAttendance(prevId)) : Promise.resolve();
    cleanup.then(() => saveSlotAttendance(id, marks)).then((saved) => {
      const checkedAt = saved?.checkedAt || new Date().toISOString();
      const newSlot = {
        id, period: bg.period, grade: bg.grade, classNo, subject: bg.subject || "",
        room: `${bg.grade}-${classNo}`, time: `${bg.period}교시`, checked: true, absences: absCount,
        synced: false, closed: false, checkedAt, marks,
        note: absCount ? `결과·인정결과 ${absCount}명` : "전원 출석", adhoc: true,
      };
      setSlots(prev => [...prev.filter(s => s.id !== id && s.id !== prevId), newSlot].sort((a, b) => (a.period || 0) - (b.period || 0)));
      appendLog && appendLog("완료", `${prevId ? "보강 수정" : "보강 추가"}: ${bg.grade}-${classNo} ${bg.period}교시`);
      closeBogan();
    }).catch(err => appendLog && appendLog("오류", `보강 저장 실패: ${err?.message || err}`))
      .finally(() => setBgSaving(false));
  };

  const deleteBogan = () => {
    if (!editingId) return;
    const id = editingId;
    setBgSaving(true);
    Promise.resolve(deleteSlotAttendance ? deleteSlotAttendance(id) : null).then(() => {
      setSlots(prev => prev.filter(s => s.id !== id));
      appendLog && appendLog("완료", "보강 삭제됨");
      closeBogan();
    }).catch(err => appendLog && appendLog("오류", `보강 삭제 실패: ${err?.message || err}`))
      .finally(() => setBgSaving(false));
  };

  const total = slots.length;
  const checked = slots.filter(s => s.checked).length;
  const synced = slots.filter(s => s.synced).length;
  const pending = slots.filter(s => s.checked && !s.synced).length;
  const absent = slots.reduce((a, s) => a + (s.absences || 0), 0);

  const onSaveMarks = (id, marks, counts, snapshot) => {
    const absCount = counts ? counts.absent + counts.excused : Object.values(marks).filter(v => v && v !== "present").length;
    return Promise.resolve(saveSlotAttendance(id, marks, snapshot)).then((saved) => {
      const checkedAt = saved?.checkedAt || new Date().toISOString();
      setMarksById(m => ({ ...m, [id]: marks }));
      setSlots(prev => prev.map(s => s.id === id ? { ...s, checked: true, absences: absCount, checkedAt, marks, note: absCount ? `결과·인정결과 ${absCount}명` : "전원 출석" } : s));
    });
  };

  return (
    <>
      <div className={embedded ? "mg-day-toolbar" : "topbar"}>
        <Icon name="bolt" size={16}/>
        {!embedded && <span className="title">NEIS 출결 등록</span>}
        <span className="sub">· 선택한 날짜의 수업을 확인하고 NEIS에 반영합니다</span>
        <div className="topbar-actions">
          <button className="tb-btn" onClick={onHistory}>출결 내역</button>
          <button className="tb-btn" onClick={openBoganAdd}>
            <Icon name="plus" size={14}/> 보강 추가
          </button>
          <button className="tb-btn" onClick={() => {
            if (refreshSlots) refreshSlots(date, { force: true });
          }} disabled={slotLoading}>
            <Icon name={slotLoading ? "clock" : "refresh"} size={14}/> {slotLoading ? "불러오는 중" : "새로고침"}
          </button>
        </div>
      </div>

      <div className="content run-content">
        <div className="page-hero">
          <div>
            <h1>{formatDateHeading(date)}</h1>
            <div className="subtitle">{date} · 확인한 출결을 NEIS에 그대로 반영합니다.</div>
          </div>
          <div className="hero-actions date-actions">
            <button className="tb-btn" onClick={() => setDate(addDays(date, -1))}><Icon name="chev-l" size={14}/> 이전날</button>
            <button className="tb-btn" onClick={() => setDate(todayIso())}><Icon name="calendar" size={14}/> 오늘</button>
            <button className="tb-btn" onClick={() => setDate(addDays(date, 1))}>다음날 <Icon name="chev-r" size={14}/></button>
            <div className="field date-field">
              <label>날짜 선택</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value || todayIso())} />
            </div>
            <div className="field" style={{width:200}}>
              <label>NEIS 인증서 비밀번호</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} onBlur={() => savePassword && savePassword(password)} placeholder="••••••••"/>
            </div>
          </div>
        </div>

        {(running || progress.state === "done") && (
          <div className="inline-progress">
            <div className="ip-row">
              <strong>
                {running ? "반영 중…" : "마지막 실행 완료"}
              </strong>
              {progress.current && <span className="ip-cur">· {progress.current}</span>}
              <span className="ip-count">{progress.done}/{progress.total} ({Math.round(progress.done/Math.max(progress.total,1)*100)}%)</span>
            </div>
            <Bar pct={progress.total ? progress.done/progress.total*100 : 0} ok={progress.state==="done"}/>
          </div>
        )}

        {pending > 0 && !running && (
          <Banner kind="info" icon="info" title={`${pending}건의 수업이 아직 NEIS에 반영되지 않았습니다`}>
            하단의 NEIS 반영 실행 버튼으로 한 번에 처리할 수 있어요.
          </Banner>
        )}

        {slotLoading && (
          <Banner kind="info" icon="clock" title="수업을 불러오는 중입니다">
            Google Drive 출결 기록과 NEIS 공개 API 시간표를 확인하고 있습니다.
          </Banner>
        )}

        {slotError && !slotLoading && (
          <Banner kind="error" icon="info" title="수업을 불러오지 못했습니다">
            {slotError}
          </Banner>
        )}

        <div className="stat-grid" style={{marginTop:16}}>
          <div className="stat-card accent">
            <div className="label"><span className="dot"/>해당 날짜 수업</div>
            <div className="value">{total}<span className="unit">건</span></div>
            <div className="note">{formatDateSubtext(date)} · 확인함 {checked} / 미확인 {total - checked}</div>
          </div>
          <div className="stat-card">
            <div className="label"><span className="dot" style={{background:"var(--orange)"}}/>NEIS 반영</div>
            <div className="value">{synced}<span className="unit">/ {total}</span></div>
            <div className="note warn">{pending > 0 ? `미반영 ${pending}건` : "모두 반영됨"}</div>
          </div>
          <div className="stat-card">
            <div className="label"><span className="dot" style={{background:"var(--red)"}}/>결과·인정결과</div>
            <div className="value">{absent}<span className="unit">명</span></div>
            <div className="note">해당 날짜 기준 누계</div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <div>
              <h2>해당 날짜 수업</h2>
              <div className="desc">카드를 누르면 학생별 출결을 확인하고 바로 수정할 수 있어요.</div>
            </div>
          </div>

          <div className="list-group">
            <div className="list-header" style={{gridTemplateColumns:"80px 1.6fr 80px 80px 130px 1fr auto"}}>
              <div>교시</div>
              <div>과목</div>
              <div>학년</div>
              <div>반</div>
              <div>출결 확인</div>
              <div>상태</div>
              <div></div>
            </div>
            {slotLoading ? (
              <EmptyState icon="clock" title="수업을 불러오는 중입니다"
                body="Drive 출결 기록과 NEIS 시간표를 확인하고 있습니다." />
            ) : slots.length === 0 ? (
              <EmptyState icon="calendar" title="해당 날짜에 표시할 수업이 없습니다"
                body="시간표 탭의 담당 수업, 과목명, 학년·반 또는 선택 날짜를 확인하세요." />
            ) : slots.map(s => (
              <div key={s.id} className="list-row" style={{gridTemplateColumns:"80px 1.6fr 80px 80px 130px 1fr auto"}}
                   onClick={() => s.adhoc && !s.groupId ? openBoganEdit(s) : setOpenSlot(s)}>
                <div className="period">
                  <span className="p-num">{s.period}</span>
                </div>
                <div className="subject">
                  {s.subject}{s.adhoc && <span className="bogang-tag">보강</span>}
                  <div className="sub2">{s.room} · {s.time}</div>
                </div>
                <div className="klass">{s.grade}</div>
                <div className="klass">{s.classNo}</div>
                <div>
                  {s.checked
                    ? <>
                        <Chip kind="ok"><Icon name="check" size={11}/> 확인함 · {s.absences}명</Chip>
                        {s.checkedAt && <div className="sub2">{formatSavedAt(s.checkedAt)}</div>}
                      </>
                    : <Chip kind="gray">미확인</Chip>}
                </div>
                <div className="status-stack">
                  <StatusChip item={s}/>
                </div>
                <div className="chev"><Icon name="chev-r" size={16}/></div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {openSlot && (
        <ClassSheet
          slot={openSlot}
          rosters={rosters}
          onClose={() => setOpenSlot(null)}
          currentMarks={openSlot.marks || {}}
          onSaveMarks={onSaveMarks}
          appendLog={appendLog}
        />
      )}

      {boganOpen && (
        <div className="ob-overlay" role="dialog" aria-modal="true" aria-label="보강 수업 추가">
          <div className="ob-card">
            <div className="ob-head">
              <div className="ob-head-text">
                <h2>{editingId ? "보강 수업 수정" : "보강 수업 추가"}</h2>
                <div className="ob-sub">오늘({date})만 처리할 임시 수업입니다. 담당 수업·시간표는 바뀌지 않아요. NEIS에 보강이 등록돼 있어야 반영됩니다.</div>
              </div>
              <button className="ob-x" onClick={closeBogan} aria-label="닫기"><Icon name="x" size={18}/></button>
            </div>
            <div className="bogang-form">
              <div className="field">
                <label>학년</label>
                <select className="select" value={bg.grade} onChange={e => setBg({ ...bg, grade: +e.target.value })}>
                  {[1, 2, 3].map(n => <option key={n} value={n}>{n}학년</option>)}
                </select>
              </div>
              <div className="field">
                <label>반</label>
                <input className="input" value={bg.classNo} onChange={e => setBg({ ...bg, classNo: e.target.value })} placeholder="예: 5"/>
              </div>
              <div className="field">
                <label>교시</label>
                <select className="select" value={bg.period} onChange={e => setBg({ ...bg, period: +e.target.value })}>
                  {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}교시</option>)}
                </select>
              </div>
              <div className="field">
                <label>과목 (선택)</label>
                <input className="input" value={bg.subject} onChange={e => setBg({ ...bg, subject: e.target.value })} placeholder="비워도 됨"/>
              </div>
              <div className="field full">
                <label>결과(/) 학생 번호</label>
                <input className="input" value={bg.absent} onChange={e => setBg({ ...bg, absent: e.target.value })} placeholder="예: 3, 15 (없으면 비움 = 전원 출석)"/>
              </div>
              <div className="field full">
                <label>인정결과(Ø) 학생 번호</label>
                <input className="input" value={bg.excused} onChange={e => setBg({ ...bg, excused: e.target.value })} placeholder="예: 7"/>
              </div>
            </div>
            <div className="ob-actions">
              {editingId && (
                <button className="tb-btn bogan-delete" onClick={deleteBogan} disabled={bgSaving} style={{marginRight:"auto"}}>
                  <Icon name="trash" size={14}/> 삭제
                </button>
              )}
              <button className="tb-btn" onClick={closeBogan}>취소</button>
              <button className="tb-btn primary" onClick={saveBogan} disabled={!String(bg.classNo).trim() || bgSaving}>
                {bgSaving ? "저장 중…" : (editingId ? "저장" : "추가")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="run-action-bar">
        <span className="run-action-bar-status">
          {pending > 0
            ? <><span className="run-action-bar-badge">{pending}</span> 반영 대기 {pending}건</>
            : <><Icon name="check" size={14}/> 모두 반영됨</>}
        </span>
        <Checkbox checked={closeAfter} onChange={setCloseAfter} label="출결 마감까지"/>
        <button className="run-cta run-cta-lg" onClick={startRun} disabled={running || pending === 0}>
          {running
            ? <><Icon name="clock" size={16}/> 반영 중… {progress.done}/{progress.total}</>
            : pending === 0
              ? <><Icon name="check" size={14}/> 모두 반영됨</>
              : <><Icon name="play" size={14}/> NEIS 반영 실행 · {pending}건</>}
        </button>
      </div>
    </>
  );
};
