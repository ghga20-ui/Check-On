"""Multiple dates share one login; a failed day stops further navigation."""
from datetime import date

import config
import regions
import utils
from subject_teacher.app_service import create_driver, update_flags
from subject_teacher.attendance_history import load_history
from subject_teacher.neis.runner import DayInput, process_day
from subject_teacher.state import build_store


def run_range(start, end, password, expected_token, *, on_progress=None, keep_browser_open=True):
    if (date.fromisoformat(end) - date.fromisoformat(start)).days > 92:
        raise ValueError("일괄 반영은 한 번에 최대 93일까지 선택해 주세요.")
    store = build_store()
    history = load_history(store, start, end, include_records=True)
    if history["token"] != expected_token:
        raise ValueError("조회 후 기록 또는 설정이 바뀌었습니다. 최신 내역을 다시 조회하고 확인해 주세요.")
    pending = [r for r in history["rows"] if not r["synced"]]
    if not pending:
        return []
    if any(not r["resolvable"] for r in pending):
        raise ValueError("학급을 확인할 수 없는 이전 수업이 있습니다. 해당 기록을 먼저 확인해 주세요.")
    settings = history["_settings"]
    if settings.region not in regions.REGIONS or any(int(r["date"][:4]) != settings.semester.year for r in pending):
        raise ValueError("선택한 기록의 연도와 기본 정보의 학년도를 확인해 주세요.")
    config.selected_region = settings.region
    dates = sorted({r["date"] for r in pending})
    results = []
    driver = create_driver(keep_browser_open=keep_browser_open)
    try:
        utils.open_neis_direct(driver, password)
        for index, day in enumerate(dates):
            if on_progress:
                on_progress(index, len(dates), day, "running")
            # Re-read each day: a mobile edit during login must not silently enter NEIS.
            current = load_history(store, start, end, include_records=True)
            if current["contentToken"] != history["contentToken"]:
                raise ValueError("반영 중 기록이 변경되어 중단했습니다. 최신 내역을 확인해 주세요.")
            groups = current["_groups"]
            pairs = []
            for slot_id, (slot, record) in current["_records"].get(day, {}).items():
                if record.synced_to_neis:
                    continue
                if slot is None:
                    raise ValueError("시간표가 바뀌었습니다. 최신 기록을 확인해 주세요.")
                pairs.append((slot, record))
            pairs.sort(key=lambda pair: pair[0].period)
            expected = {slot.id: record.model_copy(deep=True) for slot, record in pairs}
            def update(slot_id, synced, closed):
                update_flags(store, day[:7], slot_id, day, synced, closed, expected=expected[slot_id])
            day_results = process_day(driver, DayInput(day, settings.semester.year, settings.semester.term, pairs, groups),
                                      close_after=False, on_update=update, strict_date=True, reuse_page=index > 0)
            results.extend({"date": day, "slotId": r.slot_id, "status": r.status, "error": r.error} for r in day_results)
            if on_progress:
                on_progress(index + 1, len(dates), day, "running")
            if any(r.status == "failed" for r in day_results):
                break
        return results
    finally:
        if not keep_browser_open:
            driver.quit()
