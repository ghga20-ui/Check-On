import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClassManager } from "./class-workspace";
import { parseClassNumbers, parseRosterPaste } from "./class-manager";
import { rostersFromTsv, rostersToTsv } from "./lib/transforms";
import { HistoryView } from "./attendance-history-view";
import { getApi } from "./bridge";
vi.mock("./bridge", () => ({ getApi: vi.fn() }));
afterEach(cleanup);

describe("class registration", () => {
  it("expands multiple classes and rejects invalid ranges", () => {
    expect(parseClassNumbers("1-3, 2, 5")).toEqual(["1","2","3","5"]);
    expect(() => parseClassNumbers("3-1")).toThrow();
  });
  it("validates paste before replacing and supports numbers alone", () => {
    expect(parseRosterPaste("번호\t이름\n1\t\n3")).toEqual([{ n:1, name:"" },{ n:3, name:"" }]);
    expect(() => parseRosterPaste("1 학생\n1 학생")).toThrow();
    expect(() => parseRosterPaste("1 학생\nbad")).toThrow();
    const rows = { "2-1": [{ n:1, name:"" }] };
    expect(rostersFromTsv(rostersToTsv(rows))).toEqual(rows);
  });
  it("previews number generation without saving and cancels local edits", async () => {
    const save = vi.fn();
    render(<ClassManager rosters={{"2-1":[{n:3,name:""}]}} onSave={save}/>);
    fireEvent.click(screen.getByText("명단 편집"));
    fireEvent.click(screen.getByText("번호로 채우기"));
    fireEvent.click(screen.getByText("미리보기"));
    await screen.findByText("25명 · 적용 방법을 선택한 뒤 명단을 저장해 주세요.");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("닫기"));
    fireEvent.click(screen.getByText("취소"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("1행 번호")).toBeNull();
  });
  it("keeps error and draft visible when roster save fails", async () => {
    render(<ClassManager rosters={{"2-1":[{n:3,name:""}]}} onSave={vi.fn().mockRejectedValue(new Error("Drive 연결 실패"))}/>);
    fireEvent.click(screen.getByText("명단 편집"));
    fireEvent.click(screen.getByText("명단 저장"));
    expect((await screen.findByRole("alert")).textContent).toContain("Drive 연결 실패");
    expect(screen.getByLabelText("1행 번호")).toBeTruthy();
  });
  it("chooses mixed class before creating the roster", () => {
    render(<ClassManager rosters={{}}/>);
    fireEvent.click(screen.getByText("학급 추가"));
    fireEvent.click(screen.getByLabelText(/혼합학급/));
    expect(screen.getByLabelText("수업 집단")).toBeTruthy();
    expect(screen.queryByLabelText("담당 반")).toBeNull();
  });
  it("advances a mixed class from next to roster entry", async () => {
    render(<ClassManager rosters={{}} encryptionEnabled/>);
    fireEvent.click(screen.getByText("학급 추가"));
    fireEvent.click(screen.getByLabelText(/혼합학급/));
    fireEvent.change(screen.getByLabelText("수업 집단"),{target:{value:"a"}});
    fireEvent.change(screen.getByLabelText("과목명"),{target:{value:"문학과 영상"}});
    fireEvent.click(screen.getByText("다음 · 명단 채우기"));
    await screen.findByText("함께 수강하는 학생을 추가해 주세요");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("next never waits for Drive, even for a regular class", async () => {
    const add=vi.fn(()=>new Promise(()=>{}));
    render(<ClassManager rosters={{}} onAddClasses={add}/>);
    fireEvent.click(screen.getByText("학급 추가"));
    fireEvent.change(screen.getByLabelText("담당 반"),{target:{value:"1"}});
    fireEvent.change(screen.getByLabelText("과목명"),{target:{value:"문학과 영상"}});
    fireEvent.click(screen.getByText("다음 · 명단 채우기"));
    await screen.findByText("명단 저장");
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("history filters class detail, preserves zero-record classes, and invalidates changed range", async () => {
  vi.mocked(getApi).mockResolvedValue({ get_attendance_history: async(start,end) => JSON.stringify({start,end,token:"test",year:2026,term:2,classes:[{key:"2-1",label:"2학년 1반"},{key:"2-2",label:"2학년 2반"}],rows:[{date:start,slotId:"s1",classKey:"2-1",period:3,subject:"문학",synced:false,closed:false,marks:[{student:"4번",mark:"absent"}],resolvable:true}]}) } as any);
  render(<HistoryView/>);
  await screen.findByText("4번");
  fireEvent.change(screen.getByLabelText("학급"),{target:{value:"2-2"}});
  expect(screen.queryByText("4번")).toBeNull();
  expect(screen.getByText("조건에 맞는 결과·인정결과 기록이 없습니다")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("시작일"), {target:{value:"2026-01-01"}});
  await waitFor(() => expect(screen.queryByText("반영 대상 확인")).toBeNull());
});

it("history searches names, sorts students, and combines subject and sync filters",async()=>{
  vi.mocked(getApi).mockResolvedValue({get_attendance_history:async(start,end)=>JSON.stringify({start,end,token:'t',year:2026,term:2,classes:[{key:'2-1',label:'2학년 1반'}],rows:[{date:end,slotId:'a',classKey:'2-1',period:3,subject:'문학',synced:false,marks:[{student:'12번',name:'하학생',mark:'absent'},{student:'3번',name:'가학생',mark:'excused'}]},{date:start,slotId:'b',classKey:'2-1',period:1,subject:'영어',synced:true,marks:[{student:'5번',name:'나학생',mark:'absent'}]}]})} as any);
  render(<HistoryView/>);
  await screen.findByText('12번 하학생');
  fireEvent.change(screen.getByLabelText('정렬'),{target:{value:'number'}});
  expect(screen.getAllByRole('row')[1].textContent).toContain('3번 가학생');
  fireEvent.change(screen.getByLabelText('기록 찾기'),{target:{value:'가학생'}});
  expect(screen.queryByText('12번 하학생')).toBeNull();
  fireEvent.change(screen.getByLabelText('기록 찾기'),{target:{value:''}});
  fireEvent.change(screen.getByLabelText('과목'),{target:{value:'영어'}});
  fireEvent.change(screen.getByLabelText('반영 상태'),{target:{value:'pending'}});
  expect(screen.queryByText('5번 나학생')).toBeNull();
});
