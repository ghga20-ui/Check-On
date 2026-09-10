import { beforeEach, describe, expect, it, vi } from "vitest";

const readJson = vi.fn();
const writeJson = vi.fn();

vi.mock("./drive", () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  readJsonSnapshot: async (...args: unknown[]) => (await readJson(...args)) ?? { id: null, data: null, etag: null },
  writeJsonSnapshot: (...args: unknown[]) => writeJson(...args),
}));

import { FILE_NAMES, loadSettings, saveSlotAttendance } from "./driveData";
import type { SlotAttendance } from "./schemas";

const absentSlot: SlotAttendance = {
  absences: [{ studentNumber: 3, markType: "absent", note: "" }],
  checkedAt: "2026-05-04T10:55:00+09:00",
  source: "mobile",
  syncedToNeis: false,
  closedOnNeis: false,
};

describe("driveData", () => {
  beforeEach(() => {
    readJson.mockReset();
    writeJson.mockReset();
  });

  it("returns null when settings.json is missing", async () => {
    readJson.mockResolvedValue(null);
    expect(await loadSettings()).toBeNull();
    expect(readJson).toHaveBeenCalledWith(FILE_NAMES.settings);
  });

  it("validates settings through the shared schema", async () => {
    readJson.mockResolvedValue({
      id: "id1",
      data: {
        schemaVersion: 1,
        teacherName: "홍길동",
        schoolName: "나이스고",
        region: "경기",
        semester: { year: 2026, term: 1 },
        closeByDefault: false,
        updatedAt: "2026-05-04T09:00:00+09:00",
      },
    });
    const settings = await loadSettings();
    expect(settings?.teacherName).toBe("홍길동");
  });

  it("creates a new monthly file when none exists", async () => {
    readJson.mockResolvedValue(null);
    writeJson.mockResolvedValue("new-id");

    await saveSlotAttendance("2026-05", "2026-05-04", "mon-3", absentSlot);

    expect(writeJson).toHaveBeenCalledTimes(1);
    const [name, doc, existingId] = writeJson.mock.calls[0];
    expect(name).toBe("attendance-2026-05.json");
    expect(existingId.id).toBeNull();
    expect(doc.records["2026-05-04"]["mon-3"].absences).toHaveLength(1);
    expect(doc.month).toBe("2026-05");
  });

  it("merges into an existing monthly file without dropping other slots", async () => {
    readJson.mockResolvedValue({
      id: "month-id",
      data: {
        schemaVersion: 1,
        month: "2026-05",
        records: {
          "2026-05-04": {
            "mon-1": {
              absences: [],
              checkedAt: "2026-05-04T09:00:00+09:00",
              source: "mobile",
              syncedToNeis: false,
              closedOnNeis: false,
            },
          },
        },
      },
    });
    writeJson.mockResolvedValue("month-id");

    await saveSlotAttendance("2026-05", "2026-05-04", "mon-3", absentSlot);

    const [, doc, existingId] = writeJson.mock.calls[0];
    expect(existingId.id).toBe("month-id");
    expect(Object.keys(doc.records["2026-05-04"]).sort()).toEqual(["mon-1", "mon-3"]);
  });
});
