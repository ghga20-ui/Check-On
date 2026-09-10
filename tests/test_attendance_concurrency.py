from copy import deepcopy

import pytest

from subject_teacher.app_service import update_flags
from subject_teacher.drive.client import JsonSnapshot, PreconditionFailed
from subject_teacher.drive.concurrency import DriveConflictError
from subject_teacher.drive.schemas import MonthlyAttendance, SlotAttendance
from subject_teacher.drive.store import DriveStore

DAY = "2026-09-09"


def slot(number=1, checked="2026-09-09T10:00:00+09:00"):
    return SlotAttendance(absences=[{"studentNumber": number, "markType": "absent"}],
                          checkedAt=checked, source="mobile")


class VersionedMemory:
    def __init__(self):
        self.data = None
        self.version = 0
        self.before_write = None

    def read_snapshot(self, name):
        return JsonSnapshot("file" if self.data else None, str(self.version), deepcopy(self.data))

    def write_snapshot(self, name, payload, snapshot):
        if self.before_write:
            hook, self.before_write = self.before_write, None
            hook()
        if snapshot.etag != str(self.version):
            raise PreconditionFailed("conflict")
        self.data = deepcopy(payload)
        self.version += 1
        return "file"


def setup_store():
    client = VersionedMemory()
    store = DriveStore(client)
    store.save_monthly(MonthlyAttendance(month="2026-09", records={DAY: {"a": slot()}}))
    return client, store


def test_other_slot_concurrent_edit_is_merged_even_when_it_lands_during_upload():
    client, pc = setup_store()
    mobile = DriveStore(client)
    first, second = pc.load_monthly("2026-09"), mobile.load_monthly("2026-09")
    first.records[DAY]["b"] = slot(2)
    second.records[DAY]["c"] = slot(3)
    client.before_write = lambda: mobile.save_monthly(second)
    pc.save_monthly(first)
    assert set(pc.load_monthly("2026-09").records[DAY]) == {"a", "b", "c"}


def test_same_slot_conflict_preserves_remote_and_local_draft():
    client, pc = setup_store()
    mobile = DriveStore(client)
    local, remote = pc.load_monthly("2026-09"), mobile.load_monthly("2026-09")
    local.records[DAY]["a"] = slot(2)
    remote.records[DAY]["a"] = slot(3)
    mobile.save_monthly(remote)
    with pytest.raises(DriveConflictError):
        pc.save_monthly(local)
    assert pc.load_monthly("2026-09").records[DAY]["a"].absences[0].student_number == 3
    assert local.records[DAY]["a"].absences[0].student_number == 2


def test_delete_does_not_remove_a_concurrently_edited_slot():
    client, store = setup_store()
    deleted, edited = store.load_monthly("2026-09"), store.load_monthly("2026-09")
    del deleted.records[DAY]["a"]
    edited.records[DAY]["a"] = slot(3)
    store.save_monthly(edited)
    with pytest.raises(DriveConflictError):
        store.save_monthly(deleted)


def test_lost_success_response_can_be_retried_without_conflict():
    client, store = setup_store()
    first = store.load_monthly("2026-09")
    first.records[DAY]["b"] = slot(2)
    retry = first.model_copy(deep=True)
    store.save_monthly(first)
    store.save_monthly(retry)
    assert set(store.load_monthly("2026-09").records[DAY]) == {"a", "b"}


def test_flags_only_mark_exact_input_complete():
    _, store = setup_store()
    expected = slot()
    update_flags(store, "2026-09", "a", DAY, True, False, expected=expected)
    assert store.load_monthly("2026-09").records[DAY]["a"].synced_to_neis


def test_flags_reject_edit_during_automation():
    _, store = setup_store()
    monthly = store.load_monthly("2026-09")
    monthly.records[DAY]["a"] = slot(9)
    store.save_monthly(monthly)
    with pytest.raises(DriveConflictError, match="수정"):
        update_flags(store, "2026-09", "a", DAY, True, False, expected=slot())
    assert not store.load_monthly("2026-09").records[DAY]["a"].synced_to_neis


def test_flags_reject_edit_between_validation_and_upload():
    client, store = setup_store()
    def change():
        other = DriveStore(client)
        monthly = other.load_monthly("2026-09")
        monthly.records[DAY]["a"] = slot(9)
        other.save_monthly(monthly)
    client.before_write = change
    with pytest.raises(DriveConflictError):
        update_flags(store, "2026-09", "a", DAY, True, False, expected=slot())
    assert not store.load_monthly("2026-09").records[DAY]["a"].synced_to_neis


def test_flags_reject_deleted_record_and_do_not_recreate_it():
    _, store = setup_store()
    monthly = store.load_monthly("2026-09")
    del monthly.records[DAY]["a"]
    store.save_monthly(monthly)
    with pytest.raises(DriveConflictError, match="삭제"):
        update_flags(store, "2026-09", "a", DAY, True, False, expected=slot())
    assert "a" not in store.load_monthly("2026-09").records[DAY]


def test_private_baseline_never_changes_drive_schema():
    _, store = setup_store()
    assert set(store.load_monthly("2026-09").model_dump()) == {"schema_version", "month", "records"}
