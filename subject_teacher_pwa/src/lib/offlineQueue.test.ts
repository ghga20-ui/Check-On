import { describe, expect, it } from "vitest";
import { enqueueSave, failedItems, markStatusByTarget, markSynced, pendingItems } from "./offlineQueue";

const blankPayload = {
  absences: [],
  checkedAt: "2026-05-04T10:55:00+09:00",
  source: "mobile" as const,
  syncedToNeis: false,
  closedOnNeis: false,
};

describe("offline queue state", () => {
  it("does not mark a newer draft synced when an older upload completes", () => {
    const queue = enqueueSave([], { date: "2026-05-04", slotId: "mon-3", payload: blankPayload, baseline: null });
    const newer = enqueueSave(queue, { date: "2026-05-04", slotId: "mon-3",
      payload: { ...blankPayload, checkedAt: "2026-05-04T11:00:00Z" }, baseline: null });
    const result = markStatusByTarget(newer, "2026-05-04", "mon-3", "synced", blankPayload.checkedAt);
    expect(result[0].status).toBe("pending");
    expect(result[0].baseline).toBeNull();
  });
  it("stores pending saves in insertion order and marks them synced", () => {
    const first = enqueueSave([], {
      date: "2026-05-04",
      slotId: "mon-3",
      payload: { absences: [], checkedAt: "2026-05-04T10:55:00+09:00", source: "mobile", syncedToNeis: false, closedOnNeis: false },
    });
    const second = enqueueSave(first, {
      date: "2026-05-04",
      slotId: "mon-6",
      payload: { absences: [{ studentNumber: 1, markType: "absent", note: "" }], checkedAt: "2026-05-04T15:40:00+09:00", source: "mobile", syncedToNeis: false, closedOnNeis: false },
    });

    expect(pendingItems(second).map((item) => item.slotId)).toEqual(["mon-3", "mon-6"]);

    const afterSync = markSynced(second, second[0].id);
    expect(pendingItems(afterSync).map((item) => item.slotId)).toEqual(["mon-6"]);
  });

  it("replaces a pending save for the same date and slot", () => {
    const first = enqueueSave([], {
      date: "2026-05-04",
      slotId: "mon-3",
      payload: { absences: [], checkedAt: "2026-05-04T10:55:00+09:00", source: "mobile", syncedToNeis: false, closedOnNeis: false },
    });

    const replaced = enqueueSave(first, {
      date: "2026-05-04",
      slotId: "mon-3",
      payload: {
        absences: [{ studentNumber: 3, markType: "absent", note: "" }],
        checkedAt: "2026-05-04T10:58:00+09:00",
        source: "mobile",
        syncedToNeis: false,
        closedOnNeis: false,
      },
    });

    expect(pendingItems(replaced)).toHaveLength(1);
    expect(pendingItems(replaced)[0].payload.absences).toEqual([
      { studentNumber: 3, markType: "absent", note: "" },
    ]);
  });

  it("resolves a pending save to synced by date and slot", () => {
    const queue = enqueueSave([], { date: "2026-05-04", slotId: "mon-3", payload: blankPayload });
    const synced = markStatusByTarget(queue, "2026-05-04", "mon-3", "synced");

    expect(pendingItems(synced)).toHaveLength(0);
    expect(synced[0].status).toBe("synced");
    expect(synced[0].syncedAt).toBeTruthy();
  });

  it("retries a previously failed save for the same target", () => {
    const queue = enqueueSave([], { date: "2026-05-04", slotId: "mon-3", payload: blankPayload });
    const failed = markStatusByTarget(queue, "2026-05-04", "mon-3", "failed");
    expect(failedItems(failed)).toHaveLength(1);

    const recovered = markStatusByTarget(failed, "2026-05-04", "mon-3", "synced");
    expect(failedItems(recovered)).toHaveLength(0);
    expect(recovered[0].status).toBe("synced");
  });

  it("leaves other targets untouched", () => {
    const first = enqueueSave([], { date: "2026-05-04", slotId: "mon-3", payload: blankPayload });
    const second = enqueueSave(first, { date: "2026-05-04", slotId: "mon-6", payload: blankPayload });
    const synced = markStatusByTarget(second, "2026-05-04", "mon-3", "synced");

    expect(pendingItems(synced).map((item) => item.slotId)).toEqual(["mon-6"]);
  });
});
