import json
from pathlib import Path

from subject_teacher.drive.schemas import (
    Absence,
    MarkType,
    MonthlyAttendance,
    Semester,
    Settings,
    SlotAttendance,
    Students,
    Timetable,
    TimetableSlot,
)
from subject_teacher.gui import api as gui_api
from subject_teacher.gui.api import Api


class FakeStore:
    def __init__(self):
        self.timetable = Timetable(
            schemaVersion=1,
            effectiveFrom="2026-03-02",
            slots=[
                TimetableSlot(
                    id="mon-3",
                    dayOfWeek=1,
                    period=3,
                    grade=2,
                    classNo="문학 A",
                    subjectName="문학",
                    neisSubjectLabel="문학",
                )
            ],
        )
        self.students = Students(schemaVersion=1, classes={"2-문학 A": []})
        self.settings = Settings(
            schemaVersion=1,
            teacherName="박세준",
            schoolName="수원고등학교",
            region="경기",
            semester=Semester(year=2026, term=1),
            closeByDefault=False,
            updatedAt="2026-04-27T09:00:00+09:00",
        )
        self.saved_settings = None
        self.saved_monthly = None
        self.monthly = None

    def load_timetable(self):
        return self.timetable

    def load_students(self):
        return self.students

    def load_settings(self):
        return self.settings

    def save_settings(self, settings):
        self.saved_settings = settings

    def load_monthly(self, month):
        assert month == "2026-04"
        return self.monthly

    def save_monthly(self, monthly):
        self.saved_monthly = monthly


def test_pc_save_rejects_remote_change_since_screen_was_loaded(monkeypatch):
    store = FakeStore()
    store.monthly = MonthlyAttendance(month="2026-04", records={"2026-04-20": {
        "mon-3": SlotAttendance(absences=[], checkedAt="newer", source="mobile")
    }})
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    result = json.loads(Api().save_slot_attendance("2026-04-20", "mon-3", '{"3":"absent"}', "older"))
    assert result["code"] == "attendance_conflict"
    assert store.saved_monthly is None


def test_timetable_tsv_api_preserves_nonnumeric_class_label(monkeypatch):
    monkeypatch.setattr(gui_api, "build_store", lambda: FakeStore())

    raw = Api().get_timetable_tsv()

    assert "mon-3\tmon\t3\t2\t문학 A\t문학\t문학" in raw


def test_settings_api_preserves_teacher_and_school_name(monkeypatch):
    monkeypatch.setattr(gui_api, "build_store", lambda: FakeStore())

    payload = json.loads(Api().get_settings())

    assert payload["teacherName"] == "박세준"
    assert payload["schoolName"] == "수원고등학교"


def test_timetable_tsv_api_returns_structured_error(monkeypatch):
    monkeypatch.setattr(
        gui_api,
        "build_store",
        lambda: (_ for _ in ()).throw(RuntimeError("Drive 인증 필요")),
    )

    payload = json.loads(Api().get_timetable_tsv())

    assert payload == {"error": "Drive 인증 필요"}


def test_students_tsv_api_reads_local_roster_without_drive(tmp_path, monkeypatch):
    # Roster is stored on-device now; a Drive auth failure must not break reads.
    monkeypatch.setattr(
        gui_api,
        "build_store",
        lambda: (_ for _ in ()).throw(RuntimeError("Drive 인증 필요")),
    )
    monkeypatch.setattr(
        "subject_teacher.local_store.get_students_path",
        lambda: tmp_path / "students.local.json",
    )

    result = Api().get_students_tsv()

    # Returns TSV text (empty when no local roster) — not a Drive error.
    assert "Drive 인증 필요" not in result
    assert not result.strip()


def test_api_errors_convert_invalid_grant_to_reauth_code(monkeypatch):
    deleted = []
    monkeypatch.setattr(gui_api, "revoke", lambda: deleted.append("token"))

    raw = gui_api._json_error(
        RuntimeError(
            "('invalid_grant: Token has been expired or revoked.', "
            "{'error': 'invalid_grant', 'error_description': 'Token has been expired or revoked.'})"
        )
    )

    payload = json.loads(raw)
    assert payload == {
        "error": "Google Drive 인증이 만료됐습니다. OAuth 인증 화면에서 계정을 다시 확인해 주세요.",
        "code": "reauth_required",
    }
    assert deleted == ["token"]


