"""Three-way attendance merge. A conflict must never become a silent overwrite."""
from copy import deepcopy


class DriveConflictError(RuntimeError):
    code = "attendance_conflict"


def merge_records(base: dict, desired: dict, latest: dict) -> dict:
    merged = deepcopy(latest)
    for day in base.keys() | desired.keys():
        before, after = base.get(day, {}), desired.get(day, {})
        for slot in before.keys() | after.keys():
            old, new = before.get(slot), after.get(slot)
            if old == new:
                continue
            current = latest.get(day, {}).get(slot)
            if current != old and current != new:
                raise DriveConflictError(
                    f"{day} 수업({slot})이 다른 기기에서 변경됐습니다. "
                    "저장하지 않았습니다. 최신 기록을 불러온 뒤 확인해 주세요."
                )
            merged.setdefault(day, {})
            if new is None:
                merged[day].pop(slot, None)
            else:
                merged[day][slot] = deepcopy(new)
    return merged
