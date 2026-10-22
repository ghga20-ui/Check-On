"""Typed facade over Drive appDataFolder JSON storage."""
from __future__ import annotations

from copy import deepcopy

from subject_teacher.drive.client import DriveAppDataClient, PreconditionFailed
from subject_teacher.drive.concurrency import DriveConflictError, merge_records
from subject_teacher.drive.migrations import migrate, migrate_mixed
from subject_teacher.drive.schemas import MonthlyAttendance, Settings, Students, StudentEntry, Timetable, numbers_only
from subject_teacher.drive.mixed import MixedGroups, strip_names, validate_attendance


class DriveStore:
    SETTINGS = "settings.json"
    TIMETABLE = "timetable.json"
    STUDENTS = "students.json"
    MIXED_GROUPS = "mixed-groups.json"

    def __init__(self, client: DriveAppDataClient):
        self._client = client

    @property
    def client(self) -> DriveAppDataClient:
        return self._client

    def load_settings(self) -> Settings | None:
        raw = self._client.read_json(self.SETTINGS)
        if raw is None:
            return None
        return Settings.model_validate(migrate(raw))

    def save_settings(self, settings: Settings) -> str:
        return self._client.upsert_json(
            self.SETTINGS,
            settings.model_dump(by_alias=True, mode="json"),
        )

    def load_timetable(self) -> Timetable | None:
        raw = self._client.read_json(self.TIMETABLE)
        if raw is None:
            return None
        return Timetable.model_validate(migrate(raw))

    def save_timetable(self, timetable: Timetable) -> str:
        return self._client.upsert_json(
            self.TIMETABLE,
            timetable.model_dump(by_alias=True, mode="json"),
        )

    @staticmethod
    def _monthly_filename(month: str) -> str:
        return f"attendance-{month}.json"

    def load_monthly(self, month: str) -> MonthlyAttendance | None:
        raw = self._client.read_snapshot(self._monthly_filename(month)).data
        if raw is None:
            return None
        monthly = MonthlyAttendance.model_validate(migrate(raw))
        monthly._drive_base = deepcopy(monthly.model_dump(by_alias=True, mode="json")["records"])
        return monthly

    def save_monthly(self, monthly: MonthlyAttendance) -> str:
        name = self._monthly_filename(monthly.month)
        desired = monthly.model_dump(by_alias=True, mode="json")
        base = monthly._drive_base or {}
        has_mixed = any(att.group_id for day in monthly.records.values() for att in day.values())
        if has_mixed:
            if not self._client.encryption_enabled:
                raise ValueError("이동수업은 암호화 연결 후 저장할 수 있습니다.")
            groups = self.load_mixed_groups()
            for date, day in monthly.records.items():
                for slot_id, att in day.items():
                    if att.group_id:
                        # Flag-only saves of historical records remain valid.
                        previous = dict(base.get(date, {}).get(slot_id) or {})
                        incoming = att.model_dump(by_alias=True, mode="json")
                        for key in ("syncedToNeis", "closedOnNeis"):
                            previous.pop(key, None)
                            incoming.pop(key, None)
                        validate_attendance(groups, att, current=previous != incoming)
            desired["schemaVersion"] = 2
        for _ in range(4):
            snapshot = self._client.read_snapshot(name)
            latest = (MonthlyAttendance.model_validate(migrate(snapshot.data))
                      .model_dump(by_alias=True, mode="json")) if snapshot.data else {
                          "schemaVersion": desired["schemaVersion"], "month": monthly.month, "records": {}
                      }
            latest["records"] = merge_records(base, desired["records"], latest["records"])
            latest["schemaVersion"] = max(latest["schemaVersion"], desired["schemaVersion"])
            try:
                file_id = self._client.write_snapshot(name, latest, snapshot)
            except PreconditionFailed:
                continue
            monthly.records = MonthlyAttendance.model_validate(latest).records
            monthly.schema_version = latest["schemaVersion"]
            monthly._drive_base = deepcopy(latest["records"])
            return file_id
        raise DriveConflictError("다른 기기에서 저장 중입니다. 최신 기록을 불러온 뒤 다시 저장해 주세요.")

    def load_mixed_groups(self) -> MixedGroups:
        snapshot = self._client.read_snapshot(self.MIXED_GROUPS)
        return MixedGroups.model_validate(migrate_mixed(snapshot.data)) if snapshot.data else MixedGroups()

    def purge_mixed_group(self, group_id: str) -> None:
        """Explicit class deletion only; normal roster saves still preserve history."""
        snapshot = self._client.read_snapshot(self.MIXED_GROUPS)
        if not snapshot.data:
            return
        document = MixedGroups.model_validate(migrate_mixed(snapshot.data))
        if group_id not in document.groups:
            return
        del document.groups[group_id]
        document.revision += 1
        self._client.write_snapshot(self.MIXED_GROUPS, strip_names(document), snapshot)

    def save_mixed_groups(self, document: MixedGroups, expected_revision: int) -> str:
        if not self._client.encryption_enabled:
            raise ValueError("설정에서 모바일 암호화 연결을 먼저 완료해 주세요.")
        snapshot = self._client.read_snapshot(self.MIXED_GROUPS)
        current = MixedGroups.model_validate(migrate_mixed(snapshot.data)) if snapshot.data else MixedGroups()
        if current.revision != expected_revision or document.revision != expected_revision + 1:
            raise DriveConflictError("명부가 다른 곳에서 변경됐습니다. 다시 불러와 비교해 주세요.")
        old_groups = strip_names(current)["groups"]
        new_groups = strip_names(document)["groups"]
        for group_id, old in old_groups.items():
            new = new_groups.get(group_id)
            if new is None or any(new[key] != old[key] for key in (
                "grade", "classNo", "subjectName", "neisSubjectLabel"
            )) or any(new["history"].get(version) != roster for version, roster in old["history"].items()):
                raise ValueError("기존 수업과 과거 명부 이력은 변경하거나 삭제할 수 없습니다.")
        return self._client.write_snapshot(self.MIXED_GROUPS, strip_names(document), snapshot)

    def load_students(self) -> Students | None:
        raw = self._client.read_json(self.STUDENTS)
        if raw is None:
            return None
        return Students.model_validate(migrate(raw))

    def save_students(self, students: Students) -> str:
        """Persist roster to Drive with names stripped — only numbers leave the device."""
        return self._client.upsert_json(
            self.STUDENTS,
            numbers_only(students).model_dump(by_alias=True, mode="json"),
        )
