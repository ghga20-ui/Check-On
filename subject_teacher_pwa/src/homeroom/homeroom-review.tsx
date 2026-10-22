import React,{useState} from 'react';
import {categories,kinds,homeScope,marksAssembly,type HomeApi,type HomeDay,type HomeEvent} from './homeroom-model';

export function DailyReview({day,date,classKey,busy,onSave,api,mobile}:{day:HomeDay;date:string;classKey:string;busy:boolean;onSave:(patch:Partial<HomeDay>)=>Promise<boolean>;api:HomeApi;mobile:boolean}){
 const [password,setPassword]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false),[reviewed,setReviewed]=useState(false);
 const numbers=[...new Set(day.events.map(e=>e.number))].sort((a,b)=>a-b);
 const eligible=(events:HomeEvent[])=>events.filter(e=>e.category!=='excused');
 const unresolved=numbers.some(n=>{const items=eligible(day.events.filter(e=>e.number===n));return items.length>1&&!items.some(e=>e.id===day.decisions?.[String(n)]);});
 async function run(inspectOnly:boolean){
  setWorking(true);setNotice('');try{const plan=await api.preview!(date,classKey);if(plan.revision!==day.revision&&!inspectOnly)throw Error("다른 기기에서 기록이 바뀌었습니다. 다시 불러온 뒤 검토해 주세요.");if(plan.errors.length&&!inspectOnly)throw Error(plan.errors.join('\n'));await api.run!(date,classKey,plan.token,password,inspectOnly);setPassword('');setNotice('작업을 시작했습니다. PC 진행 기록에서 결과를 확인해 주세요.');}catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{setWorking(false);}
 }
 return <section className="hr-review" aria-label="일일 출결 검토"><h2>일일 출결 검토</h2><p>발생한 기록은 모두 보관합니다. 최종 출결은 학교 학업성적관리규정에 따라 학생별로 한 가지를 선택합니다.</p>
 <p className="hr-sub">출석인정은 /를 표시하지 않고 사유에 남깁니다. 교과 교시는 확인용 기록이며 담임 자동 입력으로 변경하지 않습니다.</p>
 {numbers.map(n=>{const all=day.events.filter(e=>e.number===n),items=eligible(all),choice=items.find(e=>e.id===day.decisions?.[String(n)])||(items.length===1?items[0]:undefined);return <article className="hr-review-row" key={n}><strong>{n}번</strong><div>{items.length>1?<label>최종 출결<select aria-label={`${n}번 최종 출결`} disabled={busy||working} value={day.decisions?.[String(n)]??''} onChange={e=>{setReviewed(false);void onSave({decisions:{...day.decisions,[n]:e.target.value}});}}><option value="" disabled>학교 규정에 따라 선택</option>{items.map(e=><option key={e.id} value={e.id}>{categories[e.category]} {kinds[e.kind]} · {homeScope(e)}</option>)}</select></label>:<b>{choice?`${categories[choice.category]} ${kinds[choice.kind]}`:'마감 구분 미표기 · 사유만 기록'}</b>}
 <p className="hr-sub">조회 {all.some(e=>marksAssembly(e))?'/':'미표기'} · 종례 {all.some(e=>marksAssembly(e,true))?'/':'미표기'} · 일반 교시 수정 안 함</p>
 {all.map(e=><p className="hr-reason" key={e.id}>{categories[e.category]} {kinds[e.kind]} · {homeScope(e)}: {e.reason}</p>)}
 </div></article>;})}
 {!day.events.length&&<label><input type="checkbox" checked={day.noChangesConfirmed??false} disabled={busy||working} onChange={e=>void onSave({noChangesConfirmed:e.target.checked})}/> 해당 날짜의 출결을 확인했으며 변동이 없습니다</label>}
 <details><summary>매뉴얼 처리 순서와 확인 사항</summary><ol><li>수강학생 편성과 실제 시간표를 먼저 확인합니다.</li><li>조회·종례, 교시별 출결과 사유를 교차 확인합니다. 창체는 별도 메뉴에서 처리합니다.</li><li>최종 종류·구분과 사유를 적용한 뒤 저장합니다. 출결마감은 저장과 별도입니다.</li><li>변동 없는 날짜의 반별일출결마감관리 저장도 출결마감입니다. 미기록 날짜를 자동 마감하지 않습니다.</li></ol><p>체크온 기록 삭제는 나이스의 ‘깨끗이’ 삭제나 마감취소를 실행하지 않습니다.</p></details>
 {!mobile&&api.run&&api.preview&&<div className="hr-automation"><h3>담임 출결 입력 · 시험 기능</h3><p>실제 담임 화면에서 검증 전입니다. 화면 구조·학급·날짜가 일치할 때만 입력하며, 다른 기존 내용이 있으면 중단합니다. 자동 출결마감은 실행하지 않습니다.</p><label>인증서 비밀번호<input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> 위 입력 내용과 학교 규정을 확인했습니다</label><div className="hr-toolbar"><button disabled={busy||working} onClick={()=>void run(true)}>화면 연결 점검</button><button disabled={busy||working||!reviewed||unresolved||!day.events.length} onClick={()=>void run(false)}>검토한 기록 입력·저장</button></div>{notice&&<p role="status">{notice}</p>}</div>}
 </section>;
}
