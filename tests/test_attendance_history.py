from unittest.mock import MagicMock
import pytest

from subject_teacher.attendance_history import load_history, months_in_range
from subject_teacher.drive.schemas import MonthlyAttendance, Settings, SlotAttendance, Timetable, Absence
from subject_teacher.drive.mixed import MixedGroups
from subject_teacher import batch_run
from subject_teacher.neis.runner import SlotResult, DayInput, process_day
from subject_teacher.state import parse_students_tsv, serialize_students_tsv


class Store:
    def __init__(self):
        self.settings = Settings(teacherName="T", schoolName="S", region="경기", semester={"year":2026,"term":2}, updatedAt="2026-09-01")
        self.months = {}
        self.reads = []
    def load_settings(self): return self.settings
    def load_timetable(self): return Timetable(effectiveFrom="2026-09-07", slots=[])
    def load_mixed_groups(self): return MixedGroups()
    def load_monthly(self, month):
        self.reads.append(month)
        return self.months.get(month)
    def save_monthly(self, monthly): self.months[monthly.month] = monthly
    def add(self, day, slot="neis-2-1-3-문학", synced=False):
        monthly = self.months.setdefault(day[:7], MonthlyAttendance(month=day[:7], records={}))
        monthly.records.setdefault(day, {})[slot] = SlotAttendance(absences=[], checkedAt=day+"T10:00:00+09:00", source="mobile", syncedToNeis=synced)


def test_history_reads_each_month_once_inclusive_and_keeps_orphans():
    store = Store()
    store.add("2026-08-31")
    store.add("2026-09-01", "removed-manual-slot")
    store.add("2026-09-02")
    data = load_history(store, "2026-08-31", "2026-09-01")
    assert store.reads == ["2026-08", "2026-09"]
    assert len(data["rows"]) == 2
    assert data["rows"][0]["subject"] == "문학"
    assert next(c for c in data["classes"] if c["key"] == "2-1")["label"] == "2학년 1반"
    assert data["rows"][1]["classKey"] == "unknown"
    assert not data["rows"][1]["resolvable"]
    assert data["rows"][0]["marks"] == []


def test_content_token_ignores_only_neis_flags():
    store = Store(); store.add("2026-09-01")
    first = load_history(store, "2026-09-01", "2026-09-01")
    record = store.months["2026-09"].records["2026-09-01"]["neis-2-1-3-문학"]
    record.synced_to_neis = True
    second = load_history(store, "2026-09-01", "2026-09-01")
    assert first["token"] != second["token"]
    assert first["contentToken"] == second["contentToken"]
    record.absences = [Absence(studentNumber=4, markType="absent")]
    assert load_history(store, "2026-09-01", "2026-09-01")["contentToken"] != first["contentToken"]


@pytest.mark.parametrize("start,end", [("2026-09-10","2026-09-01"),("2025-01-01","2026-09-01"),("bad","2026-09-01")])
def test_bad_ranges_rejected(start,end):
    with pytest.raises(ValueError): months_in_range(start,end)


def test_number_only_roster_roundtrip():
    raw = "class_key\tnumber\tname\n2-1\t1\t\n2-1\t3\t"
    roster = parse_students_tsv(raw)
    assert [s.number for s in roster.classes["2-1"]] == [1,3]
    assert parse_students_tsv(serialize_students_tsv(roster)) == roster


def test_file_import_number_only_and_invalid_rows_not_silently_dropped():
    from subject_teacher.gui.api import _students_from_rows
    assert _students_from_rows([["번호"], ["1"], ["3"]]) == [{"n":1,"name":""}, {"n":3,"name":""}]
    for rows in ([["1", ""], ["1", ""]], [["1.5", ""]], [["100", ""]], [["bad", ""]]):
        with pytest.raises(ValueError): _students_from_rows(rows)


def setup_batch(monkeypatch, store, process):
    driver = MagicMock()
    monkeypatch.setattr(batch_run, "build_store", lambda: store)
    monkeypatch.setattr(batch_run, "create_driver", MagicMock(return_value=driver))
    monkeypatch.setattr(batch_run.utils, "open_neis_direct", MagicMock())
    monkeypatch.setattr(batch_run, "process_day", process)
    return driver


