"""Reusable service layer shared by the CLI runner and the GUI."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date as date_type

import config
import regions
import utils
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from subject_teacher.drive.store import DriveStore
from subject_teacher.drive.concurrency import DriveConflictError
from subject_teacher.drive.schemas import Settings, TimetableSlot
from subject_teacher.neis.runner import DayInput, SlotResult, process_day
from subject_teacher.neis_open_api import parse_neis_slot_id
from subject_teacher.state import build_store


def _adhoc_slot_from_id(slot_id: str, weekday: int) -> TimetableSlot | None:
    """Reconstruct a one-off (보강) timetable slot from its ``neis-*`` id.

    Lets the run write attendance for a substitute class that the teacher added
    on the day, without that class living in the stored weekly timetable.
    The NEIS period row is matched by period + 학년·반 (subject optional), so an
    empty ``neis_subject_label`` is fine.
    """
    parsed = parse_neis_slot_id(slot_id)
    if parsed is None:
        return None
    grade, class_no, period = parsed
    if not (1 <= grade <= 3) or not (1 <= period <= 7) or not class_no:
        return None
    try:
        return TimetableSlot(
            id=slot_id,
            dayOfWeek=weekday,
            period=period,
            grade=grade,
            classNo=class_no,
            subjectName="보강",
            neisSubjectLabel="",
        )
    except Exception:
        return None


@dataclass
class RunContext:
    store: DriveStore
    settings: Settings
    day_input: DayInput
    region_key: str


def create_driver(keep_browser_open: bool = False):
    options = Options()
    profile_dir = os.path.join(os.path.expanduser("~"), "AppData", "Local", "Chrome_NEIS_Profile")
    os.makedirs(profile_dir, exist_ok=True)
    options.add_argument(f"--user-data-dir={profile_dir}")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    if keep_browser_open:
        options.add_experimental_option("detach", True)
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-popup-blocking")
    return webdriver.Chrome(options=options)


def build_day_input(store: DriveStore, settings: Settings, date_str: str) -> DayInput:
    timetable = store.load_timetable()
    if timetable is None:
        raise RuntimeError("timetable.json not found in Drive appDataFolder")

    month = date_str[:7]
    monthly = store.load_monthly(month)
    if monthly is None or date_str not in monthly.records:
        raise RuntimeError(f"no attendance records for {date_str}")

    weekday = date_type.fromisoformat(date_str).isoweekday()
    day_map = monthly.records[date_str]

    pairs = []
    timetable_ids = set()
    for slot in timetable.slots:
        timetable_ids.add(slot.id)
        if slot.day_of_week != weekday:
            continue
        attendance = day_map.get(slot.id)
        if attendance is None:
            continue
        pairs.append((slot, attendance))

    # Ad-hoc (보강) records: saved under a neis-* id that is not in the stored
    # timetable. Reconstruct the slot from the id so the run writes them too.
    for slot_id, attendance in day_map.items():
        if slot_id in timetable_ids:
            continue
        adhoc = _adhoc_slot_from_id(slot_id, weekday)
        if adhoc is not None:
            pairs.append((adhoc, attendance))

    return DayInput(
        date=date_str,
        year=settings.semester.year,
        term=settings.semester.term,
        slots=pairs,
        mixed_groups=(store.load_mixed_groups().groups
                      if any(getattr(record, "group_id", None) for _, record in pairs)
                      else None),
    )


def update_flags(store: DriveStore, month: str, slot_id: str, date_str: str,
                 synced: bool, closed: bool, *, expected) -> None:
    monthly = store.load_monthly(month)
    if monthly is None:
        raise DriveConflictError("자동 입력 중 기록이 삭제됐습니다. 반영 완료로 표시하지 않았습니다.")

    slot_attendance = monthly.records.get(date_str, {}).get(slot_id)
    if slot_attendance is None:
        raise DriveConflictError("자동 입력 중 수업이 삭제됐습니다. 반영 완료로 표시하지 않았습니다.")

    def content(value):
        return value.model_dump(mode="json", exclude={"synced_to_neis", "closed_on_neis"})

    if content(slot_attendance) != content(expected):
        raise DriveConflictError(
            "자동 입력 중 출결이 수정됐습니다. 새 기록은 미반영 상태로 유지했습니다. "
            "최신 기록을 확인하고 다시 반영해 주세요."
        )

    updated = slot_attendance.model_copy(
        update={"synced_to_neis": synced or slot_attendance.synced_to_neis,
                "closed_on_neis": closed or slot_attendance.closed_on_neis}
    )
    monthly.records[date_str][slot_id] = updated
    store.save_monthly(monthly)


def prepare_run_context(date_str: str, region_override: str | None = None) -> RunContext:
    store = build_store()
    settings = store.load_settings()
    if settings is None:
        raise RuntimeError("settings.json not found in Drive appDataFolder")

    region_key = region_override or settings.region
    if region_key not in regions.REGIONS:
        raise RuntimeError(f"unknown region: {region_key}")

    return RunContext(
        store=store,
        settings=settings,
        day_input=build_day_input(store, settings, date_str),
        region_key=region_key,
    )


def run_day(
    date_str: str,
    password: str,
    close_after: bool,
    region_override: str | None = None,
    keep_browser_open: bool = False,
) -> list[SlotResult]:
    context = prepare_run_context(date_str, region_override=region_override)
    # Immutable snapshot of the exact records sent to the automation runner.
    expected_records = {slot.id: attendance.model_copy(deep=True)
                        for slot, attendance in context.day_input.slots}
    config.selected_region = context.region_key

    driver = create_driver(keep_browser_open=keep_browser_open)
    try:
        utils.open_neis_direct(driver, password)
        month = date_str[:7]

        def callback(slot_id: str, synced: bool, closed: bool) -> None:
            update_flags(context.store, month, slot_id, date_str, synced, closed,
                         expected=expected_records[slot_id])

        return process_day(
            driver,
            context.day_input,
            close_after=close_after,
            on_update=callback,
        )
    finally:
        if not keep_browser_open:
            try:
                driver.quit()
            except Exception:
                pass
