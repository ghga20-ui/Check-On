from unittest.mock import MagicMock, call

from subject_teacher.drive.schemas import Absence, MarkType, SlotAttendance, TimetableSlot
from subject_teacher.neis.runner import DayInput, process_day


def make_slot(slot_id: str, period: int, grade: int = 2, class_no: int = 3) -> TimetableSlot:
    return TimetableSlot(
        id=slot_id,
        dayOfWeek=1,
        period=period,
        grade=grade,
        classNo=class_no,
        subjectName="수학Ⅰ",
        neisSubjectLabel=f"수학Ⅰ({grade}-{class_no})",
    )


def make_attendance(absences: list[Absence], synced: bool = False) -> SlotAttendance:
    return SlotAttendance(
        absences=absences,
        checkedAt="2026-04-17T09:55:00+09:00",
        source="mobile",
        syncedToNeis=synced,
        closedOnNeis=False,
    )


def test_consecutive_days_reuse_menu_but_always_change_date_and_search():
    driver, commands = MagicMock(), MagicMock()
    for index, day in enumerate(["2026-09-10", "2026-09-11"]):
        process_day(driver, DayInput(day, 2026, 2, []), False, cmd=commands,
                    strict_date=True, reuse_page=index > 0)
    commands.open_subject_attendance_page.assert_called_once()
    commands.select_day_mode.assert_called_once()
    assert commands.select_date.call_args_list == [call(driver,"2026-09-10"),call(driver,"2026-09-11")]
    assert commands.click_search.call_count == 2


def test_reused_page_date_failure_stops_before_search_or_marking():
    driver, commands = MagicMock(), MagicMock()
    commands.select_date.side_effect = RuntimeError("wrong date")
    result = process_day(driver, DayInput("2026-09-11",2026,2,[(make_slot("s",1),make_attendance([]))]),
                         False, cmd=commands, strict_date=True, reuse_page=True)
    assert result[0].status == "failed"
    commands.open_subject_attendance_page.assert_not_called()
    commands.click_search.assert_not_called()
    commands.select_period.assert_not_called()


def test_unclosed_save_overlay_blocks_next_class():
    from subject_teacher.neis.subject_commands import SaveOverlayNotClosedError
    driver, commands, update = MagicMock(), MagicMock(), MagicMock()
    commands.click_save.side_effect = SaveOverlayNotClosedError("overlay remains")
    day = DayInput("2026-09-11",2026,2,[(make_slot("a",1),make_attendance([])),(make_slot("b",2),make_attendance([]))])
    results=process_day(driver,day,False,cmd=commands,on_update=update)
    assert [r.status for r in results] == ["failed","failed"]
    commands.select_period.assert_called_once()
    update.assert_not_called()


def test_skips_slots_already_synced():
    driver = MagicMock()
    commands = MagicMock()
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-17",
        year=2026,
        term=1,
        slots=[
            (make_slot("mon-1", 1), make_attendance([], synced=True)),
            (
                make_slot("mon-2", 2),
                make_attendance([Absence(studentNumber=1, markType=MarkType.ABSENT, note="")]),
            ),
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)

    commands.open_subject_attendance_page.assert_called_once_with(driver, year=2026, term=1)
    assert [result.slot_id for result in results] == ["mon-1", "mon-2"]
    assert results[0].status == "skipped"
    assert results[1].status == "ok"
    assert commands.select_period.call_args_list == [call(driver, 2, "수학Ⅰ(2-3)", 2, "3")]


def test_orders_absent_before_excused_and_toggles_mode():
    driver = MagicMock()
    commands = MagicMock()
    commands.visible_result_count.return_value = 0  # 담임 기존 마크 없음
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-17",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-1", 1),
                make_attendance(
                    [
                        Absence(studentNumber=5, markType=MarkType.ABSENT, note=""),
                        Absence(studentNumber=15, markType=MarkType.EXCUSED, note="교외체험"),
                    ]
                ),
            )
        ],
    )

    process_day(driver, day, close_after=True, cmd=commands, on_update=on_update)

    expected = [
        call.click_reset(driver),
        call.ensure_excused_mode(driver, False),
        call.click_attendance_cell(driver, 5, expected_mark="absent"),
        call.ensure_excused_mode(driver, True),
        call.click_attendance_cell(driver, 15, expected_mark="excused"),
        call.ensure_excused_mode(driver, False),
        call.verify_result_count(driver, 2),
        call.click_save(driver),
        call.verify_result_count(driver, 2),
        call.click_close(driver),
    ]
    actual = [
        call_
        for call_ in commands.method_calls
        if call_[0]
        in {
            "click_reset",
            "ensure_excused_mode",
            "click_attendance_cell",
            "verify_result_count",
            "click_save",
            "click_close",
        }
    ]
    assert actual == expected


