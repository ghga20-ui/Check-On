from subject_teacher.neis import subject_commands
from subject_teacher.neis.subject_commands import (
    MENU_PATH,
    SIDE_MENU_LABEL,
    SEL,
    build_date_input_xpath,
    build_period_row_xpath,
    build_side_menu_xpath,
    build_student_row_xpath,
    combo_already_selected,
    date_option_matches,
    date_option_prefix,
    format_neis_date_label,
    normalize_neis_date,
    parse_neis_date_label,
)


class _FakeButton:
    def __init__(self, kind="save"):
        self.kind = kind


class _FakeWait:
    def __init__(self, element):
        self.element = element

    def until(self, _condition):
        return self.element


class _FakeAlert:
    def __init__(self, text="해당자료를 저장하시겠습니까?"):
        self.text = text
        self.accepted = False

    def accept(self):
        self.accepted = True


class _FakeSwitch:
    def __init__(self, alert=None):
        self._alert = alert

    @property
    def alert(self):
        if self._alert is None:
            raise RuntimeError("no alert")
        return self._alert


class _FakeDriver:
    def __init__(
        self,
        alert=None,
        modal_confirm=False,
        no_change_notice=False,
        saved_notice=False,
        close_confirm=False,
    ):
        self.button = _FakeButton()
        self.switch_to = _FakeSwitch(alert)
        self.modal_confirm = modal_confirm
        self.no_change_notice = no_change_notice
        self.saved_notice = saved_notice
        self.close_confirm = close_confirm
        self.scripts = []
        self.clicked_modal_confirm = False
        self.clicked_notice_ok = False
        self.clicked_close_confirm = False

    def execute_script(self, script, *args):
        self.scripts.append((script, args))
        message_texts = args[0] if args and isinstance(args[0], list) else []
        if "해당자료를 저장하시겠습니까?" in message_texts:
            self.clicked_modal_confirm = bool(self.modal_confirm)
            return {"button": _FakeButton("confirm"), "messageText": "해당자료를 저장하시겠습니까?"} if self.modal_confirm else None
        if "출결마감" in message_texts:
            self.clicked_close_confirm = bool(self.close_confirm)
            return {"button": _FakeButton("close-confirm"), "messageText": "출결마감"} if self.close_confirm else None
        if "변경된 내용이 없습니다." in message_texts:
            if self.no_change_notice:
                self.clicked_notice_ok = True
                return {"button": _FakeButton("notice"), "messageText": "변경된 내용이 없습니다."}
        if "저장했습니다." in message_texts:
            if self.saved_notice:
                self.clicked_notice_ok = True
                return {"button": _FakeButton("notice"), "messageText": "저장했습니다."}
        if "loadingCount" in script and "dialogs" in script:
            return {"dialogs": [], "messages": [], "buttons": []}
        if "querySelectorAll" in script:
            return False
        return None


def _patch_click_save_wait(monkeypatch, driver):
    monkeypatch.setattr(subject_commands, "_wait", lambda *_args, **_kwargs: _FakeWait(driver.button))
    monkeypatch.setattr(subject_commands, "_click_element_like_user", lambda _driver, _button: None)
    monkeypatch.setattr(subject_commands, "_wait_for_save_completion", lambda _driver, **_kwargs: None)


def test_menu_path_matches_manual():
    assert MENU_PATH == [
        "교과담임",
        "학적",
        "출결관리",
    ]


def test_selectors_are_strings():
    for key, value in SEL.items():
        assert isinstance(value, str) and value, f"selector {key} must be non-empty string"


def test_row_xpath_includes_student_number():
    xpath = build_student_row_xpath(student_number=15)
    assert "15" in xpath


def test_side_menu_xpath_includes_label():
    assert SIDE_MENU_LABEL == "과목별출결관리"
    assert "과목별출결관리" in build_side_menu_xpath()


def test_normalize_neis_date_converts_dash_format():
    assert normalize_neis_date("2026-04-17") == "2026.04.17"
    assert normalize_neis_date("2026.04.17") == "2026.04.17"


def test_format_neis_date_label_matches_neis_combobox_value():
    assert format_neis_date_label("2026-04-21") == "2026.04.21.(화)"
    assert format_neis_date_label("2026.04.21") == "2026.04.21.(화)"
    assert format_neis_date_label("2026.04.21.(화)") == "2026.04.21.(화)"


