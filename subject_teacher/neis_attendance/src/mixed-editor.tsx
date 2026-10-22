import {RosterTemplateButton} from "./roster-template-button";
import React, { useState } from "react";
import {ManagementDialog,focusLastRosterInput,rosterEnter} from "./management-ui";
import {parseMixedPaste} from "./roster-paste";
import { Icon } from "./components";
import { mixedDiff, validateMixedRows, type MixedGroup, type MixedStudent } from "./mixed-class";

export function MixedRosterEditor({document,group,seed,encryptionEnabled,onSave,onImport,onBind,onCancel,onDone}:any) {
  const [draft,setDraft]=useState<any>(()=>({...seed,...group,students:(group?.students||[]).map(s=>({...s})),before:group?.students||[],expectedRevision:document.revision}));
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState(false);
  const [pasteOpen,setPasteOpen]=useState(false),[paste,setPaste]=useState("");
  const errors=validateMixedRows(draft.students,draft.grade),diff=mixedDiff(draft.before,draft.students);
  const patch=(students:MixedStudent[])=>{setDraft(d=>({...d,students}));setConfirm(false);};
  const appendStudent=()=>{const last=draft.students.at(-1);const home=last?.homeClassNo||"";const number=home?Array.from({length:99},(_,i)=>i+1).find(n=>!draft.students.some(s=>s.homeClassNo===home&&Number(s.number)===n))||"":"";patch([...draft.students,{grade:draft.grade,homeClassNo:home,number,name:""}]);focusLastRosterInput('.mixed-roster-table');};
  const save=async()=>{setBusy(true);setError("");try{
    const {before,schedule,...payload}=draft;
    const result=await onSave({...payload,students:payload.students.map(s=>({grade:Number(s.grade),homeClassNo:String(Number(s.homeClassNo)),number:Number(s.number),name:s.name||""}))});
    const saved=(Object.values(result.document.groups) as MixedGroup[]).find(g=>g.id===draft.id||(!draft.id&&g.grade===draft.grade&&g.classNo===draft.classNo&&g.subjectName===draft.subjectName));
    if(!saved)throw new Error("저장한 학급을 확인하지 못했습니다. 학급 목록을 다시 불러와 주세요.");
    setDraft({...saved,schedule,before:saved.students,expectedRevision:result.document.revision});
    if(onBind)await onBind(saved,schedule);
    onDone(saved);
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <><header className="mg-detail-head"><div><span className="mg-label">혼합학급 · {draft.subjectName}</span><h2>{draft.grade}학년 {draft.classNo}</h2></div><div className="mg-actions"><button className="mg-button" disabled={busy} onClick={onCancel}>취소</button><button className="mg-button primary" disabled={busy||!encryptionEnabled||!draft.students.length||errors.some(Boolean)} onClick={()=>confirm?void save():setConfirm(true)}>{busy?"저장 중…":confirm?"변경 적용":"명단 저장"}</button></div></header>
    <fieldset className="mg-editor-fields" disabled={busy}><div className="mg-toolbar"><button className="mg-button" onClick={async()=>{setBusy(true);setError("");try{const result=await onImport(draft.grade);if(!result.cancelled)patch((result.rows||[]).map(s=>({...s,grade:Number(s.grade??draft.grade)})));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}><Icon name="upload" size={15}/> 엑셀 가져오기</button><RosterTemplateButton mixed/><button className="mg-button" onClick={()=>{setPasteOpen(true);setError("");}}>붙여넣기</button><button className="mg-button" onClick={appendStudent}>+ 학생 추가</button><span className="mg-toolbar-note">원소속 반과 번호로 학생을 구분</span></div>
    {!encryptionEnabled&&<p className="mg-feedback" role="status">혼합학급을 저장하려면 연결 메뉴에서 암호화 연결을 완료해 주세요.</p>}
    {error&&<p className="mg-feedback error" role="alert">{error}</p>}
    {confirm&&<div className="mg-feedback" role="status">추가 {diff.added}명 · 유지 {diff.kept}명 · 제외 {diff.removed}명 · 이름 변경 {diff.changed}명. 확인 후 ‘변경 적용’을 눌러 주세요.</div>}
    <div className="mg-table-wrap"><table className="mg-table mixed-roster-table" onKeyDown={e=>rosterEnter(e,appendStudent)}><thead><tr><th>원소속 반</th><th>번호</th><th>이름 <span className="mg-muted">PC에서만 표시</span></th><th aria-label="학생 관리"/></tr></thead><tbody>{draft.students.map((s,i)=><React.Fragment key={i}><tr><td><input className="mg-input number" aria-label={`${i+1}행 원소속 반`} value={s.homeClassNo} onChange={e=>patch(draft.students.map((r,j)=>i===j?{...r,homeClassNo:e.target.value}:r))}/></td><td><input className="mg-input number" aria-label={`${i+1}행 번호`} value={s.number} onChange={e=>patch(draft.students.map((r,j)=>i===j?{...r,number:e.target.value}:r))}/></td><td><input className="mg-input" aria-label={`${i+1}행 이름`} value={s.name||""} onChange={e=>patch(draft.students.map((r,j)=>i===j?{...r,name:e.target.value}:r))}/></td><td><button className="mg-icon" aria-label={`${i+1}행 삭제`} onClick={()=>patch(draft.students.filter((_,j)=>i!==j))}><Icon name="trash" size={15}/></button></td></tr>{(errors[i]||s.rawStudentNumber)&&<tr className="mg-row-note"><td colSpan={4}>{s.rawStudentNumber&&<span>원본 학번 {s.rawStudentNumber} · </span>}{errors[i]&&<span role="alert">{errors[i]}</span>}</td></tr>}</React.Fragment>)}</tbody></table></div>
    {!draft.students.length&&<div className="mg-empty"><h3>함께 수강하는 학생을 추가해 주세요</h3><p>같은 번호여도 원소속 반이 다르면 별개의 학생으로 관리됩니다.</p></div>}
    <footer className="mg-detail-foot">Enter로 다음 칸 · 마지막 칸에서 Enter로 학생 추가. 과거 출결은 보존됩니다.</footer></fieldset>
    {pasteOpen&&<ManagementDialog title="혼합학급 명단 붙여넣기" onClose={()=>setPasteOpen(false)}><div className="mg-dialog-body"><p>엑셀에서 원소속 반 · 번호 · 이름 열을 복사해 붙여넣으세요. 이름은 생략할 수 있습니다.</p><textarea className="mg-input" rows={8} aria-label="혼합학급 붙여넣을 명단" placeholder={"반\t번호\t이름\n1\t3\t\n2\t7\t"} value={paste} onChange={e=>setPaste(e.target.value)}/>{error&&<p className="mg-feedback error" role="alert">{error}</p>}</div><footer className="mg-dialog-foot"><button className="mg-button" onClick={()=>{try{patch(parseMixedPaste(paste,draft.grade));setPasteOpen(false);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>기존 명단 교체</button><button className="mg-button primary" onClick={()=>{try{const rows=parseMixedPaste(paste,draft.grade);const combined=new Map(draft.students.filter(s=>s.homeClassNo&&s.number).map(s=>[`${s.homeClassNo}/${s.number}`,s]));rows.forEach(s=>combined.set(`${s.homeClassNo}/${s.number}`,s));patch([...combined.values()] as MixedStudent[]);setPasteOpen(false);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>기존 명단에 합치기</button></footer></ManagementDialog>}
  </>;
}