def test_on_update_is_called_after_save():
    driver = MagicMock()
    commands = MagicMock()
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-17",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-1", 1),
                make_attendance([Absence(studentNumber=1, markType=MarkType.ABSENT, note="")]),
            )
        ],
    )

    process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)

    on_update.assert_called_once_with("mon-1", synced=True, closed=False)


def test_failure_in_one_slot_does_not_halt_others():
    driver = MagicMock()
    commands = MagicMock()
    commands.click_save.side_effect = [RuntimeError("boom"), None]
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-17",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-1", 1),
                make_attendance([Absence(studentNumber=1, markType=MarkType.ABSENT, note="")]),
            ),
            (
                make_slot("mon-2", 2),
                make_attendance([Absence(studentNumber=2, markType=MarkType.ABSENT, note="")]),
            ),
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)

    assert results[0].status == "failed"
    assert "boom" in results[0].error
    assert results[1].status == "ok"
    assert on_update.call_args_list == [call("mon-2", synced=True, closed=False)]


def test_prepare_step_can_fall_back_when_periods_already_visible():
    driver = MagicMock()
    commands = MagicMock()
    commands.click_search.side_effect = RuntimeError("search blocked")
    commands.page_has_period_rows.return_value = True

    day = DayInput(
        date="2026-04-20",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-3", 3),
                make_attendance([Absence(studentNumber=18, markType=MarkType.ABSENT, note="")]),
            )
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=MagicMock())

    assert results[0].status == "ok"
    commands.page_has_period_rows.assert_called_once_with(driver)


def test_no_change_after_marking_absence_can_sync_when_result_count_matches():
    driver = MagicMock()
    commands = MagicMock()
    commands.click_save.return_value = "no_change"
    commands.visible_result_count.return_value = 0  # 담임 기존 마크 없음
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-20",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-3", 3),
                make_attendance([Absence(studentNumber=3, markType=MarkType.ABSENT, note="")]),
            )
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)

    assert results[0].status == "ok"
    assert commands.verify_result_count.call_args_list == [call(driver, 1), call(driver, 1)]
    on_update.assert_called_once_with("mon-3", synced=True, closed=False)


def test_result_count_mismatch_fails_without_sync_update():
    driver = MagicMock()
    commands = MagicMock()
    commands.verify_result_count.side_effect = RuntimeError("NEIS result count mismatch: expected 1, got 0")
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-20",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-3", 3),
                make_attendance([Absence(studentNumber=3, markType=MarkType.ABSENT, note="")]),
            )
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)

    assert results[0].status == "failed"
    assert "result count mismatch" in results[0].error
    on_update.assert_not_called()


def test_skips_homeroom_marked_students_and_counts_only_new():
    driver = MagicMock()
    commands = MagicMock()
    commands.visible_result_count.return_value = 1  # 담임이 1명 미리 표시(/, Ø)
    # 학생3 = 이미 표시되어 건너뜀(False), 학생5 = 새로 찍음(True)
    commands.click_attendance_cell.side_effect = [False, True]
    on_update = MagicMock()

    day = DayInput(
        date="2026-04-17",
        year=2026,
        term=1,
        slots=[
            (
                make_slot("mon-1", 1),
                make_attendance(
                    [
                        Absence(studentNumber=3, markType=MarkType.ABSENT, note=""),
                        Absence(studentNumber=5, markType=MarkType.ABSENT, note=""),
                    ]
                ),
            )
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)

    assert results[0].status == "ok"
    # 기대 카운트 = 담임 기존(1) + 새로 찍은(1) = 2 (건너뛴 학생3은 더하지 않음)
    assert commands.verify_result_count.call_args_list == [call(driver, 2), call(driver, 2)]
    on_update.assert_called_once_with("mon-1", synced=True, closed=False)
