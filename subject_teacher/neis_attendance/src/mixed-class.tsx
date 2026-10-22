import React, { useState } from "react";

export interface MixedStudent { studentId?: string; grade: number; homeClassNo: string; number: number | string; name?: string; rawStudentNumber?: string }
export interface MixedGroup { archived?: boolean; id: string; grade: number; classNo: string; subjectName: string; neisSubjectLabel: string; revision: number; students: MixedStudent[] }
export interface MixedDocument { schemaVersion: number; revision: number; groups: Record<string, MixedGroup> }
export const emptyMixedDocument: MixedDocument = { schemaVersion: 1, revision: 0, groups: {} };
const identity = (s: MixedStudent) => `${s.grade}/${Number(s.homeClassNo)}/${Number(s.number)}`;
export function validateMixedRows(rows: MixedStudent[], grade: number) {
  const keys = rows.map(identity);
  return rows.map((s, i) => s.grade !== grade ? "수업 학년과 다릅니다" : !String(s.homeClassNo).trim() || !Number.isInteger(Number(s.homeClassNo)) || Number(s.homeClassNo) < 1 ? "원소속 반을 확인하세요" : !Number.isInteger(Number(s.number)) || Number(s.number) < 1 || Number(s.number) > 99 ? "번호는 1~99로 입력해 주세요" : keys.some((key, j) => key === keys[i] && j !== i) ? "동일 학생이 중복되었습니다" : "");
}
export function mixedDiff(before: MixedStudent[], after: MixedStudent[]) {
  const old = new Map(before.map(s => [identity(s), s]));
  const next = new Set(after.map(identity));
  return { added: after.filter(s => !old.has(identity(s))).length,
    kept: after.filter(s => old.has(identity(s)) && (old.get(identity(s))?.name || "") === (s.name || "")).length,
    changed: after.filter(s => old.has(identity(s)) && (old.get(identity(s))?.name || "") !== (s.name || "")).length,
    removed: before.filter(s => !next.has(identity(s))).length };
}
export function matchesMixedGroup(group: MixedGroup, lesson: any) {
  return !group.archived && Number(lesson.grade) === group.grade && String(lesson.classNo) === group.classNo && (lesson.subjectName || lesson.subject) === group.subjectName;
}

