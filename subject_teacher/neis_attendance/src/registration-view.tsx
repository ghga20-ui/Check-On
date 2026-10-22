import React,{useEffect,useRef,useState} from "react";
import {RangePicker,useAttendanceRange} from "./attendance-range";
import {Icon} from "./components";
import "./management.css";
export function RegistrationView({dayView,password,setPassword,running,progress,onStart,runLog=[]}:any){
  const [mode,setMode]=useState("day");
  return <><div className="topbar"><Icon name="bolt" size={16}/><span className="title">NEIS 출결 등록</span><div className="topbar-actions"><div className="mg-segments" role="group" aria-label="등록 기간"><button aria-pressed={mode==="day"} disabled={running} onClick={()=>setMode("day")}>하루 등록</button><button aria-pressed={mode==="range"} disabled={running} onClick={()=>setMode("range")}>기간 등록</button></div></div></div>{mode==="day"?dayView:<RangeRegistration {...{password,setPassword,running,progress,onStart,runLog}}/>}</>;
}
export function RangeRegistration({password,setPassword,running,progress,onStart,runLog}:any){
  const range=useAttendanceRange(false),[confirmed,setConfirmed]=useState(false);const wasRunning=useRef(running);
  useEffect(()=>{setConfirmed(false);},[range.start,range.end,range.data]);
  useEffect(()=>{if(wasRunning.current&&!running)void range.load();wasRunning.current=running;},[running]);
  const pending=range.data?.rows.filter(r=>!r.synced)||[],dates=[...new Set(pending.map(r=>r.date))];
  return <div className="content mg-page"><header className="mg-page-head"><div><span className="mg-eyebrow">여러 날짜 한 번에</span><h1>기록한 출결을 모아 등록합니다</h1><p>선택 기간에서 아직 반영하지 않은 수업만 나이스에 입력합니다.</p></div></header><RangePicker range={range} disabled={running}/>{!range.data&&!range.busy&&!range.error&&<p className="mg-feedback">등록할 기간을 선택한 뒤 ‘조회’를 눌러 주세요.</p>}
    {range.error&&<p className="mg-feedback error" role="alert">{range.error}</p>}{range.stale&&range.data&&<p className="mg-feedback">기간을 변경했습니다. 조회를 눌러 주세요.</p>}
    {range.data&&!range.stale&&<><section className="mg-history-group"><header><div><span className="mg-label">반영 대상</span><h2>{dates.length}일의 미반영 수업</h2></div><span className="mg-muted">전체 학급 · {pending.length}개 수업</span></header>{pending.length?<div className="mg-table-wrap"><table className="mg-table"><thead><tr><th>날짜</th><th>학급</th><th>수업</th><th>출결</th></tr></thead><tbody>{pending.map(r=><tr key={`${r.date}/${r.slotId}`}><td>{r.date}</td><td>{range.data!.classes.find(c=>c.key===r.classKey)?.label}</td><td>{r.period}교시 · {r.subject}</td><td>{r.marks.length?r.marks.map(m=>`${m.student} ${m.mark==="excused"?"인정결과":"결과"}`).join(" · "):"전원 출석으로 저장"}</td></tr>)}</tbody></table></div>:<div className="mg-empty"><Icon name="check" size={24}/><h3>반영할 기록이 없습니다</h3><p>미기록 수업과 이미 반영한 수업은 제외됩니다.</p></div>}</section>
    {!!pending.length&&<section className="mg-batch-confirm"><div><h2>확인 후 등록</h2><p>{range.data.year}학년도 {range.data.term}학기 · 선택 기간이 이 학기에 속하는지 확인해 주세요.</p><p className="mg-muted">최대 93일. 마감은 하지 않으며, 날짜 전환·저장에 실패하면 이후 날짜를 중단합니다.</p></div><label className="mg-password">나이스 인증서 비밀번호<input className="mg-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} disabled={running} autoComplete="off"/></label><label className="mg-check"><input type="checkbox" checked={confirmed} disabled={running} onChange={e=>setConfirmed(e.target.checked)}/> 대상 수업과 학기를 확인했습니다.</label><button className="mg-button primary" disabled={running||range.busy||!confirmed||!password} onClick={async()=>{range.setError("");try{await onStart(range.data);}catch(e){range.setError(e instanceof Error?e.message:String(e));}}}>{running?"반영 중…":"선택 기간 나이스 반영"}</button></section>}
    {running&&<p className="mg-feedback" role="status">{progress.current} · {progress.done}/{progress.total||"준비 중"}</p>}{progress.state==="error"&&!running&&<p role="alert" className="mg-feedback error">반영 중 확인이 필요한 기록이 있습니다. 최근 실행 기록을 확인해 주세요.</p>}<details className="mg-run-log"><summary>최근 실행 기록</summary><ul>{runLog.slice(-12).map((line,i)=><li key={i}>{line.msg}</li>)}</ul></details></>}
  </div>;
}
