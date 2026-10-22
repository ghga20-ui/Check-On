"""Pydantic schemas for files stored in Google Drive appDataFolder."""
from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator, model_serializer
from pydantic.alias_generators import to_camel

import regions

SCHEMA_VERSION = 1

_CLASS_KEY_RE = re.compile(r"^\d+-[^\t\r\n]+$")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _normalize_class_no(value: object) -> str:
    if value is None:
        raise ValueError("classNo must not be blank")
    text = str(value).strip()
    if not text:
        raise ValueError("classNo must not be blank")
    if any(char in text for char in "\t\r\n"):
        raise ValueError("classNo must not contain tab or newline characters")
    return text


def _normalize_grade(value: object) -> int:
    if isinstance(value, str):
        match = re.search(r"\d+", value)
        if match:
            return int(match.group(0))
    return value


class _Base(BaseModel):
    """Base model with camelCase aliases and forgiving extra fields."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


class Semester(_Base):
    year: int = Field(ge=2024, le=2100)
    term: Literal[1, 2]


class AssignedLesson(_Base):
    grade: Annotated[int, Field(ge=1, le=3)]
    class_no: Annotated[str, Field(min_length=1, max_length=40)]
    subject_name: str
    neis_subject_label: str = ""
    subject_aliases: list[str] = Field(default_factory=list)

    @field_validator("grade", mode="before")
    @classmethod
    def validate_grade(cls, value: object) -> int:
        return _normalize_grade(value)

    @field_validator("class_no", mode="before")
    @classmethod
    def validate_class_no(cls, value: object) -> str:
        return _normalize_class_no(value)


class Settings(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    teacher_name: str
    school_name: str
    region: str
    # Standard school code (SD_SCHUL_CODE) + 학교급, confirmed via the school
    # picker. When set, NEIS timetable lookups use the code directly instead of
    # resolving by name, which disambiguates同名 schools. Empty for legacy data.
    school_code: str = ""
    school_kind: str = ""
    semester: Semester
    close_by_default: bool = False
    timetable_mode: Literal["manual", "neis"] = "neis"
    assigned_lessons: list[AssignedLesson] = Field(default_factory=list)
    updated_at: str

    @field_validator("region")
    @classmethod
    def validate_region(cls, value: str) -> str:
        if value not in regions.REGIONS:
            raise ValueError(f"unknown region: {value}")
        return value


class TimetableSlot(_Base):
    id: str
    day_of_week: Annotated[int, Field(ge=1, le=5)]
    period: Annotated[int, Field(ge=1, le=7)]
    grade: Annotated[int, Field(ge=1, le=3)]
    class_no: Annotated[str, Field(min_length=1, max_length=40)]
    subject_name: str
    neis_subject_label: str
    group_id: str | None = Field(default=None, exclude=True)

    @field_validator("class_no", mode="before")
    @classmethod
    def validate_class_no(cls, value: object) -> str:
        return _normalize_class_no(value)


class Timetable(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    effective_from: str
    slots: list[TimetableSlot]


class StudentEntry(_Base):
    number: Annotated[int, Field(ge=1, le=99)]
    name: str = ""


class Students(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    classes: dict[str, list[StudentEntry]]

    @field_validator("classes")
    @classmethod
    def validate_classes(cls, value: dict[str, list[StudentEntry]]) -> dict[str, list[StudentEntry]]:
        for key in value:
            if not _CLASS_KEY_RE.match(key) or not key.split("-", 1)[1].strip():
                raise ValueError(f"class key must match 'grade-classNo', got {key!r}")
        return value


class MarkType(str, Enum):
    ABSENT = "absent"
    EXCUSED = "excused"


class Absence(_Base):
    student_number: Annotated[int | None, Field(ge=1, le=99)] = None
    student_id: str | None = None
    mark_type: MarkType
    note: str = ""

    @model_validator(mode="after")
    def validate_identity(self):
        if (self.student_number is None) == (self.student_id is None):
            raise ValueError("학생 번호 또는 학생 ID 하나가 필요합니다.")
        if self.student_id is not None and not self.student_id.strip():
            raise ValueError("학생 ID가 비어 있습니다.")
        return self

    @model_serializer(mode="wrap")
    def serialize_identity(self, handler):
        return {key: value for key, value in handler(self).items() if value is not None}


class SlotAttendance(_Base):
    absences: list[Absence]
    checked_at: str
    source: Literal["mobile", "pc"] = "mobile"
    synced_to_neis: bool = False
    closed_on_neis: bool = False
    group_id: str | None = None
    roster_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_group(self):
        mixed = self.group_id is not None
        if mixed != (self.roster_revision is not None) or (mixed and not self.group_id.strip()):
            raise ValueError("이동수업 ID와 명부 버전이 필요합니다.")
        if any((a.student_id is not None) != mixed for a in self.absences):
            raise ValueError("수업 유형과 학생 식별자가 일치하지 않습니다.")
        keys = [a.student_id or a.student_number for a in self.absences]
        if len(keys) != len(set(keys)):
            raise ValueError("출결에 같은 학생이 중복되었습니다.")
        return self

    @model_serializer(mode="wrap")
    def serialize_group(self, handler):
        return {key: value for key, value in handler(self).items() if value is not None}


class DayAttendance(_Base):
    """Placeholder model kept for import compatibility in early plan steps."""


class MonthlyAttendance(_Base):
    # Local read baseline only. Never serialized or added to the Drive schema.
    _drive_base: dict | None = PrivateAttr(default=None)
    schema_version: Literal[1, 2] = SCHEMA_VERSION
    month: str
    records: dict[str, dict[str, SlotAttendance]]

    @model_validator(mode="after")
    def set_contract_version(self):
        if any(att.group_id for day in self.records.values() for att in day.values()):
            self.schema_version = 2
        return self

    @field_validator("month")
    @classmethod
    def validate_month(cls, value: str) -> str:
        if not _MONTH_RE.match(value):
            raise ValueError(f"month must be 'YYYY-MM', got {value!r}")
        return value


def numbers_only(students: "Students") -> "Students":
    """Return a copy of the roster with all names stripped (numbers only)."""
    return Students(
        schemaVersion=students.schema_version,
        classes={
            key: [StudentEntry(number=entry.number) for entry in entries]
            for key, entries in students.classes.items()
        },
    )