def test_drive_user_api_returns_account_metadata(monkeypatch):
    class FakeGet:
        def execute(self):
            return {
                "user": {
                    "displayName": "테스트",
                    "emailAddress": "teacher@example.com",
                    "me": True,
                }
            }

    class FakeAbout:
        def get(self, fields):
            assert fields == "user"
            return FakeGet()

    class FakeService:
        def about(self):
            return FakeAbout()

    monkeypatch.setattr(gui_api, "get_credentials", lambda: object())
    monkeypatch.setattr(gui_api, "build", lambda *args, **kwargs: FakeService())

    payload = json.loads(Api().get_drive_user())

    assert payload["emailAddress"] == "teacher@example.com"
    assert payload["displayName"] == "테스트"


def test_save_slot_attendance_creates_pc_record_and_resets_sync_flags(monkeypatch):
    store = FakeStore()
    monkeypatch.setattr(gui_api, "build_store", lambda: store)

    result = json.loads(
        Api().save_slot_attendance(
            "2026-04-20",
            "mon-3",
            json.dumps({"1": "present", "2": "absent", "3": "excused"}),
        )
    )

    assert result["ok"] is True
    assert result["checkedAt"]
    assert isinstance(store.saved_monthly, MonthlyAttendance)
    attendance = store.saved_monthly.records["2026-04-20"]["mon-3"]
    assert attendance.source == "pc"
    assert attendance.synced_to_neis is False
    assert attendance.closed_on_neis is False
    assert [(a.student_number, a.mark_type) for a in attendance.absences] == [
        (2, MarkType.ABSENT),
        (3, MarkType.EXCUSED),
    ]


def test_save_slot_attendance_returns_checked_at_for_ui(monkeypatch):
    store = FakeStore()
    monkeypatch.setattr(gui_api, "build_store", lambda: store)

    result = json.loads(
        Api().save_slot_attendance(
            "2026-04-20",
            "mon-3",
            json.dumps({"2": "absent"}),
        )
    )

    assert result["ok"] is True
    assert result["checkedAt"]
    assert store.saved_monthly.records["2026-04-20"]["mon-3"].checked_at == result["checkedAt"]


def test_today_slots_api_includes_saved_drive_marks(monkeypatch):
    store = FakeStore()
    store.settings.timetable_mode = "manual"
    store.monthly = MonthlyAttendance(
        schemaVersion=1,
        month="2026-04",
        records={
            "2026-04-20": {
                "mon-3": SlotAttendance(
                    absences=[
                        Absence(studentNumber=3, markType=MarkType.ABSENT, note=""),
                        Absence(studentNumber=12, markType=MarkType.EXCUSED, note=""),
                    ],
                    checkedAt="2026-04-20T09:00:00+09:00",
                    source="mobile",
                    syncedToNeis=False,
                    closedOnNeis=False,
                )
            }
        },
    )
    monkeypatch.setattr(gui_api, "build_store", lambda: store)

    payload = json.loads(Api().get_today_slots("2026-04-20"))

    assert payload[0]["checked"] is True
    assert payload[0]["absences"] == 2
    assert payload[0]["checkedAt"] == "2026-04-20T09:00:00+09:00"
    assert payload[0]["marks"] == {"3": "absent", "12": "excused"}


def test_neis_public_timetable_preview_api_returns_lessons(monkeypatch):
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: {
            "school": {"name": "수원고등학교", "code": "7530174", "kind": "고등학교"},
            "date": kwargs["date_str"],
            "lessons": [
                {"day": "월", "period": 3, "grade": 2, "classNo": "1", "subject": "문학", "neis": "문학"}
            ],
        },
    )

    payload = json.loads(
        Api().preview_neis_public_timetable(
            json.dumps(
                {
                    "region": "경기",
                    "schoolName": "수원고",
                    "date": "2025-03-10",
                    "grade": 2,
                    "classNo": "1",
                },
                ensure_ascii=False,
            )
        )
    )

    assert payload["school"]["name"] == "수원고등학교"
    assert payload["lessons"][0]["subject"] == "문학"


def test_neis_subject_candidate_api_returns_similar_labels(monkeypatch):
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    calls = []
    monkeypatch.setattr(
        gui_api,
        "query_subject_candidates",
        lambda **kwargs: calls.append(kwargs) or {
            "scope": "grade",
            "candidates": [{"subject": "공통국어Ⅰ", "score": 100}],
        },
    )

    payload = json.loads(
        Api().find_neis_subject_candidates(
            json.dumps(
                {
                    "region": "경기",
                    "schoolName": "수원고",
                    "date": "2026-05-06",
                    "grade": 1,
                    "classNo": "1",
                    "subjectName": "공통국어1",
                },
                ensure_ascii=False,
            )
        )
    )

    assert calls[0]["api_key"] == "KEY"
    assert calls[0]["subject_name"] == "공통국어1"
    assert payload["candidates"] == [{"subject": "공통국어Ⅰ", "score": 100}]


