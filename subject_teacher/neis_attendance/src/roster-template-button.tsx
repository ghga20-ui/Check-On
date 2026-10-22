import React,{useState} from 'react';
import {getApi} from './bridge';
import {parseJsonResult} from './lib/transforms';
export function RosterTemplateButton({mixed=false}:{mixed?:boolean}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  return <><button className="mg-button" disabled={busy} onClick={async()=>{
    setBusy(true);setMessage('');
    try{const result=parseJsonResult(await(await getApi()).download_roster_template(mixed));if(!result.cancelled)setMessage('예시 양식을 저장했습니다.');}
    catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }}>{busy?'저장 중…':'예시 양식 다운로드'}</button>{message&&<span role="status" className="mg-toolbar-note">{message}</span>}</>;
}
