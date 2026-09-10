vi.mock("./lib/accountGuard", async (original) => ({ ...await original<typeof import("./lib/accountGuard")>(), ensureAccount: vi.fn().mockResolvedValue(undefined) }));
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MixedGroupsSchema } from "./lib/schemas";
import { loadAll } from "./lib/driveData";
import Root from "./Root";

const fixture = vi.hoisted(() => {
  const id = "00000000-0000-4000-8000-000000000001";
  const students = [
    {studentId: "00000000-0000-4000-8000-000000000002", grade: 2, homeClassNo: "1", number: 5},
    {studentId: "00000000-0000-4000-8000-000000000003", grade: 2, homeClassNo: "3", number: 5},
  ];
  return {id, document: {schemaVersion: 1, revision: 2, groups: {[id]: {
    id, grade: 2, classNo: "선택A", subjectName: "문학", neisSubjectLabel: "", revision: 2,
    students, history: {"1": [students[0]], "2": students},
  }}}};
});
vi.mock("./lib/auth", () => ({
  usesServerAuth: false,
  restoreSession: vi.fn(),
  AUTH_CHANGED: "auth", hasValidAccessToken: () => true, initAuth: async () => {},
  isConfigured: () => true, requestAccessToken: async () => "synthetic-token", revoke: async () => {},
}));
vi.mock("./lib/localCache", () => ({loadDriveCache: async () => null, saveDriveCache: async () => {}, clearDriveCache: async () => {}}));
vi.mock("./lib/drive", async original => ({
  ...await original<typeof import("./lib/drive")>(),
  readJson: async (name: string) => {
    if (name === "mixed-groups.json") return {id: "groups-file", data: fixture.document};
    if (name === "timetable.json") return {id: "timetable-file", data: {
      schemaVersion: 1, effectiveFrom: "2026-09-01",
      slots: [{id: "mixed", dayOfWeek: 4, period: 1, grade: 2, classNo: "선택A", subjectName: "문학", neisSubjectLabel: "문학"}],
    }};
    return null;
  },
  readJsonSnapshot: async () => ({id: null, etag: null, data: null}),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Python 문자열 원소속 반 계약", () => {
  it("현재 명부와 모든 이력의 문자열 반을 숫자로 정규화하며 잘못된 값은 거부합니다", () => {
    const group = MixedGroupsSchema.parse(fixture.document).groups[fixture.id];
    expect(group.students.map(s => s.homeClassNo)).toEqual([1, 3]);
    expect(group.history["1"][0].homeClassNo).toBe(1);
    expect(group.history["2"].map(s => s.homeClassNo)).toEqual([1, 3]);
    for (const homeClassNo of ["", "0", "1.5", "01", true, null]) {
      const bad = structuredClone(fixture.document);
      Object.assign(Object.values(bad.groups)[0].students[0], {homeClassNo});
      expect(MixedGroupsSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("실제 loadAll에서 읽은 Python 형태 명부가 Root의 반별 학생 버튼까지 전달됩니다", async () => {
    const loaded = await loadAll("2026-09");
    expect(loaded.mixedGroups?.groups[fixture.id].students[1].homeClassNo).toBe(3);
    // Keep real timers for React; only freeze the system date used by Root.
    vi.useFakeTimers({toFake: ["Date"]});
    vi.setSystemTime(new Date("2026-09-10T12:00:00+09:00"));
    render(<Root/>);
    fireEvent.click(await screen.findByRole("button", {name: /Google 계정으로 시작하기/}));
    fireEvent.click(await screen.findByRole("button", {name: /선택A.*열기/}));
    expect(screen.getByRole("button", {name: "1반 5번 출석"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "3반 5번 출석"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "3반"}));
    expect(screen.queryByRole("button", {name: "1반 5번 출석"})).not.toBeInTheDocument();
  });
});