def test_parse_neis_date_label_ignores_weekday_suffix():
    assert parse_neis_date_label("2026.04.28.(화)").isoformat() == "2026-04-28"
    assert parse_neis_date_label("2026.04.28").isoformat() == "2026-04-28"


def test_date_option_prefix_ignores_weekday_suffix():
    assert date_option_prefix("2026-04-21") == "2026.04.21"
    assert date_option_prefix("2026.04.21.(화)") == "2026.04.21"


def test_date_option_matches_common_neis_dropdown_text():
    assert date_option_matches("2026.04.21.(화)", "2026-04-21") is True
    assert date_option_matches("2026.04.21 화", "2026-04-21") is True
    assert date_option_matches("2026.04.22.(수)", "2026-04-21") is False


def test_date_input_xpath_accepts_dynamic_neis_labels():
    xpath = build_date_input_xpath()

    assert "contains(@aria-label, '일자')" in xpath
    assert "contains(@class, 'cl-dateinput')" in xpath
    assert "@type='date'" in xpath


def test_period_row_xpath_accepts_common_neis_period_labels():
    xpath = build_period_row_xpath(3)

    assert "3교시" in xpath
    assert "3 교시" in xpath
    assert "교시 3" in xpath
    assert "@role='row'" in xpath


def test_period_row_xpath_can_include_subject_label():
    xpath = build_period_row_xpath(2, "1학년 8(공통국어1)")

    assert "2교시" in xpath
    assert "1학년 8" in xpath
    assert "공통국어1" in xpath


def test_combo_already_selected_detects_exact_label():
    aria_labels = [
        "학년도, :::학년도:::",
        "학년도, 2026",
        "학기, 1학기",
    ]

    assert combo_already_selected(aria_labels, "학년도", "2026") is True
    assert combo_already_selected(aria_labels, "학기", "1학기") is True
    assert combo_already_selected(aria_labels, "학기", "2학기") is False


def test_click_save_accepts_browser_confirm_alert(monkeypatch):
    alert = _FakeAlert()
    driver = _FakeDriver(alert=alert)
    _patch_click_save_wait(monkeypatch, driver)

    subject_commands.click_save(driver)

    assert alert.accepted is True


def test_click_save_accepts_neis_internal_confirm_modal(monkeypatch):
    driver = _FakeDriver(modal_confirm=True)
    _patch_click_save_wait(monkeypatch, driver)

    subject_commands.click_save(driver)

    assert driver.clicked_modal_confirm is True


def test_click_save_uses_short_fallback_when_no_confirm_dialog(monkeypatch):
    driver = _FakeDriver(modal_confirm=False)
    sleeps = []
    _patch_click_save_wait(monkeypatch, driver)
    monkeypatch.setattr(subject_commands.time, "sleep", lambda seconds: sleeps.append(seconds))

    subject_commands.click_save(driver)

    assert sleeps


def test_click_save_closes_no_change_notice_modal(monkeypatch):
    driver = _FakeDriver(no_change_notice=True)
    _patch_click_save_wait(monkeypatch, driver)

    subject_commands.click_save(driver)

    assert driver.clicked_notice_ok is True


def test_click_save_returns_no_change_when_neis_reports_no_change(monkeypatch):
    driver = _FakeDriver(no_change_notice=True)
    _patch_click_save_wait(monkeypatch, driver)

    result = subject_commands.click_save(driver)

    assert result == "no_change"


def test_click_save_closes_saved_notice_modal(monkeypatch):
    driver = _FakeDriver(saved_notice=True)
    _patch_click_save_wait(monkeypatch, driver)

    result = subject_commands.click_save(driver)

    assert driver.clicked_notice_ok is True
    assert result == "saved"


def test_acknowledged_save_does_not_wait_for_a_second_notice(monkeypatch):
    driver = _FakeDriver(saved_notice=True)
    _patch_click_save_wait(monkeypatch, driver)
    from unittest.mock import MagicMock
    wait = MagicMock(return_value=None)
    monkeypatch.setattr(subject_commands, "_wait_for_save_completion", wait)
    assert subject_commands.click_save(driver) == "saved"
    assert wait.call_args.kwargs.get("acknowledged") is True


