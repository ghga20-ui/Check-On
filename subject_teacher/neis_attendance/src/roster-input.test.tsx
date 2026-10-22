import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ClassManager} from './class-workspace';
import {parseMixedPaste} from './roster-paste';
afterEach(cleanup);
it('parses mixed Excel rows and rejects duplicate identities',()=>{
  expect(parseMixedPaste('원소속 반\t번호\t이름\n1\t3\t합성가\n2\t3\t합성나',2)).toHaveLength(2);
  expect(()=>parseMixedPaste('1\t3\t가\n1\t3\t나',2)).toThrow();
  expect(()=>parseMixedPaste('1\t0\t가',2)).toThrow();
});
it('requires confirmation before removing a class',async()=>{
  const remove=vi.fn().mockResolvedValue(undefined);
  render(<ClassManager rosters={{'2-1':[{n:1,name:'합성'}]}} onDelete={remove}/>);
  fireEvent.click(screen.getByText('학급 삭제'));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('취소'));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('학급 삭제'));
  fireEvent.click(screen.getByText('학급과 모든 기록 삭제'));
  expect(remove).toHaveBeenCalledWith('2-1');
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('Enter at the final name field appends a student',()=>{
  render(<ClassManager rosters={{'2-1':[{n:1,name:'합성'}]}}/>);
  fireEvent.click(screen.getByText('명단 편집'));
  const inputs=document.querySelectorAll('tbody input');
  fireEvent.keyDown(inputs[inputs.length-1],{key:'Enter'});
  expect(screen.getByLabelText('2행 번호')).toBeTruthy();
});