def test_neis_mode_today_slots_query_public_timetable(monkeypatch):
    store = FakeStore()
    store.settings = store.settings.model_copy(
        update={
            "timetable_mode": "neis",
            "assigned_lessons": [
                {
                    "grade": 2,
                    "class_no": "1",
                    "subject_name": "수학1",
                    "neis_subject_label": "수학Ⅰ",
                    "subject_aliases": ["수학 I"],
                }
            ],
        }
    )
    calls = []
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: calls.append(kwargs) or {
            "school": {"name": "수원고등학교"},
            "date": kwargs["date_str"],
            "lessons": [
                {"day": "월", "period": 2, "grade": 2, "classNo": "1", "subject": "수학Ⅰ", "neis": "수학Ⅰ"},
                {"day": "월", "period": 3, "grade": 2, "classNo": "1", "subject": "영어Ⅰ", "neis": "영어Ⅰ"},
            ],
        },
    )

    payload = json.loads(Api().get_today_slots("2026-04-20"))

    assert calls[0]["api_key"] == "KEY"
    assert len(payload) == 1
    assert payload[0]["id"].startswith("neis-2-1-2-")
    assert payload[0]["subject"] == "수학1"
    assert payload[0]["neisLabel"] == "수학Ⅰ"


def test_neis_mode_today_slots_reuses_same_date_cache(monkeypatch):
    store = FakeStore()
    store.settings = store.settings.model_copy(
        update={
            "timetable_mode": "neis",
            "assigned_lessons": [
                {
                    "grade": 2,
                    "class_no": "1",
                    "subject_name": "문학",
                    "neis_subject_label": "문학",
                    "subject_aliases": [],
                }
            ],
        }
    )
    calls = []
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: calls.append(kwargs) or {
            "school": {"name": "수원고등학교"},
            "date": kwargs["date_str"],
            "lessons": [
                {"day": "월", "period": 2, "grade": 2, "classNo": "1", "subject": "문학", "neis": "문학"},
            ],
        },
    )
    api = Api()

    first = json.loads(api.get_today_slots("2026-04-20"))
    second = json.loads(api.get_today_slots("2026-04-20"))

    assert first == second
    assert len(calls) == 1


def test_today_slots_force_refresh_bypasses_cache(monkeypatch):
    # The UI 새로고침 button must show marks another device just wrote; a forced
    # call drops the 60s slot/monthly caches instead of replaying them.
    store = FakeStore()
    store.settings = store.settings.model_copy(
        update={
            "timetable_mode": "neis",
            "assigned_lessons": [
                {
                    "grade": 2,
                    "class_no": "1",
                    "subject_name": "문학",
                    "neis_subject_label": "문학",
                    "subject_aliases": [],
                }
            ],
        }
    )
    calls = []
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: calls.append(kwargs) or {
            "school": {"name": "수원고등학교"},
            "date": kwargs["date_str"],
            "lessons": [
                {"day": "월", "period": 2, "grade": 2, "classNo": "1", "subject": "문학", "neis": "문학"},
            ],
        },
    )
    api = Api()

    api.get_today_slots("2026-04-20")
    api.get_today_slots("2026-04-20", force=True)

    assert len(calls) == 2


def test_publish_neis_timetable_for_week_saves_materialized_slots(monkeypatch):
    store = FakeStore()
    store.settings = store.settings.model_copy(
        update={
            "timetable_mode": "neis",
            "assigned_lessons": [
                {
                    "grade": 2,
                    "class_no": "1",
                    "subject_name": "문학",
                    "neis_subject_label": "문학",
                    "subject_aliases": [],
                }
            ],
        }
    )
    store.saved_timetable = None
    store.save_timetable = lambda timetable: setattr(store, "saved_timetable", timetable)
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: {
            "school": {"name": "수원고등학교"},
            "date": kwargs["date_str"],
            "lessons": [
                {"day": "월", "period": 2, "grade": 2, "classNo": "1", "subject": "문학", "neis": "문학"},
            ] if kwargs["date_str"] == "2026-04-20" else [],
        },
    )

    payload = json.loads(Api().publish_neis_timetable_for_week("2026-04-22"))

    assert payload == {"ok": True, "count": 1, "effectiveFrom": "2026-04-20"}
    assert store.saved_timetable.effective_from == "2026-04-20"
    assert store.saved_timetable.slots[0].id.startswith("neis-2-1-2-")
    assert store.saved_timetable.slots[0].day_of_week == 1
    assert store.saved_timetable.slots[0].subject_name == "문학"


