"""Shared state and text serialization helpers for the subject teacher GUI."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type

from subject_teacher.auth.google_oauth import get_credentials
from subject_teacher.auth.token_store import (
    TokenNotFoundError,
    delete_token,
    load_token,
    save_token,
)
from subject_teacher.drive.client import DriveAppDataClient
from subject_teacher.drive.schemas import (
    SCHEMA_VERSION,
    MonthlyAttendance,
    Semester,
    Settings,
    StudentEntry,
    Students,
    Timetable,
    TimetableSlot,
)
from subject_teacher.drive.store import DriveStore
from subject_teacher.paths import get_neis_api_key_path, get_password_path


DAY_NAME_TO_NUMBER = {
    "mon": 1,
    "tue": 2,
    "wed": 3,
    "thu": 4,
    "fri": 5,
}
DAY_NUMBER_TO_NAME = {value: key for key, value in DAY_NAME_TO_NUMBER.items()}


@dataclass
class DaySlotSummary:
    slot_id: str
    period: int
    grade: int
    class_no: str
    subject_name: str
    neis_subject_label: str
    checked: bool
    absence_count: int
    synced_to_neis: bool
    closed_on_neis: bool


@dataclass
class AppState:
    selected_date: str
    close_after: bool = True
    auth_ready: bool = False
    busy: bool = False
    settings: Settings | None = None
    timetable: Timetable | None = None
    students: Students | None = None


_students_migrated = False


def build_store() -> DriveStore:
    global _students_migrated
    credentials = get_credentials()
    from subject_teacher.drive.crypto import load_sync_key

    client = DriveAppDataClient(credentials=credentials, sync_key=load_sync_key())
    if not _students_migrated:
        try:
            from subject_teacher.local_store import migrate_students_from_drive

            migrate_students_from_drive(client)
        except Exception:
            pass  # never block startup on migration
        _students_migrated = True
    return DriveStore(client)


def save_local_password(password: str) -> None:
    save_token(get_password_path(), {"password": password})


def load_local_password() -> str:
    try:
        payload = load_token(get_password_path())
    except TokenNotFoundError:
        return ""
    return str(payload.get("password", ""))


def clear_local_password() -> None:
    delete_token(get_password_path())


def save_local_neis_api_key(api_key: str) -> None:
    save_token(get_neis_api_key_path(), {"api_key": api_key})


def load_local_neis_api_key() -> str:
    try:
        payload = load_token(get_neis_api_key_path())
    except TokenNotFoundError:
        return ""
    return str(payload.get("api_key", ""))


def default_settings(region: str, year: int, term: int) -> Settings:
    today = date_type.today().isoformat()
    return Settings(
        schemaVersion=SCHEMA_VERSION,
        teacherName="",
        schoolName="",
        region=region,
        semester=Semester(year=year, term=term),
        closeByDefault=False,
        updatedAt=f"{today}T09:00:00+09:00",
    )


def serialize_timetable_tsv(timetable: Timetable | None) -> str:
    if timetable is None:
        return ""
    lines = [
        "slot_id\tday\tperiod\tgrade\tclass_no\tsubject_name\tneis_subject_label",
    ]
    for slot in timetable.slots:
        lines.append(
            "\t".join(
                [
                    slot.id,
                    DAY_NUMBER_TO_NAME.get(slot.day_of_week, str(slot.day_of_week)),
                    str(slot.period),
                    str(slot.grade),
                    str(slot.class_no),
                    slot.subject_name,
                    slot.neis_subject_label,
                ]
            )
        )
    return "\n".join(lines)


def parse_timetable_tsv(raw: str, effective_from: str) -> Timetable:
    slots: list[TimetableSlot] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("slot_id\t"):
            continue
        parts = [part.strip() for part in stripped.split("\t")]
        if len(parts) not in (6, 7):
            raise ValueError(f"invalid timetable row: {line!r}")
        slot_id, day_name, period, grade, class_no, subject_name = parts[:6]
        neis_label = parts[6] if len(parts) == 7 else subject_name
        neis_label = neis_label or subject_name
        day_value = DAY_NAME_TO_NUMBER.get(day_name.lower())
        if day_value is None:
            raise ValueError(f"unknown day name: {day_name!r}")
        slots.append(
            TimetableSlot(
                id=slot_id,
                dayOfWeek=day_value,
                period=int(period),
                grade=int(grade),
                classNo=class_no,
                subjectName=subject_name,
                neisSubjectLabel=neis_label,
            )
        )
    return Timetable(
        schemaVersion=SCHEMA_VERSION,
        effectiveFrom=effective_from,
        slots=slots,
    )


def serialize_students_tsv(students: Students | None) -> str:
    if students is None:
        return ""
    lines = ["class_key\tnumber\tname"]
    for class_key in sorted(students.classes):
        for student in students.classes[class_key]:
            lines.append(f"{class_key}\t{student.number}\t{student.name}")
    return "\n".join(lines)


def parse_students_tsv(raw: str) -> Students:
    classes: dict[str, list[StudentEntry]] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("class_key\t"):
            continue
        parts = [part.strip() for part in line.split("\t")]
        if len(parts) != 3:
            raise ValueError(f"invalid students row: {line!r}")
        class_key, number, name = parts
        classes.setdefault(class_key, []).append(
            StudentEntry(number=int(number), name=name)
        )
    return Students(schemaVersion=SCHEMA_VERSION, classes=classes)


def summarize_day(store: DriveStore, date_str: str) -> list[DaySlotSummary]:
    timetable = store.load_timetable()
    if timetable is None:
        return []

    weekday = date_type.fromisoformat(date_str).isoweekday()
    monthly = store.load_monthly(date_str[:7])
    day_records = monthly.records.get(date_str, {}) if monthly else {}

    summaries: list[DaySlotSummary] = []
    for slot in timetable.slots:
        if slot.day_of_week != weekday:
            continue
        attendance = day_records.get(slot.id)
        summaries.append(
            DaySlotSummary(
                slot_id=slot.id,
                period=slot.period,
                grade=slot.grade,
                class_no=slot.class_no,
                subject_name=slot.subject_name,
                neis_subject_label=slot.neis_subject_label,
                checked=attendance is not None,
                absence_count=len(attendance.absences) if attendance else 0,
                synced_to_neis=attendance.synced_to_neis if attendance else False,
                closed_on_neis=attendance.closed_on_neis if attendance else False,
            )
        )
    summaries.sort(key=lambda item: item.period)
    return summaries


def latest_monthly(store: DriveStore, month: str) -> MonthlyAttendance | None:
    return store.load_monthly(month)
