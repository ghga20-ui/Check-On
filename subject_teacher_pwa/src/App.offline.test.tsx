import { IDBFactory } from "fake-indexeddb";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// These tests exercise the IndexedDB-backed offline queue, so they need a real
// IndexedDB implementation (jsdom has none). A fresh factory per test keeps the
// stored queue from leaking between cases.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function saveAbsenceForFirstLesson(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /2-1 문학/ }));
  await user.click(screen.getByRole("button", { name: /^3번 / }));
  await user.click(screen.getByRole("button", { name: "저장" }));
}

describe("offline queue persistence in the app", () => {
  it("holds saves while disconnected and sends them after reconnect without losing marks", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi.fn().mockResolvedValue(undefined);
    const view = render(<App initialDate="2026-05-04" canSync={false} onSaveSlot={onSaveSlot} />);
    await saveAbsenceForFirstLesson(user);
    expect(onSaveSlot).not.toHaveBeenCalled();
    expect(screen.getByText("Drive 대기")).toBeInTheDocument();
    view.rerender(<App initialDate="2026-05-04" canSync onSaveSlot={onSaveSlot} />);
    await waitFor(() => expect(screen.getByText("Drive 완료")).toBeInTheDocument());
    expect(onSaveSlot).toHaveBeenCalledTimes(1);
    expect(onSaveSlot.mock.calls[0][2].absences[0].studentNumber).toBe(3);
  });
  it("keeps a conflicted draft and only overwrites after comparing the latest record", async () => {
    const user = userEvent.setup();
    const conflict = new Error("다른 기기에서 수정됐습니다.");
    conflict.name = "DriveConflictError";
    const onSaveSlot = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined);
    const latest = { absences: [{ studentNumber: 9, markType: "absent" as const, note: "" }],
      checkedAt: "2026-05-04T11:00:00Z", source: "pc" as const, syncedToNeis: false, closedOnNeis: false };
    const onLoadMonth = vi.fn().mockResolvedValue({ "2026-05-04": { "mon-3": latest } });
    render(<App initialDate="2026-05-04" initialMonth="2026-05" onSaveSlot={onSaveSlot} onLoadMonth={onLoadMonth} />);
    await saveAbsenceForFirstLesson(user);
    await waitFor(() => expect(screen.getByText("Drive 실패")).toBeInTheDocument());
    expect(onSaveSlot).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /최신 기록과 비교/ }));
    expect(await screen.findByRole("dialog", { name: "동시 수정 확인" })).toBeInTheDocument();
    expect(screen.getByText("Drive 최신 기록: 9번 결과")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "내 기록으로 다시 저장" }));
    await waitFor(() => expect(screen.getByText("Drive 완료")).toBeInTheDocument());
    expect(onSaveSlot.mock.calls[1][3]).toEqual(latest);
    expect(onSaveSlot.mock.calls[1][2].syncedToNeis).toBe(false);
  });

  it("can accept the remote record without another upload", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi.fn().mockRejectedValue(new Error("conflict"));
    const latest = { absences: [], checkedAt: "2026-05-04T11:00:00Z", source: "pc" as const,
      syncedToNeis: true, closedOnNeis: false };
    const onLoadMonth = vi.fn().mockResolvedValue({ "2026-05-04": { "mon-3": latest } });
    render(<App initialDate="2026-05-04" initialMonth="2026-05" onSaveSlot={onSaveSlot} onLoadMonth={onLoadMonth} />);
    await saveAbsenceForFirstLesson(user);
    await waitFor(() => expect(screen.getByText("Drive 실패")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /최신 기록과 비교/ }));
    await user.click(await screen.findByRole("button", { name: "최신 기록 사용" }));
    expect(onSaveSlot).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Drive 실패")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /2-1 문학/ }));
    expect(screen.getByRole("button", { name: /^3번 .* 출석$/ })).toBeInTheDocument();
  });
  it("restores a pending save after the app is reloaded", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App initialDate="2026-05-04" />);

    await saveAbsenceForFirstLesson(user);
    expect(screen.getByText("동기화 대기 1건")).toBeInTheDocument();

    // Let the persist effect flush to IndexedDB before unmounting.
    await waitFor(() => expect(screen.getByText("Drive 대기")).toBeInTheDocument());
    unmount();

    render(<App initialDate="2026-05-04" />);

    // After re-hydration the saved lesson and its pending status come back.
    await waitFor(() => expect(screen.getByText("동기화 대기 1건")).toBeInTheDocument());
    expect(screen.getByText("결과 1명")).toBeInTheDocument();
    expect(screen.getByText("Drive 대기")).toBeInTheDocument();
  });

  it("auto-retries a failed upload when the device comes back online", async () => {
    const user = userEvent.setup();
    const onSaveSlot = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<App initialDate="2026-05-04" onSaveSlot={onSaveSlot} />);

    await saveAbsenceForFirstLesson(user);
    await waitFor(() => expect(screen.getByText("Drive 실패")).toBeInTheDocument());
    // A failure surfaces a banner with a retry button right on the lessons page.
    expect(screen.getByText("저장 실패 1건이 있어요.")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(screen.getByText("Drive 완료")).toBeInTheDocument());
    expect(onSaveSlot).toHaveBeenCalledTimes(2);
  });

  it("shows an offline banner while disconnected and hides it on reconnect", async () => {
    render(<App initialDate="2026-05-04" />);
    expect(screen.queryByText(/인터넷에 연결되어 있지 않아요/)).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/인터넷에 연결되어 있지 않아요/)).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() =>
      expect(screen.queryByText(/인터넷에 연결되어 있지 않아요/)).not.toBeInTheDocument(),
    );
  });
});
