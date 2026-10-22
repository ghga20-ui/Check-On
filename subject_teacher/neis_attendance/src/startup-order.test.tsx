import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {act,cleanup,render,waitFor} from '@testing-library/react';
import App from './app';
import {createMockApi} from './mock-api';

afterEach(()=>{cleanup();delete window.pywebview;vi.restoreAllMocks();});
it('finishes setup and today before starting the weekly refresh',async()=>{
  let settingsReady!:(raw:string)=>void;
  let todayReady!:(raw:string)=>void;
  const api=createMockApi();
  const calls:string[]=[];
  api.get_settings=vi.fn(()=>new Promise<string>(resolve=>{settingsReady=resolve;}));
  api.get_today_slots=vi.fn(()=>{calls.push('today');return new Promise<string>(resolve=>{todayReady=resolve;});});
  api.publish_neis_timetable_for_week=vi.fn(async()=>{calls.push('week');return JSON.stringify({ok:true});});
  window.pywebview={api};
  window.__isPywebview=()=>true;
  window.__onPywebviewReady=callback=>callback();
  render(<App/>);
  await waitFor(()=>expect(api.get_settings).toHaveBeenCalled());
  expect(calls).toEqual([]);
  await act(async()=>settingsReady(JSON.stringify({teacherName:'합성',schoolName:'합성',region:'경기',semester:{year:2026,term:2},timetableMode:'neis',assignedLessons:[{grade:2,classNo:'1',subjectName:'문학'}]})));
  await waitFor(()=>expect(calls).toEqual(['today']));
  await act(async()=>todayReady('[]'));
  await waitFor(()=>expect(calls).toEqual(['today','week']),{timeout:3000});
  expect(api.get_today_slots).toHaveBeenCalledTimes(1);
});
