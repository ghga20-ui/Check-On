import React,{useState} from 'react';
import {Icon} from './components';
import {normalizeSubjectName,todayIso} from './lib/transforms';
import './management.css';

export function lessonCatalog(settings:any,rows:any[]):any[]{
  if(settings.timetableMode!=="manual") return settings.assignedLessons||[];
  const items=[...rows.map(r=>({grade:r.grade,classNo:r.classNo,subjectName:r.subject,neisSubjectLabel:r.neis||r.subject})),...(settings.assignedLessons||[])];
  return [...new Map(items.filter(l=>l.subjectName&&l.classNo).map(l=>[`${l.grade}/${l.classNo}/${l.subjectName}`,l])).values()];
}
const identity=(l:any)=>`${l.grade}/${l.classNo}/${l.subjectName||l.subject}`;
export function TimetableWorkspace({rows,setRows,settings,setSettings,onClasses,saveSettings,saveTimetable,previewNeisPublicTimetable,findNeisSubjectCandidates,publishNeisTimetableForMobile,mixedDocument={groups:{}}}:any){
  const catalog=lessonCatalog(settings,rows),automatic=settings.timetableMode!=='manual';
  const [date,setDate]=useState(todayIso()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [preview,setPreview]=useState<any[]|null>(null),[candidates,setCandidates]=useState<any>({});
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const update=(i:number,patch:any)=>setRows(rows.map((r,j)=>i===j?{...r,...patch}:r));
  const setMode=(mode:string)=>{setSettings({...settings,timetableMode:mode,assignedLessons:catalog});setPreview(null);setNotice('조회 방식은 저장 후 적용됩니다.');};
  const load=()=>run(async()=>{
    const found:any[]=[];
    const classes=[...new Map(catalog.map(l=>[`${l.grade}/${l.classNo}`,l])).values()];
    for(const l of classes){
      const result=await previewNeisPublicTimetable({date,grade:l.grade,classNo:l.classNo});
      for(const row of result.lessons||[]){
        if(catalog.some(c=>Number(c.grade)===Number(row.grade)&&String(c.classNo)===String(row.classNo)&&[c.subjectName,c.neisSubjectLabel,...(c.subjectAliases||[])].filter(Boolean).some(s=>normalizeSubjectName(s)===normalizeSubjectName(row.subject))))found.push(row);
      }
    }
    setPreview(found.sort((a,b)=>a.period-b.period));
  });
  return <><div className="topbar"><Icon name="board" size={16}/><span className="title">시간표</span></div><div className="content mg-page">
    <header className="mg-page-head"><div><span className="mg-eyebrow">수업 일정 확인</span><h1>등록한 수업은 언제 하나요?</h1><p>학급은 ‘학급·명단’에서 한 번만 등록합니다. 이곳에서는 수업 시간과 모바일 시간표를 관리합니다.</p></div><button className="mg-button" disabled={busy} onClick={onClasses}>학급·명단 관리</button></header>
    <fieldset className="mg-editor-fields" disabled={busy}><div className="mg-toolbar"><div className="mg-segments" role="group" aria-label="시간표 방식"><button aria-pressed={automatic} onClick={()=>setMode('neis')}>학교 시간표 자동 조회</button><button aria-pressed={!automatic} onClick={()=>setMode('manual')}>요일·교시 직접 배치</button></div><button className="mg-button primary" onClick={()=>void run(async()=>{if(!automatic&&new Set(rows.map(r=>`${r.day}/${r.period}`)).size!==rows.length)throw new Error('같은 요일·교시에 두 수업이 있습니다. 배치를 확인해 주세요.');await saveSettings('시간표 방식·수업 연결 저장됨',{...settings,assignedLessons:catalog});if(!automatic)await saveTimetable();setNotice('시간표 설정을 저장했습니다.');})}>설정 저장</button></div>
    {error&&<p role="alert" className="mg-feedback error">{error}</p>}{notice&&<p role="status" className="mg-feedback">{notice}</p>}
    {!catalog.length?<div className="mg-empty"><h2>먼저 담당 학급을 등록해 주세요</h2><button className="mg-button primary" onClick={onClasses}>학급·명단으로 이동</button></div>:automatic?<>
      <section className="mg-history-group"><header><h2>자동으로 연결된 담당 수업</h2></header><p className="mg-timetable-help">학급·명단에서 등록한 학급과 과목입니다. 나이스의 과목 표기가 다를 때만 연결 과목을 확인하세요.</p><table className="mg-table"><thead><tr><th>학급</th><th>등록한 과목</th><th>나이스 연결 과목</th><th/></tr></thead><tbody>{catalog.map(l=><React.Fragment key={identity(l)}><tr><td>{l.grade}학년 {l.classNo}</td><td>{l.subjectName}</td><td>{l.neisSubjectLabel||l.subjectName}</td><td><button className="mg-button" disabled={Object.values(mixedDocument.groups).some((g:any)=>g.grade===Number(l.grade)&&g.classNo===l.classNo&&g.subjectName===l.subjectName)} title="혼합학급은 등록한 과목명으로 연결됩니다" onClick={()=>void run(async()=>{const result=await findNeisSubjectCandidates({date,grade:l.grade,classNo:l.classNo,subjectName:l.subjectName});setCandidates(c=>({...c,[identity(l)]:result.candidates||[]}));})}>연결 과목 확인</button></td></tr>{candidates[identity(l)]&&<tr><td colSpan={4}>{candidates[identity(l)].length?candidates[identity(l)].map(c=><button key={c.subject} className="mg-button" onClick={()=>{setSettings({...settings,assignedLessons:catalog.map(item=>identity(item)===identity(l)?{...item,neisSubjectLabel:c.subject,subjectAliases:[...new Set([...(item.subjectAliases||[]),c.subject])]}:item)});setCandidates({});setNotice('연결 과목을 변경했습니다. 설정 저장을 눌러 주세요.');}}>{c.subject}</button>):'조회 기간에 해당 과목을 찾지 못했습니다.'}</td></tr>}</React.Fragment>)}</tbody></table></section>
      <section className="mg-history-group"><header><h2>날짜별 수업 확인</h2><div className="mg-actions"><input className="mg-input" aria-label="시간표 조회 날짜" type="date" value={date} onChange={e=>{setDate(e.target.value);setPreview(null);}}/><button className="mg-button" disabled={!date} onClick={()=>void load()}>시간표 확인</button></div></header>{preview===null?<p className="mg-timetable-help">날짜를 선택하면 해당 날짜의 담당 수업만 표시합니다.</p>:preview.length?<table className="mg-table"><thead><tr><th>교시</th><th>학급</th><th>과목</th></tr></thead><tbody>{preview.map((r,i)=><tr key={i}><td>{r.period}교시</td><td>{r.grade}학년 {r.classNo}</td><td>{r.subject}</td></tr>)}</tbody></table>:<p className="mg-timetable-help">이 날짜에는 조회된 담당 수업이 없습니다. 휴업일 또는 과목 연결을 확인해 주세요.</p>}</section>
      <div className="mg-toolbar"><button className="mg-button primary" disabled={!date} onClick={()=>void run(async()=>{await saveSettings('시간표 설정 저장됨',{...settings,assignedLessons:catalog});await publishNeisTimetableForMobile(date,{force:true});setNotice('선택한 날짜가 속한 주의 시간표를 모바일에 전달했습니다.');})}>이 주 시간표 모바일에 보내기</button><span className="mg-toolbar-note">출결 등록 화면을 열 때도 해당 주 시간표를 자동 갱신합니다.</span></div>
    </>:<section className="mg-history-group"><header><h2>요일·교시 배치</h2><button className="mg-button" onClick={()=>{const l=catalog[0];setRows([...rows,{day:'월',period:1,grade:l.grade,classNo:l.classNo,subject:l.subjectName,neis:l.neisSubjectLabel||l.subjectName}]);}}>기존 수업 배치 추가</button></header><table className="mg-table"><thead><tr><th>요일</th><th>교시</th><th>등록한 수업</th><th/></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td><select className="mg-input" aria-label={`${i+1}행 요일`} value={r.day} onChange={e=>update(i,{day:e.target.value})}>{['월','화','수','목','금'].map(d=><option key={d}>{d}</option>)}</select></td><td><select className="mg-input" aria-label={`${i+1}행 교시`} value={r.period} onChange={e=>update(i,{period:+e.target.value})}>{[1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n}교시</option>)}</select></td><td><select className="mg-input" aria-label={`${i+1}행 수업`} value={identity(r)} onChange={e=>{const l=catalog.find(l=>identity(l)===e.target.value);if(l)update(i,{grade:l.grade,classNo:l.classNo,subject:l.subjectName,neis:l.neisSubjectLabel||l.subjectName});}}>{catalog.map(l=><option key={identity(l)} value={identity(l)}>{l.grade}학년 {l.classNo} · {l.subjectName}</option>)}</select></td><td><button className="mg-icon" aria-label={`${i+1}행 배치 삭제`} onClick={()=>{setSettings({...settings,assignedLessons:catalog});setRows(rows.filter((_,j)=>j!==i));}}><Icon name="trash" size={16}/></button></td></tr>)}</tbody></table><p className="mg-timetable-help">새 학급을 만드는 기능이 아닙니다. 등록한 수업을 선택해 수업 시간만 지정합니다.</p></section>}
    </fieldset></div></>;
}
