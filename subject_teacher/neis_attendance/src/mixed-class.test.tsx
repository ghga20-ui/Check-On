// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MixedClassPanel, emptyMixedDocument, mixedDiff, validateMixedRows, matchesMixedGroup } from "./mixed-class";
import { ClassSheet } from "./run-view";

afterEach(cleanup);
const students = [
  { studentId: "uuid-a", grade: 2, homeClassNo: "1", number: 5, name: "가상A" },
  { studentId: "uuid-b", grade: 2, homeClassNo: "3", number: 5, name: "가상B" },
];
const group = { id: "group-a", grade: 2, classNo: "선택A", subjectName: "문학", neisSubjectLabel: "문학", revision: 2, students };
function setup(overrides: any = {}) {
  const props = { document: emptyMixedDocument, encryptionEnabled: true, onSave: vi.fn().mockResolvedValue({}), onImport: vi.fn().mockResolvedValue({ rows: students }), onBind: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), ...overrides };
  render(<MixedClassPanel {...props}/>); return props;
}
function begin() {
  fireEvent.click(screen.getByLabelText("여러 반 학생이 섞인 수업"));
  fireEvent.click(screen.getByText("혼합수업 만들기"));
  fireEvent.change(screen.getByLabelText("수업 집단"), { target: { value: "선택A" } });
  fireEvent.change(screen.getByLabelText("혼합수업 과목명"), { target: { value: "문학" } });
}
describe("혼합수업 설정", () => {
  it("같은 번호의 다른 반을 허용하고 동일 학생·다른 학년·누락을 차단합니다", () => {
    expect(validateMixedRows(students, 2)).toEqual(["", ""]);
    expect(validateMixedRows([students[0], students[0]], 2).every(Boolean)).toBe(true);
    expect(validateMixedRows([{ ...students[0], grade: 1 }], 2)[0]).toMatch(/학년/);
    expect(validateMixedRows([{ ...students[0], number: "" }], 2)[0]).toMatch(/번호/);
    expect(validateMixedRows([{ ...students[0], number: 99 }], 2)).toEqual([""]);
    expect(validateMixedRows([{ ...students[0], number: 100 }], 2)[0]).toMatch(/1~99/);
  });
  it("실제 파일 API의 문자열 학년·번호를 받아 정상 미리보기와 숫자 저장을 제공합니다", async () => {
    const props = setup({ onImport: vi.fn().mockResolvedValue({ rows: [
      { grade: "2", homeClassNo: "1", number: "5", name: "합성학생", rawStudentNumber: "20105" },
    ] }) });
    begin(); fireEvent.click(screen.getByText("CSV/XLSX 가져오기 미리보기"));
    await screen.findByDisplayValue("합성학생");
    expect(screen.queryByText("수업 학년과 다릅니다")).not.toBeInTheDocument();
    expect(screen.getByText("변경 확인")).toBeEnabled();
    fireEvent.click(screen.getByText("변경 확인")); fireEvent.click(screen.getByText("변경 적용"));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave.mock.calls[0][0].students).toEqual([{ grade: 2, homeClassNo: "1", number: 5, name: "합성학생" }]);
  });
  it("가져온 100번은 행 오류를 표시하고 99번으로 수정한 뒤 확인할 수 있습니다", async () => {
    setup({ onImport: vi.fn().mockResolvedValue({ rows: [{ grade: "2", homeClassNo: "1", number: "100" }] }) });
    begin(); fireEvent.click(screen.getByText("CSV/XLSX 가져오기 미리보기"));
    await screen.findByText("번호는 1~99로 입력해 주세요");
    expect(screen.getByText("변경 확인")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("1행 number"), { target: { value: "99" } });
    expect(screen.getByText("변경 확인")).toBeEnabled();
  });
  it("미리보기 후 명시적 확인으로 revision과 함께 저장합니다", async () => {
    const props = setup(); begin();
    fireEvent.click(screen.getByText("CSV/XLSX 가져오기 미리보기"));
    await screen.findByDisplayValue("가상A");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("명부 변경 비교")).toHaveTextContent("추가 2명");
    fireEvent.click(screen.getByText("변경 확인"));
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("변경 적용"));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave.mock.calls[0][0]).toMatchObject({ expectedRevision: 0, grade: 2, classNo: "선택A", students: [{ homeClassNo: "1", number: 5 }, { homeClassNo: "3", number: 5 }] });
  });
  it("가져오기 취소와 전체 취소는 원본 및 저장을 변경하지 않습니다", async () => {
    const props = setup({ document: { ...emptyMixedDocument, revision: 4, groups: { [group.id]: group } }, onImport: vi.fn().mockResolvedValue({ cancelled: true }) });
    fireEvent.click(screen.getByText("명부 수정·가져오기"));
    fireEvent.click(screen.getByText("CSV/XLSX 가져오기 미리보기"));
    await waitFor(() => expect(screen.getByText("취소")).toBeEnabled());
    expect(screen.getByDisplayValue("가상A")).toBeInTheDocument();
    fireEvent.click(screen.getByText("취소"));
    expect(props.onSave).not.toHaveBeenCalled(); expect(group.students).toEqual(students);
  });
  it("원본 학번을 보존하고 잘못된 행 수정 전 적용을 차단합니다", async () => {
    setup({ onImport: vi.fn().mockResolvedValue({ rows: [{ grade: 2, homeClassNo: "", number: "", rawStudentNumber: "001234" }] }) }); begin();
    fireEvent.click(screen.getByText("CSV/XLSX 가져오기 미리보기"));
    await screen.findByText("001234");
    expect(screen.getByText("변경 확인")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("1행 homeClassNo"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("1행 number"), { target: { value: "5" } });
    expect(screen.getByText("변경 확인")).toBeEnabled();
  });
  it("암호화 미완료 시 미리보기만 허용합니다", async () => {
    const props = setup({ encryptionEnabled: false }); begin();
    fireEvent.click(screen.getByText("CSV/XLSX 가져오기 미리보기")); await screen.findByDisplayValue("가상A");
    expect(screen.getByText("변경 확인")).toBeDisabled(); expect(props.onSave).not.toHaveBeenCalled();
  });
  it("재가져오기 추가·유지·제외·정보변경을 비교하며 연결은 정확한 과목별 집단입니다", () => {
    expect(mixedDiff(students, [{ ...students[0], name: "새이름" }, { ...students[1], number: 6 }])).toEqual({ added: 1, kept: 0, removed: 1, changed: 1 });
    expect(matchesMixedGroup(group, { grade: 2, classNo: "선택A", subject: "문학" })).toBe(true);
    expect(matchesMixedGroup(group, { grade: 2, classNo: "선택A", subject: "영어" })).toBe(false);
    const props = setup({ document: { ...emptyMixedDocument, groups: { [group.id]: group } } });
    fireEvent.click(screen.getByText("수업에 연결")); expect(props.onBind).toHaveBeenCalledWith(group);
  });
  it("오래된 저장 실패는 편집 초안과 처음 읽은 revision을 유지합니다", async () => {
    const props = setup({ document: { ...emptyMixedDocument, revision: 7, groups: { [group.id]: group } }, onSave: vi.fn().mockRejectedValue(new Error("명부가 변경되었습니다. 다시 불러오세요.")) });
    fireEvent.click(screen.getByText("명부 수정·가져오기")); fireEvent.click(screen.getByText("변경 확인")); fireEvent.click(screen.getByText("변경 적용"));
    await screen.findByText("명부가 변경되었습니다. 다시 불러오세요.");
    expect(screen.getByDisplayValue("가상A")).toBeInTheDocument(); expect(props.onSave.mock.calls[0][0].expectedRevision).toBe(7);
  });
});
it("PC 출결은 다른 반의 같은 번호를 UUID로 저장하고 원소속을 요약합니다", async () => {
  const save = vi.fn().mockResolvedValue({});
  const slot = { id: "slot", groupId: group.id, rosterRevision: 2, mixedStudents: students, grade: 2, classNo: "선택A", subject: "문학", period: 1 };
  render(<ClassSheet slot={slot} rosters={{}} onClose={vi.fn()} onSaveMarks={save} currentMarks={{}} appendLog={vi.fn()}/>);
  const rowA = screen.getByText("1반 5번").closest(".stu-row")!;
  const rowB = screen.getByText("3반 5번").closest(".stu-row")!;
  fireEvent.click(within(rowA as HTMLElement).getByText("결과"));
  fireEvent.click(within(rowB as HTMLElement).getByText("인정결과"));
  expect(screen.getByText("1반 5번 결과, 3반 5번 인정결과")).toBeInTheDocument();
  fireEvent.click(screen.getByText("저장"));
  await waitFor(() => expect(save).toHaveBeenCalledWith("slot", { "uuid-a": "absent", "uuid-b": "excused" }, expect.anything(), slot));
});