def test_acknowledged_save_waits_for_overlay_but_has_no_extra_quiet_delay(monkeypatch):
    snapshots = iter([{"loadingCount":1,"dialogs":[]},
                      {"loadingCount":0,"dialogs":["저장했습니다"]},
                      {"loadingCount":0,"dialogs":[]}])
    sleeps=[]
    monkeypatch.setattr(subject_commands,"_accept_browser_alert",lambda *a,**k:False)
    monkeypatch.setattr(subject_commands,"_click_neis_save_notice_ok",lambda d:None)
    monkeypatch.setattr(subject_commands,"_save_completion_snapshot",lambda d:next(snapshots))
    monkeypatch.setattr(subject_commands.time,"sleep",sleeps.append)
    subject_commands._wait_for_save_completion(object(),acknowledged=True)
    assert sleeps == [0.15,0.15]


def test_missing_completion_notice_keeps_existing_wait(monkeypatch):
    clock=[0.0]
    monkeypatch.setattr(subject_commands,"_accept_browser_alert",lambda *a,**k:False)
    monkeypatch.setattr(subject_commands,"_click_neis_save_notice_ok",lambda d:None)
    monkeypatch.setattr(subject_commands,"_save_completion_snapshot",lambda d:{"loadingCount":0,"dialogs":[]})
    monkeypatch.setattr(subject_commands.time,"monotonic",lambda:clock[0])
    monkeypatch.setattr(subject_commands.time,"sleep",lambda s:clock.__setitem__(0,clock[0]+s))
    subject_commands._wait_for_save_completion(object())
    assert clock[0] >= 3


def test_click_close_accepts_neis_internal_confirm_modal(monkeypatch):
    driver = _FakeDriver(close_confirm=True)

    monkeypatch.setattr(subject_commands, "_wait", lambda *_args, **_kwargs: _FakeWait(driver.button))
    monkeypatch.setattr(subject_commands, "_click_element_like_user", lambda _driver, _button: None)
    monkeypatch.setattr(subject_commands.time, "sleep", lambda _seconds: None)

    subject_commands.click_close(driver)

    assert driver.clicked_close_confirm is True


def test_close_confirm_texts_cover_neis_spaced_close_prompt():
    assert "마감 하시겠습니까?" in subject_commands.CLOSE_CONFIRM_TEXTS


def test_click_period_row_uses_coordinate_grid_click(monkeypatch):
    cell = object()
    clicked = []

    class Driver:
        def execute_script(self, *_args):
            return cell

    monkeypatch.setattr(subject_commands, "_click_grid_cell", lambda _driver, target: clicked.append(target))

    result = subject_commands._click_period_row_by_text(Driver(), 5, "문학", 2, "1")

    assert result is True
    assert clicked == [cell]


def test_select_period_waits_for_student_grid_after_period_click(monkeypatch):
    calls = []
    driver = object()

    monkeypatch.setattr(subject_commands, "_click_period_row_by_text", lambda *_args: True)
    monkeypatch.setattr(
        subject_commands,
        "_wait_for_student_grid_ready",
        lambda target, period, subject_label, grade, class_no: calls.append(
            (target, period, subject_label, grade, class_no)
        ),
        raising=False,
    )
    monkeypatch.setattr(subject_commands.time, "sleep", lambda _seconds: None)

    subject_commands.select_period(driver, 5, "문학", 2, "1")

    assert calls == [(driver, 5, "문학", 2, "1")]


def test_click_attendance_cell_skips_absent_cell_that_already_has_slash(monkeypatch):
    cell = object()
    driver = object()
    clicked = []

    monkeypatch.setattr(subject_commands, "_wait", lambda *_args, **_kwargs: _FakeWait(cell))
    monkeypatch.setattr(subject_commands, "_status_cell_has_absent_mark", lambda _driver, _cell: True)
    monkeypatch.setattr(subject_commands, "_click_grid_cell", lambda _driver, _cell: clicked.append(_cell))

    result = subject_commands.click_attendance_cell(driver, 3, expected_mark="absent")

    assert result is False  # 이미 표시(/ 또는 Ø) → 건너뜀
    assert clicked == []


def test_click_attendance_cell_skips_excused_cell_already_marked(monkeypatch):
    # 담임이 'Ø'(인정결과) 등으로 이미 찍은 경우, excused 의도여도 건너뛴다.
    cell = object()
    driver = object()
    clicked = []

    monkeypatch.setattr(subject_commands, "_wait", lambda *_args, **_kwargs: _FakeWait(cell))
    monkeypatch.setattr(subject_commands, "_status_cell_has_absent_mark", lambda _driver, _cell: True)
    monkeypatch.setattr(subject_commands, "_click_grid_cell", lambda _driver, _cell: clicked.append(_cell))

    result = subject_commands.click_attendance_cell(driver, 7, expected_mark="excused")

    assert result is False
    assert clicked == []


