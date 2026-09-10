"""Synthetic-only mixed roster, privacy and historical compatibility checks."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from subject_teacher.drive.client import DriveAppDataClient, JsonSnapshot
from subject_teacher.drive.concurrency import DriveConflictError
from subject_teacher.drive.migrations import migrate, UnsupportedSchemaVersionError
from subject_teacher.drive.mixed import MixedGroups, revise_group, strip_names, validate_attendance
from subject_teacher.drive.schemas import Absence, MonthlyAttendance, SlotAttendance
from subject_teacher.drive.store import DriveStore
from subject_teacher.mixed_service import preview_rows, matching_group


def payload(**overrides):
    return dict(grade=2, classNo="선택A", subjectName="문학", students=[
        {"grade": 2, "homeClassNo": "1", "number": 5, "name": "합성가"},
        {"grade": 2, "homeClassNo": "3", "number": 5, "name": "합성나"},
    ], **overrides)


def document():
    return revise_group(MixedGroups(), payload())


def record(doc):
    group = next(iter(doc.groups.values()))
    return SlotAttendance(groupId=group.id, rosterRevision=group.revision,
        absences=[{"studentId": s.student_id, "markType": mark}
                  for s, mark in zip(group.students, ["absent", "excused"])],
        checkedAt="2026-09-10T01:00:00Z", source="mobile")


def fake_client(files=None, encrypted=True):
    client = MagicMock()
    client.encryption_enabled = encrypted
    files = files or {}
    client.read_snapshot.side_effect = lambda name: JsonSnapshot(
        "id" if name in files else None, "v1", deepcopy(files.get(name)))
    return client


def test_same_number_different_classes_have_distinct_opaque_ids():
    doc = document()
    group = next(iter(doc.groups.values()))
    assert len({s.student_id for s in group.students}) == 2
    assert [s.number for s in group.students] == [5, 5]
    assert matching_group(doc, 2, "선택A", "문학") == group
    assert matching_group(doc, 2, "선택A", "영어") is None


def test_reimport_preserves_ids_and_removed_history():
    doc = document()
    group = next(iter(doc.groups.values()))
    update = payload(id=group.id)
    update["students"] = update["students"][1:]
    updated = revise_group(doc, update)
    assert updated.groups[group.id].students[0].student_id == group.students[1].student_id
    assert updated.groups[group.id].history["1"] == group.students
    assert len(doc.groups[group.id].students) == 2
    restored = revise_group(updated, payload(id=group.id))
    assert [s.student_id for s in restored.groups[group.id].students] == [s.student_id for s in group.students]


@pytest.mark.parametrize("field,value", [("grade", 3), ("homeClassNo", ""),
    ("number", 0), ("number", 100), ("number", 5.5), ("number", True)])
def test_invalid_rows_are_rejected_without_mutation(field, value):
    raw = payload()
    raw["students"][0][field] = value
    doc = MixedGroups()
    with pytest.raises(ValueError):
        revise_group(doc, raw)
    assert doc.revision == 0 and not doc.groups


def test_duplicate_identity_rejected():
    raw = payload()
    raw["students"].append(raw["students"][0])
    with pytest.raises(ValueError, match="중복"):
        revise_group(MixedGroups(), raw)


def test_cloud_strips_names_from_current_and_all_history():
    doc = document()
    raw = strip_names(doc)
    assert "합성" not in str(raw)
    assert "name" not in str(raw)
    assert next(iter(doc.groups.values())).students[0].name == "합성가"
    client = fake_client()
    DriveStore(client).save_mixed_groups(doc, 0)
    assert client.write_snapshot.call_args.args[1] == raw


def test_legacy_serialization_is_unchanged():
    att = SlotAttendance(absences=[Absence(studentNumber=5, markType="absent")], checkedAt="now")
    raw = att.model_dump(by_alias=True)
    assert "groupId" not in raw and "rosterRevision" not in raw
    assert raw["absences"] == [{"studentNumber": 5, "markType": "absent", "note": ""}]
    assert MonthlyAttendance(month="2026-09", records={"2026-09-10": {"s": att}}).schema_version == 1


def test_mixed_month_promotes_version_and_rejects_future():
    month = MonthlyAttendance(month="2026-09", records={"2026-09-10": {"s": record(document())}})
    assert month.schema_version == 2
    assert migrate(month.model_dump(by_alias=True))["schemaVersion"] == 2
    with pytest.raises(UnsupportedSchemaVersionError):
        migrate({"schemaVersion": 3, "month": "2026-09", "records": {}})


def test_history_can_be_read_but_stale_edit_rejected():
    doc = document()
    att = record(doc)
    updated = revise_group(doc, payload(id=att.group_id))
    validate_attendance(updated, att, current=False)
    with pytest.raises(ValueError, match="名簿|명부"):
        validate_attendance(updated, att)
    invalid = att.model_copy(deep=True)
    invalid.absences[0].student_id = "not-in-roster"
    with pytest.raises(ValueError, match="없는 학생"):
        validate_attendance(doc, invalid)


def test_encryption_required_at_store_and_low_level_boundary():
    doc = document()
    client = fake_client(encrypted=False)
    store = DriveStore(client)
    with pytest.raises(ValueError, match="암호화"):
        store.save_mixed_groups(doc, 0)
    with pytest.raises(ValueError, match="암호화"):
        store.save_monthly(MonthlyAttendance(month="2026-09", records={"2026-09-10": {"s": record(doc)}}))
    client.write_snapshot.assert_not_called()
    low = DriveAppDataClient.__new__(DriveAppDataClient)
    low._sync_key = None
    with pytest.raises(ValueError, match="암호화"):
        low._require_mixed_encryption("mixed-groups.json", strip_names(doc))
    low._require_mixed_encryption("students.json", {"classes": {}})


def test_roster_revision_conflict_and_history_tamper_rejected():
    doc = document()
    updated = revise_group(doc, payload(id=next(iter(doc.groups))))
    client = fake_client({"mixed-groups.json": strip_names(doc)})
    store = DriveStore(client)
    with pytest.raises(DriveConflictError):
        store.save_mixed_groups(updated, 0)
    updated.groups[next(iter(doc.groups))].history["1"] = []
    with pytest.raises(ValueError, match="이력"):
        store.save_mixed_groups(updated, 1)
    client.write_snapshot.assert_not_called()


def test_preview_separate_columns_and_ambiguous_combined_ids():
    rows = preview_rows([["반", "번호", "이름"], ["3", "5", "합성"]], 2)
    assert rows[0]["grade"] == "2" and rows[0]["homeClassNo"] == "3"
    rows = preview_rows([["학번"], ["20105"], ["123456"]], 2)
    assert (rows[0]["grade"], rows[0]["homeClassNo"], rows[0]["number"]) == ("2", "1", "5")
    assert rows[1]["rawStudentNumber"] == "123456" and rows[1]["number"] == ""


def test_mixed_month_store_roundtrip_keeps_both_identities():
    doc = document()
    client = fake_client({"mixed-groups.json": strip_names(doc)})
    month = MonthlyAttendance(month="2026-09", records={"2026-09-10": {"s": record(doc)}})
    DriveStore(client).save_monthly(month)
    raw = client.write_snapshot.call_args.args[1]
    restored = MonthlyAttendance.model_validate(raw)
    assert restored.schema_version == 2
    assert restored.records == month.records
    assert len({a.student_id for a in restored.records["2026-09-10"]["s"].absences}) == 2


def test_historical_flag_save_allowed_but_stale_edit_blocked():
    doc = document()
    att = record(doc)
    month = MonthlyAttendance(month="2026-09", records={"2026-09-10": {"s": att}})
    updated = revise_group(doc, payload(id=att.group_id))
    client = fake_client({"mixed-groups.json": strip_names(updated),
                          "attendance-2026-09.json": month.model_dump(by_alias=True)})
    store = DriveStore(client)
    loaded = store.load_monthly("2026-09")
    loaded.records["2026-09-10"]["s"].synced_to_neis = True
    store.save_monthly(loaded)
    client.write_snapshot.assert_called_once()
    loaded.records["2026-09-10"]["s"].checked_at = "new-edit"
    with pytest.raises(ValueError, match="명부가 변경"):
        store.save_monthly(loaded)
    assert client.write_snapshot.call_count == 1


def test_api_does_not_convert_existing_legacy_class(monkeypatch):
    from subject_teacher.gui import api as module
    api = module.Api()
    store = MagicMock()
    store.client.encryption_enabled = True
    store.load_mixed_groups.return_value = MixedGroups()
    store.load_timetable.return_value = SimpleNamespace(slots=[
        SimpleNamespace(grade=2, class_no="선택A", subject_name="문학")])
    store.load_settings.return_value = None
    monkeypatch.setattr(api, "_store", lambda: store)
    monkeypatch.setattr(module, "with_local_names", lambda doc: doc)
    result = json.loads(api.save_mixed_group(json.dumps(payload(expectedRevision=0))))
    assert "기존 통합학급" in result["error"]
    store.save_mixed_groups.assert_not_called()


def test_api_slot_decoration_keeps_historical_roster(monkeypatch):
    from subject_teacher.gui import api as module
    api = module.Api()
    doc = document()
    att = record(doc)
    changed = payload(id=att.group_id)
    changed["students"] = changed["students"][:1]
    updated = revise_group(doc, changed)
    store = MagicMock()
    store.load_mixed_groups.return_value = updated
    monthly = MonthlyAttendance(month="2026-09", records={"2026-09-10": {"s": att}})
    monkeypatch.setattr(module, "with_local_names", lambda doc: doc)
    monkeypatch.setattr(api, "_load_monthly_cached", lambda *_: monthly)
    result = api._decorate_mixed_slots(store, "2026-09-10", [
        {"id": "s", "grade": 2, "classNo": "선택A", "subject": "문학"}])[0]
    assert result["rosterRevision"] == 1 and result["currentRosterRevision"] == 2
    assert len(result["mixedStudents"]) == 2
