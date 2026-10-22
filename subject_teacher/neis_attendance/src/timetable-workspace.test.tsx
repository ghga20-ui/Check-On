import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {TimetableWorkspace,lessonCatalog} from './timetable-workspace';
afterEach(cleanup);
const lesson={grade:2,classNo:'1',subjectName:'문학',neisSubjectLabel:'문학Ⅰ'};
it('uses the registered class and keeps the saved NEIS mapping',()=>{
 const settings={assignedLessons:[lesson]};
 expect(lessonCatalog(settings,[{grade:2,classNo:'1',subject:'문학',neis:'old'}])).toEqual([lesson]);
 render(<TimetableWorkspace settings={settings} rows={[]} />);
 expect(screen.getByText('문학Ⅰ')).toBeTruthy();
 expect(screen.queryByText('담당 수업 추가')).toBeNull();
 expect(screen.queryByPlaceholderText('반')).toBeNull();
});
it('manual mode chooses an existing class and refuses overlapping periods',async()=>{
 const save=vi.fn(),rows=[{day:'월',period:1,grade:2,classNo:'1',subject:'문학'},{day:'월',period:1,grade:2,classNo:'1',subject:'문학'}];
 render(<TimetableWorkspace settings={{timetableMode:'manual',assignedLessons:[lesson]}} rows={rows} saveSettings={save}/>);
 expect(screen.getByLabelText('1행 수업').tagName).toBe('SELECT');
 fireEvent.click(screen.getByText('설정 저장'));
 expect((await screen.findByRole('alert')).textContent).toContain('같은 요일·교시');
 expect(save).not.toHaveBeenCalled();
});
