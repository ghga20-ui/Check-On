import json

from subject_teacher.drive.schemas import (
    MarkType,
    MonthlyAttendance,
    Semester,
    Settings,
    Students,
    Timetable,
    TimetableSlot,
)
from subject_teacher.gui import api as gui_api
from subject_teacher.gui.api import Api


class FakeStore:
    def __init__(self):
        self.settings = Settings(
            schemaVersion=1,
            teacherName="교사",
            schoolName="테스트고",
            region="경기",
            semester=Semester(year=2026, term=1),
            closeByDefault=False,
            updatedAt="2026-05-05T09:00:00+09:00",
        )
        self.timetable = Timetable(
            schemaVersion=1,
            effectiveFrom="2026-03-02",
            slots=[
                TimetableSlot(
                    id="mon-3",
                    dayOfWeek=1,
                    period=3,
                    grade=2,
                    classNo="1",
                    subjectName="문학",
                    neisSubjectLabel="문학",
                )
            ],
        )
        self.students = Students(
            schemaVersion=1,
            classes={"2-1": [{"number": 3, "name": "김도윤"}]},
        )
        self.saved_monthly = None

    def load_settings(self):
        return self.settings

    def load_timetable(self):
        return self.timetable

    def load_students(self):
        return self.students

    def load_monthly(self, month):
        assert month == "2026-05"
        return None

    def save_monthly(self, monthly):
        self.saved_monthly = monthly


def test_mobile_snapshot_returns_drive_json_contract(monkeypatch):
    monkeypatch.setattr(gui_api, "build_store", lambda: FakeStore())

    payload = json.loads(Api().get_mobile_snapshot("2026-05-04"))

    assert payload["settings"]["schoolName"] == "테스트고"
    assert payload["timetable"]["slots"][0]["classNo"] == "1"
    assert payload["students"]["classes"]["2-1"][0]["name"] == "김도윤"
    assert payload["attendanceByDate"] == {}
    assert payload["queue"] == []
    assert payload["isOnline"] is True
    assert payload["drive"]["authStatus"] == "connected"
    assert payload["drive"]["syncStatus"] == "idle"


def test_mobile_save_writes_mobile_source_and_resets_neis_flags(monkeypatch):
    store = FakeStore()
    monkeypatch.setattr(gui_api, "build_store", lambda: store)
    attendance_payload = json.dumps(
        {
            "absences": [{"studentNumber": 3, "markType": "absent", "note": ""}],
            "checkedAt": "2026-05-04T10:55:00+09:00",
            "source": "pc",
            "syncedToNeis": True,
            "closedOnNeis": True,
        },
        ensure_ascii=False,
    )

    payload = json.loads(Api().save_mobile_slot_attendance("2026-05-04", "mon-3", attendance_payload))

    assert payload["attendanceByDate"]["2026-05-04"]["mon-3"]["source"] == "mobile"
    assert payload["attendanceByDate"]["2026-05-04"]["mon-3"]["syncedToNeis"] is False
    assert payload["attendanceByDate"]["2026-05-04"]["mon-3"]["closedOnNeis"] is False
    assert payload["drive"]["authStatus"] == "connected"
    assert isinstance(store.saved_monthly, MonthlyAttendance)
    saved = store.saved_monthly.records["2026-05-04"]["mon-3"]
    assert saved.source == "mobile"
    assert [(absence.student_number, absence.mark_type) for absence in saved.absences] == [
        (3, MarkType.ABSENT),
    ]
