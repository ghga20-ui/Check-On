import {readJsonSnapshot,writeJsonSnapshot,DriveError,DriveConflictError} from './drive';
import {loadStudents} from './driveData';
import {validateHomeDay,emptyHomeDay,sameDay,type HomeApi,type HomeDay,type HomeHistory} from '../homeroom/homeroom-model';

type Month={schemaVersion:3;month:string;records:Record<string,Record<string,HomeDay>>};
const filename=(month:string)=>`homeroom-${month}.json`;
function validDate(day:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('날짜를 확인해 주세요.');}
function validTarget(day:string,key:string){validDate(day);if(!/^[1-3]-[1-9]\d*$/.test(key))throw Error('일반 학급을 선택해 주세요.');}
function parseMonth(value:unknown,month:string):Month{
  if(value===null)return {schemaVersion:3,month,records:{}};
  const doc=value as Month;
  if(!doc||![1,2,3].includes(doc.schemaVersion)||doc.month!==month||!doc.records||typeof doc.records!=='object'||Array.isArray(doc.records))throw Error('담임 기록 형식을 확인해 주세요. 앱 업데이트가 필요할 수 있습니다.');
  const records:Month['records']={};
  for(const [day,classes] of Object.entries(doc.records)){
    validDate(day);if(day.slice(0,7)!==month||!classes||typeof classes!=='object'||Array.isArray(classes))throw Error('담임 기록 날짜를 확인해 주세요.');
    records[day]={};for(const [key,entry] of Object.entries(classes)){validTarget(day,key);records[day][key]=validateHomeDay(entry);}
  }
  return {schemaVersion:3,month,records};
}
async function save(date:string,key:string,value:HomeDay){
  validTarget(date,key);const desired=validateHomeDay(value);
  const students=await loadStudents();const allowed=new Set(students?.classes[key]?.map(s=>s.number)||[]);
  if(!students?.classes[key]||desired.events.some(e=>!allowed.has(e.number)))throw Error('학급·학생 명단이 바뀌었습니다. 명단을 다시 불러와 주세요.');
  const incoming={...desired,curriculum:'2022' as const,revision:desired.revision+1};
  if(desired.events.some(e=>e.practice&&(date<e.practice.start||date>e.practice.end)))throw Error("기록 날짜가 실습 기간 밖입니다.");
  for(let attempt=0;attempt<4;attempt++){
    const snapshot=await readJsonSnapshot(filename(date.slice(0,7)));
    const doc=parseMonth(snapshot.data,date.slice(0,7));
    const current=doc.records[date]?.[key]||emptyHomeDay();
    if(sameDay(current,incoming))return current;
    if(current.revision!==desired.revision)throw new DriveConflictError('다른 기기에서 이 날짜의 담임 기록을 수정했습니다. 입력한 사유를 보관한 뒤 최신 기록을 확인해 주세요.');
    (doc.records[date]??={})[key]=incoming;
    try{await writeJsonSnapshot(filename(doc.month),doc,snapshot);return incoming;}
    catch(error){if(!(error instanceof DriveError&&error.status===412))throw error;}
  }
  throw new DriveConflictError('다른 기기에서 저장 중입니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.');
}
export const mobileHomeApi:HomeApi={
  async load(date,key){validTarget(date,key);const doc=parseMonth((await readJsonSnapshot(filename(date.slice(0,7)))).data,date.slice(0,7));return doc.records[date]?.[key]||emptyHomeDay();},
  save:async(date,key,day)=>{
    try{return await save(date,key,day);}
    catch(error){if(error instanceof DriveConflictError)throw error;throw Error('드라이브에 저장하지 못했습니다. 입력 내용은 화면에 유지됩니다. 인터넷·Google 연결을 확인하고 다시 저장해 주세요.');}
  },
  async history(start,end,key){
    validTarget(start,key);validDate(end);
    const span=(Date.parse(end)-Date.parse(start))/86400000;
    if(span<0||span>365)throw Error('조회 기간은 최대 366일로 선택해 주세요.');
    const rows:HomeHistory[]=[];let month=start.slice(0,7);
    while(month<=end.slice(0,7)){
      const doc=parseMonth((await readJsonSnapshot(filename(month))).data,month);
      for(const [date,classes] of Object.entries(doc.records))if(date>=start&&date<=end)for(const event of classes[key]?.events||[])rows.push({...event,date});
      const next=new Date(month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);month=next.toISOString().slice(0,7);
    }
    return rows;
  },
};
