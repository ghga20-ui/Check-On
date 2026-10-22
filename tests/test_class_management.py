from copy import deepcopy
from unittest.mock import MagicMock
import pytest

from subject_teacher.class_management import remove_class
from subject_teacher.drive.schemas import Settings, Timetable, Students, MonthlyAttendance, SlotAttendance
from subject_teacher.drive.mixed import MixedGroups, revise_group, strip_names
from subject_teacher.drive.store import DriveStore
from subject_teacher.drive.client import JsonSnapshot
from subject_teacher.attendance_history import load_history


def store_for(class_no="1", document=None):
    lessons = [dict(grade=2, classNo=c, subjectName="문학", neisSubjectLabel="문학") for c in [class_no, "9"]]
    settings = Settings(teacherName="T", schoolName="S", region="경기", semester=dict(year=2026, term=2), updatedAt="2026-09-11", assignedLessons=lessons)
    timetable = Timetable(effectiveFrom="2026-09-07", slots=[dict(id=str(i), dayOfWeek=1, period=i+1, **lesson) for i, lesson in enumerate(lessons)])
    files = {"settings.json": settings.model_dump(by_alias=True), "timetable.json":timetable.model_dump(by_alias=True), "mixed-groups.json":strip_names(document or MixedGroups()), "students.json":Students(classes={"2-1":[dict(number=1)], "2-9":[dict(number=2)]}).model_dump(by_alias=True)}
    client = MagicMock()
    client.encryption_enabled = True
    client.read_json.side_effect = lambda name: deepcopy(files.get(name))
    client.read_snapshot.side_effect = lambda name: JsonSnapshot(name, "v1", deepcopy(files.get(name)))
    client.list_files.side_effect = lambda: list(files)
    client.upsert_json.side_effect = lambda name, data: files.update({name:deepcopy(data)})
    client.write_snapshot.side_effect = lambda name, data, snapshot: files.update({name:deepcopy(data)})
    return DriveStore(client), files


def attendance(**kw):
    return SlotAttendance(absences=[], checkedAt="2026-09-01T00:00:00Z", source="pc", **kw)


def test_class_deletion_removes_homeroom_reasons_all_months():
    store, files = store_for()
    for month in ['2025-01', '2026-09']:
        files[f'homeroom-{month}.json'] = {'schemaVersion':1,'month':month,'records':{month+'-07':{
            key:{'revision':1,'events':[dict(id=key,number=1,kind='absent',category='illness',reason='진료',startPeriod=None,endPeriod=None)]}
            for key in ['2-1','2-9']
        }}}
    remove_class(store,'2-1')
    for month in ['2025-01','2026-09']:
        assert set(files[f'homeroom-{month}.json']['records'][month+'-07'])=={'2-9'}


def test_removes_all_months_and_manual_ids_but_preserves_other_classes():
    store, files = store_for()
    for month in ["2025-01", "2026-09"]:
        files[f"attendance-{month}.json"] = MonthlyAttendance(month=month, records={month+"-07":{
            "neis-2-1-3-문학":attendance(), "neis-2-9-3-문학":attendance(),
        }}).model_dump(by_alias=True)
    # Monday manual slot must be resolved before timetable deletion.
    files["attendance-2026-09.json"]["records"]["2026-09-07"]["0"] = attendance().model_dump(by_alias=True)
    remove_class(store, "2-1")
    remove_class(store, "2-1")
    assert [l.class_no for l in store.load_settings().assigned_lessons] == ["9"]
    assert "2-1" not in store.load_students().classes
    assert "2-1" not in {c["key"] for c in load_history(store, "2026-09-01", "2026-09-30")["classes"]}
    for month in ["2025-01", "2026-09"]:
        assert set(store.load_monthly(month).records[month+"-07"]) == {"neis-2-9-3-문학"}


def test_deletes_previously_archived_mixed_class_and_its_history():
    payload = dict(grade=2, classNo="a", subjectName="문학", students=[dict(grade=2, homeClassNo="1", number=1, name="합성학생")])
    doc = revise_group(MixedGroups(), payload)
    group = next(iter(doc.groups.values()))
    group.archived = True
    store, files = store_for("a", doc)
    files["attendance-2026-09.json"] = MonthlyAttendance(month="2026-09", records={"2026-09-07":{
        "old-id":attendance(groupId=group.id, rosterRevision=1), "neis-2-9-3-문학":attendance(),
    }}).model_dump(by_alias=True)
    remove_class(store, "mixed:"+group.id)
    remove_class(store, "mixed:"+group.id)
    assert group.id not in store.load_mixed_groups().groups
    assert set(store.load_monthly("2026-09").records["2026-09-07"]) == {"neis-2-9-3-문학"}


def test_failed_history_write_keeps_class_metadata_for_retry():
    store, files = store_for()
    files["attendance-2026-09.json"] = MonthlyAttendance(month="2026-09", records={"2026-09-07":{"0":attendance()}}).model_dump(by_alias=True)
    store.client.write_snapshot.side_effect = RuntimeError("connection failed")
    with pytest.raises(RuntimeError):
        remove_class(store, "2-1")
    assert store.load_settings().assigned_lessons[0].class_no == "1"
    assert store.load_timetable().slots[0].id == "0"
    assert "0" in store.load_monthly("2026-09").records["2026-09-07"]
