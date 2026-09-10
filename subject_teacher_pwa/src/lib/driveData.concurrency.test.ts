import { beforeEach, describe, expect, it, vi } from "vitest";
import { DriveConflictError, DriveError } from "./drive";
import type { SlotAttendance } from "./schemas";

const mocks = vi.hoisted(() => ({ read: vi.fn(), snapshot: vi.fn(), write: vi.fn() }));
vi.mock("./drive", async (original) => ({
  ...await original<typeof import("./drive")>(),
  readJson: mocks.read, readJsonSnapshot: mocks.snapshot, writeJsonSnapshot: mocks.write,
}));
import { saveSlotAttendance } from "./driveData";

const slot = (n: number): SlotAttendance => ({
  absences: [{ studentNumber: n, markType: "absent", note: "" }],
  checkedAt: "2026-09-09T10:00:00Z", source: "mobile", syncedToNeis: false, closedOnNeis: false,
});
const snapshot = (records: Record<string, SlotAttendance>, etag = '"v1"') => ({
  id: "month", etag, data: { schemaVersion: 1, month: "2026-09", records: { "2026-09-09": records } },
});

describe("conditional monthly writes", () => {
  beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); });
  it("retries a server conflict and keeps the other device's different slot", async () => {
    mocks.snapshot.mockResolvedValueOnce(snapshot({ a: slot(1) }))
      .mockResolvedValueOnce(snapshot({ a: slot(1), b: slot(2) }, '"v2"'));
    mocks.write.mockRejectedValueOnce(new DriveError(412, "changed")).mockResolvedValueOnce(undefined);
    await saveSlotAttendance("2026-09", "2026-09-09", "c", slot(3), null);
    expect(Object.keys(mocks.write.mock.calls[1][1].records["2026-09-09"])).toEqual(["a", "b", "c"]);
    expect(mocks.write.mock.calls[1][2].etag).toBe('"v2"');
  });
  it("does not overwrite a competing edit of the same slot", async () => {
    mocks.snapshot.mockResolvedValueOnce(snapshot({ a: slot(1) }))
      .mockResolvedValueOnce(snapshot({ a: slot(9) }, '"v2"'));
    mocks.write.mockRejectedValueOnce(new DriveError(412, "changed"));
    await expect(saveSlotAttendance("2026-09", "2026-09-09", "a", slot(2), slot(1)))
      .rejects.toBeInstanceOf(DriveConflictError);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("retains an offline draft instead of overwriting a newer remote edit", async () => {
    mocks.snapshot.mockResolvedValue(snapshot({ a: slot(9) }));
    await expect(saveSlotAttendance("2026-09", "2026-09-09", "a", slot(2), slot(1)))
      .rejects.toBeInstanceOf(DriveConflictError);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("accepts a retry whose earlier response was lost", async () => {
    mocks.snapshot.mockResolvedValue(snapshot({ a: slot(2) }));
    await saveSlotAttendance("2026-09", "2026-09-09", "a", slot(2), slot(1));
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not retry authentication errors", async () => {
    mocks.snapshot.mockResolvedValue(snapshot({}));
    mocks.write.mockRejectedValue(new DriveError(401, "expired"));
    await expect(saveSlotAttendance("2026-09", "2026-09-09", "a", slot(1))).rejects.toBeInstanceOf(DriveError);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
});
