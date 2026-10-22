import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { marksToSlotAttendance } from "./lib/attendance";
import { MonthlyAttendanceSchema, type MixedGroups, type SlotAttendance } from "./lib/schemas";
const mocks = vi.hoisted(() => ({read: vi.fn(), snapshot: vi.fn(), write: vi.fn()}));
vi.mock("./lib/drive", async original => ({...await original<typeof import("./lib/drive")>(), readJson: mocks.read, readJsonSnapshot: mocks.snapshot, writeJsonSnapshot: mocks.write}));
import { saveSlotAttendance } from "./lib/driveData";

const groupId = "00000000-0000-4000-8000-000000000001";
const a = "00000000-0000-4000-8000-000000000002";
const b = "00000000-0000-4000-8000-000000000003";
const students = [{studentId: a, grade: 2, homeClassNo: 1, number: 5}, {studentId: b, grade: 2, homeClassNo: 3, number: 5}];
const group = {id: groupId, grade: 2, classNo: "선택A", subjectName: "문학", neisSubjectLabel: "문학", revision: 1, students, history: {"1": students}};
const mixedGroups: MixedGroups = {schemaVersion: 1, revision: 1, groups: {[groupId]: group}};
const slots = [{id: "mixed", dayOfWeek: 4, period: 1, grade: 2, classNo: "선택A", subjectName: "문학", neisSubjectLabel: "문학", groupId}];
const props = {initialDate: "2026-09-10", slots, mixedGroups, rosters: {[`mixed:${groupId}`]: students.map(s => ({...s, name: ""}))}};
afterEach(() => {cleanup(); vi.clearAllMocks();});

describe("혼합수업 모바일", () => {
  it("다른 반 같은 번호를 구분하고 필터 밖 체크도 저장하며 재접속 후 복원합니다", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<App {...props} onSaveSlot={save}/>);
    fireEvent.click(screen.getByRole("button", {name: /선택A.*열기/}));
    fireEvent.click(screen.getByRole("button", {name: "1반 5번 출석"}));
    fireEvent.click(screen.getByRole("button", {name: "3반"}));
    expect(screen.queryByRole("button", {name: "1반 5번 결과"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "3반 5번 출석"}));
    fireEvent.click(screen.getByRole("button", {name: "3반 5번 결과"}));
    fireEvent.click(screen.getByRole("button", {name: "저장"}));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const payload = save.mock.calls[0][2] as SlotAttendance;
    expect(payload).toMatchObject({groupId, rosterRevision: 1, absences: [{studentId: a, markType: "absent"}, {studentId: b, markType: "excused"}]});
    view.unmount();
    render(<App {...props} initialAttendance={{"2026-09-10": {mixed: payload}}}/>);
    fireEvent.click(screen.getByRole("button", {name: /선택A.*열기/}));
    expect(screen.getByRole("button", {name: "1반 5번 결과"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "3반 5번 인정결과"})).toBeInTheDocument();
  });
  it("오래된 기록은 당시 명부로 표시하고 재확인 전 저장하지 않습니다", () => {
    const old = marksToSlotAttendance({[a]: "absent"}, "2026-09-10T01:00:00Z", {groupId, rosterRevision: 1});
    const save = vi.fn();
    render(<App {...props} mixedGroups={{...mixedGroups, groups: {[groupId]: {...group, revision: 2, students: [students[1]], history: {...group.history, "2": [students[1]]}}}}} initialAttendance={{"2026-09-10": {mixed: old}}} onSaveSlot={save}/>);
    fireEvent.click(screen.getByRole("button", {name: /선택A.*열기/}));
    expect(screen.getByRole("button", {name: "1반 5번 결과"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "저장"}));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/명부가 변경되었습니다/)).toBeInTheDocument();
  });
  it("오래된 오프라인 초안을 업로드하지 않고 원본을 보존합니다", async () => {
    const payload = marksToSlotAttendance({[a]: "absent"}, "2026-09-10T01:00:00Z", {groupId, rosterRevision: 1});
    const original = JSON.stringify(payload);
    mocks.read.mockResolvedValue({data: {...mixedGroups, groups: {[groupId]: {...group, revision: 2, history: {...group.history, "2": students}}}}});
    await expect(saveSlotAttendance("2026-09", "2026-09-10", "mixed", payload, null)).rejects.toThrow("명부가 변경");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).toBe(original);
  });
  it("전원 출석에도 혼합 메타데이터와 월별 버전 2를 보존합니다", async () => {
    const payload = marksToSlotAttendance({}, "2026-09-10T01:00:00Z", {groupId, rosterRevision: 1});
    mocks.read.mockResolvedValue({data: mixedGroups}); mocks.snapshot.mockResolvedValue({id:null, etag:null, data:null}); mocks.write.mockResolvedValue(undefined);
    await saveSlotAttendance("2026-09", "2026-09-10", "mixed", payload, null);
    const doc = mocks.write.mock.calls[0][1];
    expect(doc.schemaVersion).toBe(2);
    expect(MonthlyAttendanceSchema.parse(doc).records["2026-09-10"].mixed).toMatchObject({groupId, rosterRevision: 1});
    expect(MonthlyAttendanceSchema.safeParse({...doc, schemaVersion: 3}).success).toBe(false);
  });
});
