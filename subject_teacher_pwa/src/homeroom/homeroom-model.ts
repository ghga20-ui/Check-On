export type Practice={start:string;end:string;organization:string};
export type HomeEvent={id:string;number:number;kind:'absent'|'late'|'early'|'partial';category:'illness'|'unexcused'|'other'|'excused';reason:string;startPeriod:number|null;endPeriod:number|null;startSession?:number|null;endSession?:number|null;practice?:Practice|null};
export type HomeDay={revision:number;events:HomeEvent[];pending?:boolean;curriculum?:"2022"|"2015"|null;decisions?:Record<string,string>;noChangesConfirmed?:boolean};
export type HomeHistory=HomeEvent&{date:string};
export interface HomeApi{load(date:string,key:string):Promise<HomeDay>;save(date:string,key:string,day:HomeDay):Promise<HomeDay>;history(start:string,end:string,key:string):Promise<HomeHistory[]>;run?(date:string,key:string,token:string,password:string,inspectOnly:boolean):Promise<void>;preview?(date:string,key:string):Promise<{token:string;errors:string[];revision:number}>;discardPending?(date:string,key:string):Promise<void>}
export const kinds={absent:'결석',late:'지각',early:'조퇴',partial:'결과'};
export const categories={illness:'질병',unexcused:'미인정',other:'기타',excused:'출석인정'};
export const emptyHomeDay=():HomeDay=>({revision:0,events:[]});
export function validateHomeDay(value:unknown):HomeDay{
 const d=value as HomeDay;if(!d||!Number.isInteger(d.revision)||d.revision<0||!Array.isArray(d.events)||d.events.length>500)throw Error('담임 기록 형식을 확인해 주세요.');
 const ids=new Set(),keys=new Set(),absent=new Set(),changed=new Set();
 const events=d.events.map(e=>{
  if(!e||Object.keys(e).some(k=>!['id','number','kind','category','reason','startPeriod','endPeriod','startSession','endSession','practice'].includes(k))||typeof e.id!=='string'||!e.id||e.id.length>80||!Number.isInteger(e.number)||e.number<1||e.number>99||!Object.hasOwn(kinds,e.kind)||!Object.hasOwn(categories,e.category)||typeof e.reason!=='string'||!e.reason.trim()||e.reason.length>1000)throw Error('학생·출결 종류·사유를 확인해 주세요.');
  if(e.startSession!=null||e.endSession!=null){if(!Number.isInteger(e.startSession)||!Number.isInteger(e.endSession)||e.startSession!<0||e.endSession!>8||e.startSession!>e.endSession!||e.startPeriod!==null||e.endPeriod!==null||e.kind==='absent'||(e.kind!=='partial'&&e.startSession!==e.endSession))throw Error('조회~종례의 시간 선택을 확인해 주세요.');}
  else if(e.kind==='absent'){if(e.startPeriod!==null||e.endPeriod!==null)throw Error('결석은 하루 전체입니다.');}
  else if(!Number.isInteger(e.startPeriod)||!Number.isInteger(e.endPeriod)||e.startPeriod!<1||e.endPeriod!>9||e.startPeriod!>e.endPeriod!||(e.kind!=='partial'&&e.startPeriod!==e.endPeriod))throw Error('교시를 확인해 주세요.');
  const slot=(session:number|null|undefined,period:number|null)=>session??(period!=null&&period>7?`legacy-${period}`:period);const key=`${e.number}/${e.kind}/${slot(e.startSession,e.startPeriod)}/${slot(e.endSession,e.endPeriod)}`;if(ids.has(e.id)||keys.has(key))throw Error('같은 기록이 중복되었습니다.');ids.add(e.id);keys.add(key);(e.kind==='absent'?absent:changed).add(e.number);
  if(e.practice){const p=e.practice;if(Object.keys(p).some(k=>!['start','end','organization'].includes(k))||e.kind!=='absent'||e.category!=='excused'||typeof p.organization!=='string'||!p.organization.trim()||p.organization.length>200||!validIso(p.start)||!validIso(p.end)||p.start>p.end)throw Error('현장실습 기간·기관과 출석인정 결석 여부를 확인해 주세요.');}
  return {...e,reason:e.reason.trim(),...(e.practice?{practice:{start:e.practice.start,end:e.practice.end,organization:e.practice.organization.trim()}}:{})};
 });if([...absent].some(n=>changed.has(n)))throw Error('하루 결석과 다른 출결 기록이 겹칩니다. 기존 기록을 수정해 주세요.');
 if(d.curriculum!=null&&!['2022','2015'].includes(d.curriculum))throw Error('교육과정을 확인해 주세요.');
 if(d.decisions!=null&&(typeof d.decisions!=='object'||Array.isArray(d.decisions)||Object.entries(d.decisions).some(([n,id])=>!events.some(e=>String(e.number)===n&&e.id===id))))throw Error('최종 출결 선택을 확인해 주세요.');
 if(d.noChangesConfirmed!==undefined&&typeof d.noChangesConfirmed!=='boolean')throw Error('변동 없음 확인을 확인해 주세요.');
 if(d.noChangesConfirmed&&events.length)throw Error('변동 기록이 있습니다.');
 return {revision:d.revision,events,...(d.curriculum!==undefined?{curriculum:d.curriculum}:{}),...(d.decisions!==undefined?{decisions:d.decisions}:{}),...(d.noChangesConfirmed!==undefined?{noChangesConfirmed:d.noChangesConfirmed}:{})};
}
export const sessions=['조회','1교시','2교시','3교시','4교시','5교시','6교시','7교시','종례'];
export function eventSession(e:HomeEvent,end=false){const value=end?e.endSession:e.startSession;if(value!=null)return String(value);const old=end?e.endPeriod:e.startPeriod;return old!=null&&old>=1&&old<=7?String(old):'';}
export function homeScope(e:HomeEvent){if(e.kind==='absent')return '하루 전체';const start=e.startSession!=null?sessions[e.startSession]:`${e.startPeriod}교시`,end=e.endSession!=null?sessions[e.endSession]:`${e.endPeriod}교시`;return e.kind==='late'?`${start} 등교`:e.kind==='early'?`${start} 조퇴`:start===end?start:`${start}~${end}`;}
export function marksAssembly(e:HomeEvent,closing=false){return e.category!=='excused'&&(e.kind==='absent'||e.kind===(closing?'early':'late')||(e.kind==='partial'&&(closing?e.endSession===8:e.startSession===0)));}

function validIso(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function sameDay(a:HomeDay,b:HomeDay){
 const canonical=(d:HomeDay)=>JSON.stringify([d.revision,d.curriculum??null,d.noChangesConfirmed??false,Object.entries(d.decisions??{}).sort(),d.events.map(e=>[e.id,e.number,e.kind,e.category,e.reason,e.startPeriod,e.endPeriod,e.startSession??null,e.endSession??null,e.practice?[e.practice.start,e.practice.end,e.practice.organization]:null])]);
 return canonical(a)===canonical(b);
}
