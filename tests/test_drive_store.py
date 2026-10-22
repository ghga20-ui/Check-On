from unittest.mock import MagicMock

from subject_teacher.drive.schemas import (
    Absence,
    MarkType,
    MonthlyAttendance,
    SlotAttendance,
    Students,
    StudentEntry,
)
from subject_teacher.drive.store import DriveStore
from subject_teacher.drive.client import JsonSnapshot


def client_with(read_map: dict):
    client = MagicMock()
    client.read_json.side_effect = lambda name: read_map.get(name)
    client.read_snapshot.side_effect = lambda name: JsonSnapshot("id" if name in read_map else None, "v1", read_map.get(name))
    return client


def test_load_settings_none_when_absent():
    store = DriveStore(client=client_with({}))

    assert store.load_settings() is None


def test_load_and_save_settings():
    client = client_with(
        {
            "settings.json": {
                "schemaVersion": 1,
                "teacherName": "홍길동",
                "schoolName": "○○고",
                "region": "경기",
                "semester": {"year": 2026, "term": 1},
                "closeByDefault": False,
                "updatedAt": "2026-04-17T09:00:00+09:00",
            }
        }
    )
    store = DriveStore(client=client)

    settings = store.load_settings()

    assert settings is not None
    assert settings.teacher_name == "홍길동"

    store.save_settings(settings)

    client.upsert_json.assert_called_once()
    name, payload = client.upsert_json.call_args.args
    assert name == "settings.json"
    assert payload["teacherName"] == "홍길동"


def test_monthly_filename_format():
    store = DriveStore(client=client_with({}))

    assert store._monthly_filename("2026-04") == "attendance-2026-04.json"


def test_load_monthly_returns_none_when_absent():
    store = DriveStore(client=client_with({}))

    assert store.load_monthly("2026-04") is None


def test_save_monthly_roundtrip():
    client = client_with({})
    store = DriveStore(client=client)
    monthly = MonthlyAttendance(
        schemaVersion=1,
        month="2026-04",
        records={
            "2026-04-17": {
                "mon-1": SlotAttendance(
                    absences=[Absence(studentNumber=15, markType=MarkType.EXCUSED, note="")],
                    checkedAt="2026-04-17T09:55:00+09:00",
                    source="mobile",
                    syncedToNeis=False,
                    closedOnNeis=False,
                )
            }
        },
    )

    store.save_monthly(monthly)

    name, payload, snapshot = client.write_snapshot.call_args.args
    assert name == "attendance-2026-04.json"
    assert payload["month"] == "2026-04"


class _MemClient:
    def __init__(self):
        self.files = {}

    def read_json(self, name):
        return self.files.get(name)

    def upsert_json(self, name, data):
        self.files[name] = data
        return "id-" + name


def test_save_students_strips_names_before_writing_to_drive():
    client = _MemClient()
    store = DriveStore(client)
    store.save_students(
        Students(schemaVersion=1, classes={"2-3": [StudentEntry(number=5, name="김가나")]})
    )
    written = client.files["students.json"]
    # only numbers reach Drive — name must be empty in the stored payload
    assert written["classes"]["2-3"][0]["number"] == 5
    assert written["classes"]["2-3"][0]["name"] == ""


def test_load_students_round_trips_numbers():
    client = _MemClient()
    store = DriveStore(client)
    store.save_students(Students(schemaVersion=1, classes={"2-3": [StudentEntry(number=5, name="X")]}))
    loaded = store.load_students()
    assert loaded.classes["2-3"][0].number == 5
    assert loaded.classes["2-3"][0].name == ""
