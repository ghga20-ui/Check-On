import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MixedRosterEditor} from './mixed-editor';
afterEach(cleanup);
const group={id:'g1',grade:2,classNo:'선택A',subjectName:'문학',neisSubjectLabel:'문학',revision:1,students:[{grade:2,homeClassNo:'1',number:3,name:''}]};
it('retains saved identity and revision after timetable binding fails',async()=>{
 const save=vi.fn().mockResolvedValue({document:{revision:4,groups:{g1:group}}});
 const bind=vi.fn().mockRejectedValueOnce(new Error('시간표 연결 실패')).mockResolvedValue(undefined),done=vi.fn();
 render(<MixedRosterEditor document={{revision:3}} seed={{...group,id:undefined}} encryptionEnabled onSave={save} onBind={bind} onDone={done}/>);
 // A new roster starts empty, even when a seed contains incidental rows.
 fireEvent.click(screen.getByText('+ 학생 추가'));
 fireEvent.change(screen.getByLabelText('1행 원소속 반'),{target:{value:'1'}});
 fireEvent.change(screen.getByLabelText('1행 번호'),{target:{value:'3'}});
 fireEvent.click(screen.getByText('명단 저장'));fireEvent.click(screen.getByText('변경 적용'));
 await screen.findByText('시간표 연결 실패');
 expect(done).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('변경 적용'));
 await waitFor(()=>expect(done).toHaveBeenCalled());
 expect(save.mock.calls[1][0]).toMatchObject({id:'g1',expectedRevision:4});
});
it('does not save invalid duplicate students',()=>{
 render(<MixedRosterEditor document={{revision:1}} group={{...group,students:[...group.students,...group.students]}} encryptionEnabled onSave={vi.fn()}/>);
 expect((screen.getByText('명단 저장') as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getAllByRole('alert')).toHaveLength(2);
});