def test_publish_neis_timetable_accesses_drive_store_one_day_at_a_time(monkeypatch):
    # Regression: the Drive store (googleapiclient/httplib2) is not thread-safe,
    # so the five weekdays must hit it sequentially, never concurrently.
    import threading
    import time as _time

    store = FakeStore()
    store.settings = store.settings.model_copy(
        update={
            "timetable_mode": "neis",
            "assigned_lessons": [
                {"grade": 2, "class_no": "1", "subject_name": "문학", "neis_subject_label": "문학", "subject_aliases": []}
            ],
        }
    )
    store.save_timetable = lambda timetable: None

    concurrency = {"active": 0, "max": 0}
    guard = threading.Lock()
    base_load_monthly = store.load_monthly

    def tracking_load_monthly(month):
        with guard:
            concurrency["active"] += 1
            concurrency["max"] = max(concurrency["max"], concurrency["active"])
        try:
            _time.sleep(0.02)  # widen the window for any overlap to show up
            return base_load_monthly(month)
        finally:
            with guard:
                concurrency["active"] -= 1

    store.load_monthly = tracking_load_monthly
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: {"school": {"name": "수원고등학교"}, "date": kwargs["date_str"], "lessons": []},
    )

    Api().publish_neis_timetable_for_week("2026-04-22")

    assert concurrency["max"] == 1


def test_publish_reuses_cached_monthly_across_weekdays(monkeypatch):
    # The five weekdays share a month, so the Drive month file is read once.
    store = FakeStore()
    store.settings = store.settings.model_copy(
        update={
            "timetable_mode": "neis",
            "assigned_lessons": [
                {"grade": 2, "class_no": "1", "subject_name": "문학", "neis_subject_label": "문학", "subject_aliases": []}
            ],
        }
    )
    store.save_timetable = lambda timetable: None

    calls = {"n": 0}
    base_load_monthly = store.load_monthly

    def counting_load_monthly(month):
        calls["n"] += 1
        return base_load_monthly(month)

    store.load_monthly = counting_load_monthly
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    monkeypatch.setattr(gui_api, "load_local_neis_api_key", lambda: "KEY")
    monkeypatch.setattr(
        gui_api,
        "query_class_timetable",
        lambda **kwargs: {"school": {"name": "수원고등학교"}, "date": kwargs["date_str"], "lessons": []},
    )

    Api().publish_neis_timetable_for_week("2026-04-22")

    assert calls["n"] == 1


def test_start_run_keeps_neis_browser_open_for_manual_verification(monkeypatch):
    calls = []

    class ImmediateThread:
        def __init__(self, target, daemon):
            assert daemon is True
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(gui_api.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(gui_api, "run_day", lambda *args, **kwargs: calls.append((args, kwargs)) or [])

    Api().start_run("2026-04-20", "pw", False)

    assert calls == [(("2026-04-20", "pw", False), {"keep_browser_open": True})]


def test_student_file_import_parses_headered_csv(tmp_path: Path):
    source = tmp_path / "students.csv"
    source.write_text("번호,이름\n1,김도윤\n2,김민서\n", encoding="utf-8-sig")

    payload = gui_api._parse_student_file(source, "2-1")

    assert payload == {
        "classKey": "2-1",
        "students": [{"n": 1, "name": "김도윤"}, {"n": 2, "name": "김민서"}],
    }


def test_student_file_import_parses_xlsx_first_sheet(tmp_path: Path):
    from openpyxl import Workbook

    source = tmp_path / "students.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["번호", "성명"])
    sheet.append([7, "박서연"])
    sheet.append([8, "이준호"])
    workbook.save(source)

    payload = gui_api._parse_student_file(source, "1-3")

    assert payload["classKey"] == "1-3"
    assert payload["students"] == [{"n": 7, "name": "박서연"}, {"n": 8, "name": "이준호"}]


def test_reconnect_runs_interactive_auth_then_returns_account(monkeypatch):
    called = {}
    monkeypatch.setattr(
        "subject_teacher.auth.google_oauth.authorize_interactive",
        lambda: called.setdefault("auth", True),
    )
    a = gui_api.Api.__new__(gui_api.Api)
    monkeypatch.setattr(a, "get_drive_user", lambda: json.dumps({"emailAddress": "x@y.com"}), raising=False)

    payload = json.loads(a.reconnect())

    assert called.get("auth") is True
    assert payload["emailAddress"] == "x@y.com"


def test_save_password_persists_via_local_store(monkeypatch):
    saved = {}
    monkeypatch.setattr("subject_teacher.state.save_local_password", lambda pw: saved.setdefault("pw", pw))
    a = gui_api.Api.__new__(gui_api.Api)
    payload = json.loads(a.save_password("p84848484!"))
    assert payload == {"ok": True}
    assert saved["pw"] == "p84848484!"