def test_batch_one_login_across_month_boundary_skips_synced_and_empty_days(monkeypatch):
    store = Store()
    store.add("2026-08-31"); store.add("2026-09-01"); store.add("2026-09-02", synced=True)
    def process(driver, day, **kwargs):
        assert kwargs["strict_date"] and not kwargs["close_after"]
        for slot, _ in day.slots: kwargs["on_update"](slot.id, True, False)
        return [SlotResult(s.id,"ok") for s,_ in day.slots]
    runner = MagicMock(side_effect=process)
    driver = setup_batch(monkeypatch,store,runner)
    token = load_history(store,"2026-08-31","2026-09-03")["token"]
    results = batch_run.run_range("2026-08-31","2026-09-03","pw",token,keep_browser_open=False)
    assert [r["date"] for r in results] == ["2026-08-31","2026-09-01"]
    assert [call.kwargs.get("reuse_page", False) for call in runner.call_args_list] == [False, True]
    batch_run.utils.open_neis_direct.assert_called_once()
    driver.quit.assert_called_once()
    assert batch_run.run_range("2026-08-31","2026-09-03","pw",load_history(store,"2026-08-31","2026-09-03")["token"]) == []


def test_batch_stops_after_failed_day(monkeypatch):
    store = Store(); store.add("2026-09-01"); store.add("2026-09-02")
    process = MagicMock(return_value=[SlotResult("neis-2-1-3-문학","failed","save error")])
    setup_batch(monkeypatch,store,process)
    batch_run.run_range("2026-09-01","2026-09-02","pw",load_history(store,"2026-09-01","2026-09-02")["token"])
    process.assert_called_once()


def test_batch_refuses_changed_preview_before_opening_browser(monkeypatch):
    store = Store(); store.add("2026-09-01")
    driver = setup_batch(monkeypatch,store,MagicMock())
    with pytest.raises(ValueError, match="조회 후"):
        batch_run.run_range("2026-09-01","2026-09-01","pw","stale")
    batch_run.create_driver.assert_not_called()


def test_batch_detects_mobile_edit_during_login(monkeypatch):
    store = Store(); store.add("2026-09-01")
    process = MagicMock()
    setup_batch(monkeypatch,store,process)
    token = load_history(store,"2026-09-01","2026-09-01")["token"]
    batch_run.utils.open_neis_direct.side_effect = lambda *_: store.add("2026-09-01", "neis-2-2-4-영어")
    with pytest.raises(ValueError, match="반영 중"):
        batch_run.run_range("2026-09-01","2026-09-01","pw",token)
    process.assert_not_called()


def test_strict_date_does_not_fall_back_to_previous_visible_day():
    commands = MagicMock()
    commands.select_date.side_effect = RuntimeError("wrong day")
    store = Store(); store.add("2026-09-01")
    snapshot = load_history(store,"2026-09-01","2026-09-01",include_records=True)
    pairs = list(snapshot["_records"]["2026-09-01"].values())
    results = process_day(MagicMock(),DayInput("2026-09-01",2026,2,pairs),False,cmd=commands,strict_date=True)
    assert results[0].status == "failed"
    commands.select_period.assert_not_called()


def test_history_names_are_local_only_and_do_not_change_sync_token():
    from subject_teacher.drive.schemas import Students
    store = Store()
    for day in ["2026-02-02", "2026-09-01"]:
        store.add(day)
        store.months[day[:7]].records[day]["neis-2-1-3-문학"].absences = [Absence(studentNumber=4, markType="absent")]
    students = Students(classes={"2-1": [{"number":4,"name":"테스트학생"}]})
    plain = load_history(store,"2026-02-02","2026-09-01")
    named = load_history(store,"2026-02-02","2026-09-01",local_students=students)
    assert named["rows"][0]["marks"][0]["name"] == ""
    assert named["rows"][1]["marks"][0]["name"] == "테스트학생"
    assert plain["token"] == named["token"]
    assert "테스트학생" not in str(plain)
    assert "테스트학생" not in str(store.months)
