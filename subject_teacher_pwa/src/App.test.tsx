import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mobile app", () => {
  it("shows today's lessons and saves a lesson attendance draft", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    expect(screen.getByRole("heading", { name: "오늘 수업" })).toBeInTheDocument();
    expect(screen.getByText("3교시")).toBeInTheDocument();
    expect(screen.getByText("2-1 문학")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    expect(screen.getByRole("heading", { name: "2-1 문학" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^3번 / }));
    expect(screen.getByText("저장 전 요약")).toBeInTheDocument();
    expect(screen.getByText("3번 결과")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByText("결과 1명")).toBeInTheDocument();
    expect(screen.getByText("동기화 대기 1건")).toBeInTheDocument();
    expect(screen.getByText("Drive 대기")).toBeInTheDocument();
    expect(screen.getByText("NEIS 미반영")).toBeInTheDocument();
    expect(screen.getByText(/마지막 저장/)).toBeInTheDocument();
  });

  it("renders the roster as a number-chip grid; a tap toggles 출석↔결과", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));

    const chip = screen.getByRole("button", { name: "3번 김도윤 출석" });
    expect(chip).toHaveClass("chip");
    expect(chip.parentElement).toHaveClass("chip-grid");

    await user.click(chip);
    const marked = screen.getByRole("button", { name: "3번 김도윤 결과" });
    expect(marked).toHaveAttribute("aria-pressed", "true");
    expect(marked).toHaveAttribute("data-mark", "absent");

    // A separate tap after the double-tap window toggles back to 출석.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 500);
    await user.click(marked);
    clock.mockRestore();
    expect(screen.getByRole("button", { name: "3번 김도윤 출석" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks 인정결과 with two consecutive taps on a chip", () => {
    vi.useFakeTimers();
    try {
      render(<App initialDate="2026-05-04" />);
      fireEvent.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));

      const chip = screen.getByRole("button", { name: "3번 김도윤 출석" });
      fireEvent.click(chip);
      act(() => { vi.advanceTimersByTime(150); });
      fireEvent.click(chip);

      const marked = screen.getByRole("button", { name: "3번 김도윤 인정결과" });
      expect(marked).toHaveAttribute("data-mark", "excused");
      expect(screen.getByText("3번 인정결과")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards the draft on cancel after one confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    expect(screen.getByText("3번 결과")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(confirmSpy).toHaveBeenCalledWith("변경 내용을 버릴까요?");

    // Reopening shows the draft was discarded, not kept.
    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    expect(screen.getByText("저장하면 전원 출석")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3번 김도윤 출석" })).toBeInTheDocument();
  });

  it("keeps the sheet open when the discard confirmation is refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.getByRole("heading", { name: "2-1 문학" })).toBeInTheDocument();
    expect(screen.getByText("3번 결과")).toBeInTheDocument();
  });

  it("closes without confirmation when nothing changed (backdrop tap too)", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    const dialog = screen.getByRole("dialog", { name: /2-1 문학 출결 입력/ });
    await user.click(dialog.parentElement as HTMLElement); // backdrop

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /출결 입력/ })).not.toBeInTheDocument();
  });

  it("saves 전원 출석 in one tap from an unchecked lesson card", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi.fn().mockResolvedValue(undefined);
    render(<App initialDate="2026-05-04" onSaveSlot={onSaveSlot} />);

    await user.click(screen.getAllByRole("button", { name: "전원 출석으로 저장" })[0]);

    await waitFor(() => expect(screen.getByText("전원 출석")).toBeInTheDocument());
    expect(onSaveSlot).toHaveBeenCalledWith(
      "2026-05-04",
      "mon-3",
      expect.objectContaining({ absences: [], source: "mobile" }),
      null,
    );
  });

  it("shows a synced record's absences in the roster view (desktop-checked)", async () => {
    // Regression: a record loaded from Drive showed its count in the lesson
    // list but the roster opened all-present (and saving wiped the record).
    const user = userEvent.setup();
    render(
      <App
        initialDate="2026-05-04"
        initialAttendance={{
          "2026-05-04": {
            "mon-3": {
              absences: [{ studentNumber: 3, markType: "absent", note: "" }],
              checkedAt: "2026-05-04T10:55:00+09:00",
              source: "pc",
              syncedToNeis: false,
              closedOnNeis: false,
            },
          },
        }}
      />,
    );

    expect(screen.getByText(/결과.*1명/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));

    expect(screen.getByRole("button", { name: "3번 김도윤 결과" })).toBeInTheDocument();
    expect(screen.getByText("3번 결과")).toBeInTheDocument();
  });

  it("lets the teacher change the working date relative to the selected day", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /날짜 선택/ }));
    expect(screen.getByRole("dialog", { name: "날짜 선택" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "내일" }));

    expect(screen.getByText("5월 5일 화요일")).toBeInTheDocument();
    expect(screen.getByText("선택한 날짜에 표시할 수업이 없습니다.")).toBeInTheDocument();

    // 내일 moves from the *selected* date (05-05 → 05-06), not from the anchor.
    await user.click(screen.getByRole("button", { name: /날짜 선택/ }));
    await user.click(screen.getByRole("button", { name: "내일" }));
    expect(screen.getByText("5월 6일 수요일")).toBeInTheDocument();
  });

  it("recomputes the real today when '오늘' is tapped (no stale anchor)", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /날짜 선택/ }));
    const sheet = screen.getByRole("dialog", { name: "날짜 선택" });
    await user.click(within(sheet).getByRole("button", { name: "오늘" }));

    const now = new Date();
    expect(
      screen.getByText(new RegExp(`^${now.getMonth() + 1}월 ${now.getDate()}일`)),
    ).toBeInTheDocument();
  });

  it("keeps saved attendance scoped to the selected date", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("결과 1명")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /날짜 선택/ }));
    const dateInput = screen.getByLabelText("직접 날짜 선택");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-05-11");
    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.getAllByText("미확인")).toHaveLength(3);
    expect(screen.queryByText("결과 1명")).not.toBeInTheDocument();
  });

  it("shows a month calendar with day status in the 기록 tab", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    await user.click(screen.getByRole("button", { name: "기록" }));

    expect(screen.getByRole("heading", { name: "기록" })).toBeInTheDocument();
    expect(screen.getByText("2026년 5월")).toBeInTheDocument();
    // 05-04 has 1/3 checked → 미확인 dot; the selected day's lessons render below.
    expect(screen.getByRole("button", { name: "2026-05-04 미확인" })).toBeInTheDocument();
    expect(screen.getByText("5월 4일 월요일")).toBeInTheDocument();
    expect(screen.getByText("결과 1명")).toBeInTheDocument();

    // Month navigation updates the grid title.
    await user.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByText("2026년 4월")).toBeInTheDocument();
  });

  it("shows read-only timetable and roster confirmation in settings", async () => {
    const user = userEvent.setup();
    render(<App initialDate="2026-05-04" />);

    await user.click(screen.getByRole("button", { name: "설정" }));

    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByText("편집은 PC(데스크톱 앱)에서 합니다.")).toBeInTheDocument();
    expect(screen.getByText("3교시 · 2-1 문학")).toBeInTheDocument();
    expect(screen.getByText("2-1 · 5명")).toBeInTheDocument();
    expect(screen.getByText("계정")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "설정 닫기" }));
    expect(screen.queryByRole("heading", { name: "설정" })).not.toBeInTheDocument();
  });

  it("loads another month's attendance when navigating across months", async () => {
    const user = userEvent.setup();
    const onLoadMonth = vi.fn().mockResolvedValue({
      "2026-04-06": {
        "mon-3": {
          absences: [{ studentNumber: 3, markType: "absent", note: "" }],
          checkedAt: "2026-04-06T10:55:00+09:00",
          source: "mobile",
          syncedToNeis: false,
          closedOnNeis: false,
        },
      },
    });
    render(<App initialDate="2026-05-04" initialMonth="2026-05" onLoadMonth={onLoadMonth} />);

    // Same-month navigation must not trigger a fetch.
    await user.click(screen.getByRole("button", { name: /날짜 선택/ }));
    const dateInput = screen.getByLabelText("직접 날짜 선택");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-04-06");
    await user.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(onLoadMonth).toHaveBeenCalledWith("2026-04"));
    // The loaded April record now renders for the selected April date.
    await waitFor(() => expect(screen.getByText("결과 1명")).toBeInTheDocument());
  });

  it("marks a save as Drive 완료 when onSaveSlot resolves", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi.fn().mockResolvedValue(undefined);
    render(<App initialDate="2026-05-04" onSaveSlot={onSaveSlot} />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText("Drive 완료")).toBeInTheDocument());
    expect(onSaveSlot).toHaveBeenCalledWith(
      "2026-05-04",
      "mon-3",
      expect.objectContaining({ source: "mobile", syncedToNeis: false }),
      null,
    );
  });

  it("keeps the toast honest: 반영 중 stays until Drive really resolves", async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onSaveSlot = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<App initialDate="2026-05-04" onSaveSlot={onSaveSlot} />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    // No premature "saved" message while Drive is still pending.
    expect(screen.getByText("기기 저장 완료 · 동기화 중")).toBeInTheDocument();
    expect(screen.queryByText("저장 완료")).not.toBeInTheDocument();

    await act(async () => {
      resolveSave();
    });
    await waitFor(() => expect(screen.getByText("저장 완료")).toBeInTheDocument());
  });

  it("transitions the toast to a failure message when Drive rejects", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi.fn().mockRejectedValue(new Error("network"));
    render(<App initialDate="2026-05-04" onSaveSlot={onSaveSlot} />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(screen.getAllByText("저장 실패 — 아래에서 다시 시도").length).toBeGreaterThan(0),
    );
  });

  it("offers a retry when onSaveSlot rejects", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    render(<App initialDate="2026-05-04" onSaveSlot={onSaveSlot} />);

    await user.click(screen.getByRole("button", { name: /2-1 문학.*열기/ }));
    await user.click(screen.getByRole("button", { name: /^3번 / }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    // The lessons-page failure banner offers the retry (the 동기화 tab is gone).
    const retry = await screen.findByRole("button", { name: "다시 시도" });
    await user.click(retry);

    await waitFor(() => expect(screen.getByText("Drive 완료")).toBeInTheDocument());
    expect(onSaveSlot).toHaveBeenCalledTimes(2);
  });

  it("surfaces the stale badge and refresh action when rendering a cached copy", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<App initialDate="2026-05-04" stale onRefresh={onRefresh} />);

    expect(screen.getByText("저장된 사본")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새로 불러오기" }));
    expect(onRefresh).toHaveBeenCalled();
  });
});
