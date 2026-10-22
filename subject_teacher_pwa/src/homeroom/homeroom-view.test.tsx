import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,it,expect,vi} from 'vitest';
import {HomeroomView} from './homeroom-view';
import {validateHomeDay,type HomeApi} from './homeroom-model';

afterEach(cleanup);
const rosters={'2-1':[{number:1,name:'합성학생가'},{number:2,name:'합성학생나'}]};
function api():HomeApi{return {load:vi.fn().mockResolvedValue({revision:0,events:[]}),save:vi.fn(async(_date,_key,day)=>({...day,revision:day.revision+1})),history:vi.fn().mockResolvedValue([])};}

it('records one reason for multiple students, then edits only one event',async()=>{
 const service=api();render(<HomeroomView api={service} rosters={rosters}/>);
 await waitFor(()=>expect(screen.getByText('여러 명 기록')).toBeEnabled());
 fireEvent.click(screen.getByText('여러 명 기록'));
 fireEvent.click(screen.getByRole('button',{name:'1번 합성학생가'}));fireEvent.click(screen.getByRole('button',{name:'2번 합성학생나'}));
 fireEvent.change(screen.getByLabelText('사유'),{target:{value:'진료'}});fireEvent.click(screen.getByText('2명 기록 저장'));
 await waitFor(()=>expect(service.save).toHaveBeenCalledTimes(1));
 const desired=vi.mocked(service.save).mock.calls[0][2];expect(desired.events.map(e=>e.reason)).toEqual(['진료','진료']);expect(JSON.stringify(desired)).not.toContain('합성학생');
 await screen.findByText('드라이브에 저장했습니다.');
 fireEvent.click(screen.getAllByRole('button',{name:/질병 결석.*진료/})[0]);
 fireEvent.change(screen.getByLabelText('사유'),{target:{value:'사유 정정'}});fireEvent.click(screen.getByText('수정 저장'));
 await waitFor(()=>expect(service.save).toHaveBeenCalledTimes(2));
 expect(vi.mocked(service.save).mock.calls[1][2].events.map(e=>e.reason).sort()).toEqual(['사유 정정','진료']);
});
it('keeps the reason after conflict and never reports success',async()=>{
 const service=api();vi.mocked(service.save).mockRejectedValue(Error('다른 기기에서 변경'));
 render(<HomeroomView api={service} rosters={rosters}/>);
 await waitFor(()=>expect(screen.getByText('여러 명 기록')).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'1번 기록 추가'}));
 fireEvent.change(screen.getByLabelText('사유'),{target:{value:'보관할 사유'}});fireEvent.click(screen.getByText('1명 기록 저장'));
 expect(await screen.findByRole('alert')).toHaveTextContent('다른 기기');expect(screen.getByLabelText('사유')).toHaveValue('보관할 사유');expect(screen.queryByText('드라이브에 저장했습니다.')).not.toBeInTheDocument();
 const first=vi.mocked(service.save).mock.calls[0][2];
 fireEvent.click(screen.getByText('1명 기록 저장'));
 await waitFor(()=>expect(service.save).toHaveBeenCalledTimes(2));
 expect(vi.mocked(service.save).mock.calls[1][2]).toEqual(first);
});
it('queries history only on request and hides local names on mobile',async()=>{
 const service=api();render(<HomeroomView mobile api={service} rosters={rosters}/>);
 await waitFor(()=>expect(screen.getByText('기간 내역')).toBeEnabled());fireEvent.click(screen.getByText('기간 내역'));
 expect(service.history).not.toHaveBeenCalled();expect(screen.queryByText(/합성학생/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'조회'}));await waitFor(()=>expect(service.history).toHaveBeenCalledTimes(1));
});
it('supports late and early with independent reasons but rejects all-day overlap',()=>{
 const a={id:'a',number:1,kind:'late',category:'illness',reason:'진료',startPeriod:2,endPeriod:2};
 const b={...a,id:'b',kind:'early',reason:'가정 사정',startPeriod:6,endPeriod:6};
 expect(validateHomeDay({revision:1,events:[a,b]}).events).toHaveLength(2);
 expect(()=>validateHomeDay({revision:1,events:[a,{...b,kind:'absent',startPeriod:null,endPeriod:null}]})).toThrow('겹칩니다');
 expect(()=>validateHomeDay({revision:1,events:[{...a,reason:' '}]})).toThrow('사유');
});

it('offers all nine NEIS time slots and saves morning as zero',async()=>{
 const service=api();render(<HomeroomView api={service} rosters={rosters}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'1번 기록 추가'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'1번 기록 추가'}));
 expect(screen.queryByLabelText('적용 교육과정')).not.toBeInTheDocument();
 expect(screen.queryByText(/현장실습/)).not.toBeInTheDocument();
 const group=screen.getByRole('group',{name:'조회부터 종례까지 시간 선택'});
 expect([...group.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))).toEqual(['조회','1교시','2교시','3교시','4교시','5교시','6교시','7교시','종례'].map(s=>`${s} 선택`));
 fireEvent.click(screen.getByRole('radio',{name:'지각'}));
 fireEvent.click(screen.getByRole('button',{name:'조회 선택'}));
 fireEvent.change(screen.getByLabelText('사유'),{target:{value:'등교 지연'}});
 fireEvent.click(screen.getByRole('button',{name:'1명 기록 저장'}));
 await waitFor(()=>expect(service.save).toHaveBeenCalledTimes(1));
 expect(vi.mocked(service.save).mock.calls[0][2]).toMatchObject({curriculum:'2022',events:[{startSession:0,endSession:0,startPeriod:null,endPeriod:null}]});
});
it('selects a continuous range through closing assembly',async()=>{
 const service=api();render(<HomeroomView api={service} rosters={rosters}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'1번 기록 추가'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'1번 기록 추가'}));
 fireEvent.click(screen.getByRole('radio',{name:'결과'}));
 fireEvent.click(screen.getByRole('button',{name:'6교시 선택'}));
 fireEvent.click(screen.getByRole('button',{name:'종례 선택'}));
 expect(screen.getByRole('button',{name:'7교시 선택'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'5교시 선택'})).toHaveAttribute('aria-pressed','false');
 fireEvent.change(screen.getByLabelText('사유'),{target:{value:'진료'}});
 fireEvent.click(screen.getByRole('button',{name:'1명 기록 저장'}));
 await waitFor(()=>expect(service.save).toHaveBeenCalledTimes(1));
 expect(vi.mocked(service.save).mock.calls[0][2].events[0]).toMatchObject({startSession:6,endSession:8});
});
it('rejects a duplicate across old and new time formats',()=>{
 const a={id:'a',number:1,kind:'partial',category:'illness',reason:'진료',startPeriod:2,endPeriod:3};
 expect(()=>validateHomeDay({revision:0,events:[a,{...a,id:'b',startPeriod:null,endPeriod:null,startSession:2,endSession:3}]})).toThrow('중복');
});