export function MixedClassPanel({ document, encryptionEnabled, onSave, onImport, onBind, onRefresh }: {
  document: MixedDocument; encryptionEnabled: boolean; onSave: (payload: any) => Promise<any>;
  onImport: (grade: number) => Promise<{ rows?: (Omit<MixedStudent, "grade"> & { grade?: number | string })[]; cancelled?: boolean }>;
  onBind?: (group: MixedGroup) => void; onRefresh: () => Promise<any>;
}) {
  const [type, setType] = useState("single");
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const begin = (group?: MixedGroup) => {
    setType("mixed");
    setDraft({ id: group?.id, grade: group?.grade || 2, classNo: group?.classNo || "", subjectName: group?.subjectName || "", neisSubjectLabel: group?.neisSubjectLabel || "", students: group ? group.students.map(s => ({ ...s })) : [], before: group?.students || [], expectedRevision: document.revision });
    setConfirm(false); setError("");
  };
  const patch = (value: any) => { setDraft(d => ({ ...d, ...value })); setConfirm(false); };
  const errors = draft ? validateMixedRows(draft.students, draft.grade) : [];
  const diff = draft ? mixedDiff(draft.before, draft.students) : null;
  const valid = draft && draft.classNo.trim() && draft.subjectName.trim() && draft.students.length > 0 && !errors.some(Boolean);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const { before, ...payload } = draft;
      await onSave({ ...payload, classNo: payload.classNo.trim(), subjectName: payload.subjectName.trim(), students: payload.students.map(s => ({ grade: s.grade, homeClassNo: String(Number(s.homeClassNo)), number: Number(s.number), name: s.name || "" })) });
      setDraft(null); setConfirm(false);
    } catch (e: any) { setError(e.message || String(e)); } finally { setBusy(false); }
  };
  const importFile = async () => {
    setBusy(true); setError("");
    try { const result = await onImport(draft.grade); if (!result.cancelled) patch({ students: (result.rows || []).map(s => ({ ...s, grade: Number(s.grade ?? draft.grade) })) }); }
    catch (e: any) { setError(e.message || String(e)); } finally { setBusy(false); }
  };
  return <section className="card card-pad" style={{ marginBottom: 24 }} aria-label="혼합수업 설정">
    <h2>새 수업 유형</h2>
    <label><input type="radio" name="class-type" checked={type === "single"} onChange={() => setType("single")} disabled={!!draft}/> 한 반 수업</label>{" "}
    <label><input type="radio" name="class-type" checked={type === "mixed"} onChange={() => setType("mixed")} disabled={!!draft}/> 여러 반 학생이 섞인 수업</label>
    {type === "single" && <p>한 반 수업은 기존 시간표와 학생 명부에서 등록해 주세요.</p>}
    {type === "mixed" && <p>같은 학년 학생으로 명부를 만든 후, 아래 ‘수업에 연결’을 눌러 시간표 또는 담당 수업에 추가하고 저장해 주세요.</p>}
    {!encryptionEnabled && <p role="status">혼합수업 저장·모바일 동기화에는 암호화 연결이 필요합니다. 연결 화면에서 암호화를 완료하고 PC와 모바일을 모두 최신 버전으로 업데이트해 주세요.</p>}
    {type === "mixed" && !draft && <button className="tb-btn" onClick={() => begin()}>혼합수업 만들기</button>}
    <button className="tb-btn" disabled={busy || !!draft} onClick={() => { setError(""); onRefresh().catch(e => setError(e.message || String(e))); }}>혼합수업 다시 불러오기</button>
    {Object.values(document.groups).map(group => <div key={group.id} style={{ marginTop: 12 }}>
      <strong>{group.grade}학년 {group.classNo} · {group.subjectName}</strong> · {group.students.length}명
      <button className="tb-btn" disabled={!!draft} onClick={() => begin(group)}>명부 수정·가져오기</button>
      {onBind && <button className="tb-btn" disabled={!!draft} onClick={() => onBind(group)}>수업에 연결</button>}
    </div>)}
    {draft && <fieldset disabled={busy} style={{ border: 0, padding: 0, marginTop: 16 }}>
      <legend>{draft.id ? "혼합수업 명부 수정" : "새 혼합수업"}</legend>
      <label>공통 학년<select aria-label="공통 학년" className="select" disabled={!!draft.id} value={draft.grade} onChange={e => patch({ grade: +e.target.value })}>{[1,2,3].map(n => <option key={n} value={n}>{n}학년</option>)}</select></label>
      <label>수업 집단<input aria-label="수업 집단" className="input" disabled={!!draft.id} value={draft.classNo} onChange={e => patch({ classNo: e.target.value })} placeholder="예: 선택A"/></label>
      <label>과목명<input aria-label="혼합수업 과목명" className="input" disabled={!!draft.id} value={draft.subjectName} onChange={e => patch({ subjectName: e.target.value })}/></label>
      <label>수업 표시명<input aria-label="수업 표시명" className="input" disabled={!!draft.id} value={draft.neisSubjectLabel} onChange={e => patch({ neisSubjectLabel: e.target.value })} placeholder="비워두면 과목명"/></label>
      <p>이름은 PC에만 보관합니다. 합쳐진 학번은 해석 결과를 확인하고 반·번호를 수정해 주세요.</p>
      <button className="tb-btn" onClick={importFile}>CSV/XLSX 가져오기 미리보기</button>
      <button className="tb-btn" onClick={() => patch({ students: [...draft.students, { grade: draft.grade, homeClassNo: "", number: "", name: "" }] })}>학생 행 추가</button>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%" }}><thead><tr><th>원본 학번</th><th>학년</th><th>원소속 반</th><th>번호</th><th>이름 (PC)</th><th>확인</th></tr></thead><tbody>
        {draft.students.map((s, i) => <tr key={i}><td>{s.rawStudentNumber || "—"}</td>{["grade", "homeClassNo", "number", "name"].map(field => <td key={field}><input className="input" aria-label={`${i + 1}행 ${field}`} value={s[field] ?? ""} onChange={e => patch({ students: draft.students.map((row, j) => j === i ? { ...row, [field]: field === "grade" ? Number(e.target.value) : e.target.value } : row) })}/></td>)}<td><span role={errors[i] ? "alert" : undefined}>{errors[i]}</span><button className="tb-btn" onClick={() => patch({ students: draft.students.filter((_, j) => j !== i) })}>행 삭제</button></td></tr>)}
      </tbody></table></div>
      <p aria-label="명부 변경 비교">추가 {diff!.added}명 · 유지 {diff!.kept}명 · 제외 {diff!.removed}명 · 정보변경 {diff!.changed}명</p>
      <ul aria-label="학생별 변경 내역">{draft.students.map((s, i) => {
        const old = draft.before.find(row => identity(row) === identity(s));
        return <li key={i}>{s.homeClassNo || "미입력"}반 {s.number || "미입력"}번 · {old ? (old.name || "") === (s.name || "") ? "유지" : "정보변경" : "추가"}</li>;
      })}{draft.before.filter(s => !draft.students.some(row => identity(row) === identity(s))).map(s => <li key={`removed-${identity(s)}`}>{s.homeClassNo}반 {s.number}번 · 제외</li>)}</ul>
      <p>제외된 학생의 과거 출결은 보존됩니다. 반·번호 변경은 다른 학생의 추가·제외로 처리됩니다.</p>
      {confirm && <p role="status">위 변경 내용을 확인하셨으면 ‘변경 적용’을 눌러 주세요.</p>}
      <button className="tb-btn" onClick={() => { setDraft(null); setConfirm(false); setError(""); }}>취소</button>
      <button className="tb-btn primary" disabled={!valid || !encryptionEnabled} onClick={() => confirm ? save() : setConfirm(true)}>{confirm ? "변경 적용" : "변경 확인"}</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
