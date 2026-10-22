import {getApi} from './bridge';
import {parseJsonResult,formatApiError} from './lib/transforms';
import {validateHomeDay,type HomeApi} from './homeroom-model';

async function invoke(run:(api:Awaited<ReturnType<typeof getApi>>)=>Promise<string>){
  try{return parseJsonResult(await run(await getApi()));}
  catch(error){throw new Error(formatApiError(error));}
}
export const desktopHomeApi:HomeApi={
  preview:(date,key)=>invoke(api=>api.preview_homeroom_run(date,key)),
  run:async(date,key,token,password,inspectOnly)=>{await invoke(api=>api.start_homeroom_run(date,key,token,password,inspectOnly));},
  load:async(date,key)=>validateHomeDay(await invoke(api=>api.get_homeroom_day(date,key))),
  save:async(date,key,day)=>validateHomeDay(await invoke(api=>api.save_homeroom_day(date,key,JSON.stringify(validateHomeDay(day))))),
  history:(start,end,key)=>invoke(api=>api.get_homeroom_history(start,end,key)),
};
