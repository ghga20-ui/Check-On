import React,{useState} from 'react';
import {categories,kinds,sessions,type HomeEvent} from './homeroom-model';

type Props={roster:{number:number;name?:string}[];label:(n:number)=>string;chosen:number[];setChosen:(n:number[])=>void;editId:string|null;busy:boolean;kind:HomeEvent['kind'];setKind:(v:HomeEvent['kind'])=>void;category:HomeEvent['category'];setCategory:(v:HomeEvent['category'])=>void;period:string;setPeriod:(v:string)=>void;lastPeriod:string;setLastPeriod:(v:string)=>void;reason:string;setReason:(s:string)=>void;reasonId:string;onCancel:()=>void;onSubmit:()=>void;error:string};

export function HomeroomEditor(p:Props){
 const [showStudents,setShowStudents]=useState(p.chosen.length===0);
 const [rangeComplete,setRangeComplete]=useState(!!p.editId);
 const {kind,period,lastPeriod}=p;
 function chooseTime(index:number){
  if(kind!=='partial'){p.setPeriod(String(index));p.setLastPeriod(String(index));return;}
  if(!period||rangeComplete){p.setPeriod(String(index));p.setLastPeriod(String(index));setRangeComplete(false);}
  else{p.setPeriod(String(Math.min(Number(period),index)));p.setLastPeriod(String(Math.max(Number(period),index)));setRangeComplete(true);}
 }
 function changeKind(value:HomeEvent['kind']){if(p.chosen.length)setShowStudents(false);p.setKind(value);p.setPeriod('');p.setLastPeriod('');setRangeComplete(false);}
 const timeText=kind==='absent'?'조회부터 종례까지 하루 전체':period===''?'시간을 선택해 주세요':kind==='partial'?`${sessions[Number(period)]}${period===lastPeriod?'':` ~ ${sessions[Number(lastPeriod)]}`}`:`${sessions[Number(period)]} ${kind==='late'?'등교':'조퇴'}`;
 return <section className="hr-editor hr-entry" aria-label="담임 기록 입력">
  <header><div><span className="hr-eyebrow">{p.editId?'기존 기록 수정':'새 출결 기록'}</span><h2>{p.chosen.length===1?p.label(p.chosen[0]):p.chosen.length?`${p.chosen.length}명 함께 기록`:'학생을 선택해 주세요'}</h2></div><button disabled={p.busy} onClick={p.onCancel}>취소</button></header>
  <fieldset disabled={p.busy} className="hr-entry-body"><legend className="hr-sr-only">출결 입력</legend>
   <section className="hr-entry-section"><div className="hr-section-title"><h3><span>1</span>학생</h3>{p.chosen.length>0&&!p.editId&&<button className="hr-text-button" onClick={()=>setShowStudents(!showStudents)}>{showStudents?'선택 접기':'학생 추가·변경'}</button>}</div>
    {showStudents&&!p.editId?<><p className="hr-sub">같은 출결과 사유를 기록할 학생을 모두 선택하세요.</p><div className="hr-picker">{p.roster.map(s=><button key={s.number} aria-pressed={p.chosen.includes(s.number)} onClick={()=>p.setChosen(p.chosen.includes(s.number)?p.chosen.filter(n=>n!==s.number):[...p.chosen,s.number])}>{p.chosen.includes(s.number)&&<span aria-hidden="true">✓ </span>}{p.label(s.number)}</button>)}</div><p className="hr-selection-count">{p.chosen.length}명 선택</p></>:<p className="hr-selected-students">{p.chosen.map(p.label).join(' · ')}</p>}
   </section>
   <section className="hr-entry-section"><h3><span>2</span>출결</h3><fieldset className="hr-choice-field"><legend>출결 종류</legend><div className="hr-choice-grid">{Object.entries(kinds).map(([value,label])=><label className="hr-choice" key={value}><input type="radio" name={`${p.reasonId}-kind`} checked={kind===value} onChange={()=>changeKind(value as HomeEvent['kind'])}/><span>{label}</span></label>)}</div></fieldset><fieldset className="hr-choice-field"><legend>사유 구분</legend><div className="hr-choice-grid">{Object.entries(categories).map(([value,label])=><label className="hr-choice" key={value}><input type="radio" name={`${p.reasonId}-category`} checked={p.category===value} onChange={()=>p.setCategory(value as HomeEvent['category'])}/><span>{label}</span></label>)}</div></fieldset></section>
   <section className="hr-entry-section"><h3><span>3</span>{kind==='late'?'등교 시점':kind==='early'?'조퇴 시점':'빠진 시간'}</h3><p className="hr-sub">{kind==='absent'?'결석은 하루 전체로 기록합니다.':kind==='partial'?'한 시간을 누르면 한 칸, 시작과 끝을 차례로 누르면 연속된 시간을 선택합니다.':'해당 시점을 한 번 눌러 주세요.'}</p><div className="hr-session-grid" role="group" aria-label="조회부터 종례까지 시간 선택">{sessions.map((label,i)=>{const selected=kind==='absent'||period!==''&&i>=Number(period)&&i<=Number(kind==='partial'?lastPeriod:period);return <button key={label} disabled={kind==='absent'} aria-label={`${label} 선택`} aria-pressed={selected} className={i===0||i===8?'hr-assembly':''} onClick={()=>chooseTime(i)}><span>{label}</span><small aria-hidden="true">{selected?'✓':'·'}</small></button>;})}</div><p className="hr-time-summary">{timeText}</p>{kind!=='absent'&&period!==''&&<button className="hr-text-button" onClick={()=>{p.setPeriod('');p.setLastPeriod('');setRangeComplete(false);}}>시간 선택 지우기</button>}</section>
   <section className="hr-entry-section"><h3><span>4</span><label htmlFor={p.reasonId}>사유</label></h3><textarea id={p.reasonId} rows={3} maxLength={1000} value={p.reason} onChange={e=>p.setReason(e.target.value)} placeholder="예: 병원 진료 후 등교"/><p className="hr-sub">여러 학생에게 같은 사유가 적용됩니다. 이름과 불필요한 민감정보는 적지 마세요.</p></section>
  </fieldset>
  <footer className="hr-entry-footer">{p.error&&<p role="alert" className="hr-error">{p.error}</p>}<div><span>{p.chosen.length}명 · {categories[p.category]} {kinds[kind]}</span><strong>{timeText}</strong></div><button className="hr-primary" disabled={p.busy||!p.chosen.length||!p.reason.trim()||(kind!=='absent'&&period==='')} onClick={p.onSubmit}>{p.busy?'저장 중…':p.editId?'수정 저장':`${p.chosen.length}명 기록 저장`}</button></footer>
 </section>;
}