def test_click_attendance_cell_clicks_empty_absent_cell_once(monkeypatch):
    cell = object()
    driver = object()
    clicked = []
    verified = []

    monkeypatch.setattr(subject_commands, "_wait", lambda *_args, **_kwargs: _FakeWait(cell))
    monkeypatch.setattr(subject_commands, "_status_cell_has_absent_mark", lambda _driver, _cell: False)
    monkeypatch.setattr(subject_commands, "_click_grid_cell", lambda _driver, _cell: clicked.append(_cell))
    monkeypatch.setattr(subject_commands, "_wait_for_absent_mark", lambda _driver, number: verified.append(number))
    monkeypatch.setattr(subject_commands.time, "sleep", lambda _seconds: None)

    result = subject_commands.click_attendance_cell(driver, 3, expected_mark="absent")

    assert result is True  # 새로 찍음
    assert clicked == [cell]
    assert verified == [3]


def test_excused_checkbox_selector_targets_label():
    # Must single out the '출석인정' checkbox, not any role=checkbox div.
    assert "출석인정" in SEL["excused_checkbox"]
    assert "@role='checkbox'" in SEL["excused_checkbox"]


class _FakeExcusedCheckbox:
    def __init__(self, checked=False):
        self._checked = checked

    def get_attribute(self, name):
        if name == "aria-checked":
            return "true" if self._checked else "false"
        if name == "aria-label":
            return "출석인정"
        return None


class _ExcusedDriver:
    def __init__(self, checked=False):
        self.cb = _FakeExcusedCheckbox(checked)
        self.clicks = 0

    def find_elements(self, _by, _xpath):
        return [self.cb]

    def execute_script(self, script, *args):
        if "click" in script and args:
            self.clicks += 1
            self.cb._checked = not self.cb._checked  # NEIS toggles aria-checked


class _StuckExcusedCheckbox(_FakeExcusedCheckbox):
    pass


class _StuckExcusedDriver(_ExcusedDriver):
    """Clicking never flips aria-checked (simulates a flaky/stuck checkbox)."""
    def execute_script(self, script, *args):
        if "click" in script and args:
            self.clicks += 1  # but do NOT toggle aria-checked


class _FastClock:
    def __init__(self):
        self._t = 0.0

    def time(self):
        self._t += 1.0
        return self._t

    def sleep(self, _seconds):
        pass


def _patch_fast_clock(monkeypatch):
    monkeypatch.setattr(subject_commands, "time", _FastClock())


def test_ensure_excused_mode_turns_on_from_off():
    driver = _ExcusedDriver(checked=False)
    subject_commands.ensure_excused_mode(driver, True)
    assert driver.clicks == 1
    assert driver.cb._checked is True


def test_ensure_excused_mode_turns_off_from_on():
    driver = _ExcusedDriver(checked=True)
    subject_commands.ensure_excused_mode(driver, False)
    assert driver.clicks == 1          # previously 0 — the off-toggle bug
    assert driver.cb._checked is False


def test_ensure_excused_mode_is_noop_when_already_in_state():
    on_driver = _ExcusedDriver(checked=True)
    subject_commands.ensure_excused_mode(on_driver, True)
    assert on_driver.clicks == 0
    off_driver = _ExcusedDriver(checked=False)
    subject_commands.ensure_excused_mode(off_driver, False)
    assert off_driver.clicks == 0


def test_ensure_excused_mode_off_never_raises_even_if_stuck(monkeypatch):
    # Turning OFF must be best-effort — never abort the slot before 저장 runs.
    _patch_fast_clock(monkeypatch)
    driver = _StuckExcusedDriver(checked=True)
    subject_commands.ensure_excused_mode(driver, False)  # must not raise
    assert driver.clicks >= 1


def test_ensure_excused_mode_on_raises_if_cannot_turn_on(monkeypatch):
    # We must be ON to mark Ø, so a failure here should surface.
    _patch_fast_clock(monkeypatch)
    driver = _StuckExcusedDriver(checked=False)
    import pytest
    with pytest.raises(RuntimeError):
        subject_commands.ensure_excused_mode(driver, True)
