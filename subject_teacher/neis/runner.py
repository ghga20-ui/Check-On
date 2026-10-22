"""Orchestrate per-day NEIS subject attendance automation."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Literal

from selenium.webdriver.remote.webdriver import WebDriver

from subject_teacher.drive.schemas import SlotAttendance, TimetableSlot
from subject_teacher.neis import subject_commands as default_commands
from subject_teacher.neis import mixed_commands

logger = logging.getLogger(__name__)

SlotPair = tuple[TimetableSlot, SlotAttendance]
OnUpdate = Callable[[str, bool, bool], None]


@dataclass
class DayInput:
    date: str
    year: int
    term: int
    slots: list[SlotPair]
    mixed_groups: dict | None = None


@dataclass
class SlotResult:
    slot_id: str
    status: Literal["ok", "skipped", "failed"]
    error: str = ""


def process_day(
    driver: WebDriver,
    day: DayInput,
    close_after: bool,
    cmd=default_commands,
    on_update: OnUpdate | None = None,
    strict_date: bool = False,
    reuse_page: bool = False,
) -> list[SlotResult]:
    """Process a single day of attendance records with per-slot isolation."""
    results: list[SlotResult] = []

    try:
        if not reuse_page:
            cmd.open_subject_attendance_page(driver, year=day.year, term=day.term)
            cmd.select_day_mode(driver)
        cmd.select_date(driver, day.date)
        cmd.click_search(driver)
    except Exception as exc:
        if strict_date or not getattr(cmd, "page_has_period_rows", lambda _driver: False)(driver):
            logger.exception("failed to prepare NEIS day view")
            return [
                SlotResult(slot_id=slot.id, status="failed", error=f"prepare: {exc}")
                for slot, _ in day.slots
            ]

    unsafe_dirty = False
    for slot, attendance in day.slots:
        if unsafe_dirty:
            results.append(SlotResult(slot.id, "failed", "이전 수업의 변경 상태가 불확실하여 중단했습니다. 화면을 직접 확인해 주세요."))
            continue
        if attendance.synced_to_neis and (attendance.closed_on_neis or not close_after):
            results.append(SlotResult(slot_id=slot.id, status="skipped"))
            continue

        mixed_started = False
        try:
            cmd.select_period(driver, slot.period, slot.neis_subject_label, slot.grade, slot.class_no)
            if getattr(attendance, "group_id", None):
                targets = mixed_commands.resolve_targets(slot, attendance, day.mixed_groups or {})
                mixed_commands.preflight(driver, targets)
                # From here even a failed click may have changed a cell. Never
                # navigate to another lesson without confirmed clean state.
                mixed_started = True
                mixed_commands.apply_targets(driver, targets, cmd)
                if cmd.click_save(driver) not in {"saved", "no_change"}:
                    raise RuntimeError("저장 완료를 확인하지 못했습니다.")
                mixed_commands.verify_targets(driver, targets)
                if close_after:
                    cmd.click_close(driver)
                mixed_started = False
                if on_update is not None:
                    on_update(slot.id, synced=True, closed=close_after)
                results.append(SlotResult(slot.id, "ok"))
                continue
            cmd.click_reset(driver)

            absent = [item for item in attendance.absences if item.mark_type.value == "absent"]
            excused = [item for item in attendance.absences if item.mark_type.value == "excused"]

            # 담임이 이미 찍어둔(/ 결과, Ø 인정결과) 수. 그런 학생은 click_attendance_cell이
            # 건너뛰고 False를 돌려주므로, 기대 카운트는 "기존 + 새로 찍은 수"로 잡아야
            # 담임 마크가 있어도 검증/저장이 깨지지 않는다.
            pre_existing = cmd.visible_result_count(driver) or 0
            newly_marked = 0

            cmd.ensure_excused_mode(driver, False)
            for item in absent:
                if cmd.click_attendance_cell(driver, item.student_number, expected_mark="absent"):
                    newly_marked += 1

            if excused:
                cmd.ensure_excused_mode(driver, True)
                for item in excused:
                    if cmd.click_attendance_cell(driver, item.student_number, expected_mark="excused"):
                        newly_marked += 1
                cmd.ensure_excused_mode(driver, False)

            expected_result_count = pre_existing + newly_marked
            cmd.verify_result_count(driver, expected_result_count)
            cmd.click_save(driver)
            cmd.verify_result_count(driver, expected_result_count)
            if close_after:
                cmd.click_close(driver)

            if on_update is not None:
                on_update(slot.id, synced=True, closed=close_after)
            results.append(SlotResult(slot_id=slot.id, status="ok"))
        except Exception as exc:
            if mixed_started or isinstance(exc, default_commands.SaveOverlayNotClosedError):
                unsafe_dirty = True
            logger.exception("slot %s failed", slot.id)
            results.append(SlotResult(slot_id=slot.id, status="failed", error=str(exc)))

    return results
