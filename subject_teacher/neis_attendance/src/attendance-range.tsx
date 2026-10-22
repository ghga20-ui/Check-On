import React, { useEffect, useRef, useState } from "react";
import { getApi } from "./bridge";
import { parseJsonResult, todayIso } from "./lib/transforms";
export type HistoryRow={date:string;slotId:string;classKey:string;period:number|null;subject:string;synced:boolean;closed:boolean;resolvable:boolean;marks:{student:string;name?:string;mark:string}[]};
export type AttendanceRange={start:string;end:string;classes:{key:string;label:string}[];rows:HistoryRow[];token:string;year:number;term:number;nameNotice?:string};
const localIso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
export function useAttendanceRange(autoLoad=true){
  const today=todayIso(),[start,setStart]=useState(today.slice(0,8)+"01"),[end,setEnd]=useState(today);
  const [data,setData]=useState<AttendanceRange|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=useRef(0);
  const load=async()=>{const id=++request.current;setBusy(true);setError("");try{if(!start||!end||start>end)throw new Error("시작일과 종료일을 확인해 주세요.");const result=parseJsonResult(await(await getApi()).get_attendance_history(start,end)) as AttendanceRange;if(id===request.current)setData(result);}catch(e){if(id===request.current){setData(null);setError(e instanceof Error?e.message:String(e));}}finally{if(id===request.current)setBusy(false);}};
  useEffect(()=>{if(autoLoad)void load();return()=>{request.current++;};},[]);
  const preset=(value:string)=>{const d=new Date(`${today}T12:00:00`);if(value==="week")d.setDate(d.getDate()-((d.getDay()+6)%7));else d.setDate(1);if(value==="last"){d.setMonth(d.getMonth()-1);setEnd(localIso(new Date(d.getFullYear(),d.getMonth()+1,0,12)));}else setEnd(today);setStart(localIso(d));};
  return {start,end,setStart,setEnd,data,busy,error,setError,load,preset,stale:data?.start!==start||data?.end!==end};
}
export function RangePicker({range,disabled=false}:any){return <form className="mg-range" onSubmit={e=>{e.preventDefault();void range.load();}}><div className="mg-date-pair"><label>시작일<input className="mg-input" type="date" value={range.start} disabled={disabled||range.busy} onChange={e=>range.setStart(e.target.value)}/></label><span>—</span><label>종료일<input className="mg-input" type="date" value={range.end} disabled={disabled||range.busy} onChange={e=>range.setEnd(e.target.value)}/></label></div><button className="mg-button primary" disabled={disabled||range.busy}>{range.busy?"조회 중…":"조회"}</button><div className="mg-presets">{[["week","이번 주"],["month","이번 달"],["last","지난달"]].map(([value,label])=><button type="button" className="mg-button quiet" key={value} disabled={disabled||range.busy} onClick={()=>range.preset(value)}>{label}</button>)}</div></form>;}
