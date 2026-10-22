import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,it,expect,vi} from 'vitest';
import {DailyReview} from './homeroom-review';
import {validateHomeDay,sameDay,type HomeEvent,type HomeApi} from './homeroom-model';
afterEach(cleanup);
const event:HomeEvent={id:'a',number:1,kind:'late',category:'illness',reason:'진료',startPeriod:2,endPeriod:2};
const api:HomeApi={load:vi.fn(),save:vi.fn(),history:vi.fn()};
it('does not pick the final event when late and early coexist',()=>{
 const save=vi.fn().mockResolvedValue(true);
 render(<DailyReview day={{revision:1,curriculum:'2022',events:[event,{...event,id:'b',kind:'early',reason:'가정 사정'}]}} date="2026-09-16" classKey="2-1" busy={false} mobile api={api} onSave={save}/>);
 expect(screen.getByLabelText('1번 최종 출결')).toHaveValue('');
 expect(screen.getByText(/가정 사정/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('1번 최종 출결'),{target:{value:'b'}});
 expect(save).toHaveBeenCalledWith({decisions:{'1':'b'}});
});
it('renders excused as reason only with no absence marks',()=>{
 render(<DailyReview day={{revision:1,curriculum:'2022',events:[{...event,category:'excused'}]}} date="2026-09-16" classKey="2-1" busy={false} mobile api={api} onSave={vi.fn()}/>);
 expect(screen.getByText('마감 구분 미표기 · 사유만 기록')).toBeVisible();
 expect(screen.getByText('조회 미표기 · 종례 미표기 · 일반 교시 수정 안 함')).toBeVisible();
});
it('blocks a plan whose revision differs from what the teacher reviewed',async()=>{
 const service={...api,preview:vi.fn().mockResolvedValue({revision:2,token:'new',errors:[]}),run:vi.fn()};
 render(<DailyReview day={{revision:1,curriculum:'2022',events:[event]}} date="2026-09-16" classKey="2-1" busy={false} mobile={false} api={service} onSave={vi.fn()}/>);
 fireEvent.click(screen.getByLabelText('위 입력 내용과 학교 규정을 확인했습니다'));
 fireEvent.click(screen.getByText('검토한 기록 입력·저장'));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('다른 기기'));
 expect(service.run).not.toHaveBeenCalled();
});
it('rejects unknown personal fields in practice and roundtrips reviewed choices',()=>{
 const day={revision:1,events:[event],curriculum:'2022',decisions:{'1':'a'},noChangesConfirmed:false};
 expect(validateHomeDay(day)).toEqual(day);
 expect(sameDay(validateHomeDay(day),{...validateHomeDay(day),events:[{...event,practice:null}]})).toBe(true);
 expect(()=>validateHomeDay({revision:0,events:[{...event,kind:'absent',category:'excused',startPeriod:null,endPeriod:null,practice:{start:'2026-09-01',end:'2026-09-30',organization:'합성기관',name:'금지'}}]})).toThrow();
});
