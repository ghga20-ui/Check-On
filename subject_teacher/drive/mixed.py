"""Independent mixed-class roster contract; legacy students.json stays untouched."""
from __future__ import annotations

import re
from typing import Literal
from uuid import uuid4

from pydantic import Field, model_validator

from subject_teacher.drive.schemas import _Base, SlotAttendance


class MixedStudent(_Base):
    student_id: str = Field(min_length=1)
    grade: int = Field(ge=1, le=3)
    home_class_no: str = Field(pattern=r"^[1-9]\d*$")
    number: int = Field(ge=1, le=99)
    name: str = ""


class MixedGroup(_Base):
    id: str = Field(min_length=1)
    grade: int = Field(ge=1, le=3)
    class_no: str = Field(min_length=1, max_length=40)
    subject_name: str = Field(min_length=1)
    neis_subject_label: str = ""
    revision: int = Field(ge=1)
    students: list[MixedStudent]
    history: dict[str, list[MixedStudent]]

    @model_validator(mode="after")
    def validate_rosters(self):
        identities = {}
        for roster in [self.students, *self.history.values()]:
            seen, ids = set(), set()
            for student in roster:
                identity = (student.grade, student.home_class_no, student.number)
                if student.grade != self.grade:
                    raise ValueError("수업과 학생의 학년이 다릅니다.")
                if identity in seen or student.student_id in ids:
                    raise ValueError("명부에 같은 학생이 중복되었습니다.")
                if student.student_id in identities and identities[student.student_id] != identity:
                    raise ValueError("과거 학생 ID의 소속을 변경할 수 없습니다.")
                identities[student.student_id] = identity
                seen.add(identity)
                ids.add(student.student_id)
        if self.history.get(str(self.revision)) != self.students:
            raise ValueError("현재 명부 버전과 이력이 일치하지 않습니다.")
        return self

    def matches(self, grade: int, class_no: str, subject: str) -> bool:
        return (self.grade == grade and self.class_no == str(class_no)
                and subject in {self.subject_name, self.neis_subject_label} - {""})


class MixedGroups(_Base):
    schema_version: Literal[1] = 1
    revision: int = Field(default=0, ge=0)
    groups: dict[str, MixedGroup] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_groups(self):
        seen = set()
        for key, group in self.groups.items():
            if key != group.id:
                raise ValueError("수업 ID가 일치하지 않습니다.")
            for label in {group.subject_name, group.neis_subject_label} - {""}:
                identity = (group.grade, group.class_no, label)
                if identity in seen:
                    raise ValueError("동일한 수업 집단이 중복되었습니다.")
                seen.add(identity)
        return self


def strip_names(document: MixedGroups) -> dict:
    raw = document.model_dump(by_alias=True, mode="json")
    for group in raw["groups"].values():
        for roster in [group["students"], *group["history"].values()]:
            for student in roster:
                student.pop("name", None)
    return raw


def revise_group(document: MixedGroups, data: dict) -> MixedGroups:
    """Build a new roster revision without mutating the loaded document."""
    group_id = data.get("id") or str(uuid4())
    old = document.groups.get(group_id)
    if data.get("id") and old is None:
        raise ValueError("수업을 찾을 수 없습니다. 다시 불러와 주세요.")
    def whole_number(value):
        text = str(value).strip()
        if not re.fullmatch(r"[0-9]+", text):
            raise ValueError("학년·반·번호는 정수로 입력해 주세요.")
        return int(text)

    grade = whole_number(data["grade"])
    class_no = str(data["classNo"]).strip()
    subject = str(data["subjectName"]).strip()
    label = str(data.get("neisSubjectLabel") or subject).strip()
    if any(c in class_no + subject + label for c in "\t\r\n"):
        raise ValueError("수업 정보에 줄바꿈을 사용할 수 없습니다.")
    if old and (grade, class_no, subject, label) != (
        old.grade, old.class_no, old.subject_name, old.neis_subject_label
    ):
        raise ValueError("기존 이동수업의 학년·수업 집단·과목을 변경할 수 없습니다.")
    known = {(s.grade, s.home_class_no, s.number): s.student_id
             for roster in (old.history.values() if old else []) for s in roster}
    students = []
    for index, row in enumerate(data.get("students", []), 1):
        try:
            student_grade = whole_number(row.get("grade") if row.get("grade") not in (None, "") else grade)
            home = str(whole_number(row.get("homeClassNo", "")))
            number = whole_number(row["number"])
            identity = (student_grade, home, number)
            students.append(MixedStudent(
                studentId=known.get(identity) or str(uuid4()), grade=student_grade,
                homeClassNo=home, number=number, name=str(row.get("name") or "").strip(),
            ))
        except (ValueError, KeyError, TypeError):
            raise ValueError(f"{index}행의 학년·반·번호를 확인해 주세요.") from None
    students.sort(key=lambda s: (int(s.home_class_no), s.number))
    revision = old.revision + 1 if old else 1
    history = dict(old.history) if old else {}
    history[str(revision)] = students
    group = MixedGroup(id=group_id, grade=grade, classNo=class_no, subjectName=subject,
                       neisSubjectLabel=label, revision=revision, students=students, history=history)
    return MixedGroups(revision=document.revision + 1, groups={**document.groups, group_id: group})


def validate_attendance(document: MixedGroups, attendance: SlotAttendance, *, current: bool = True):
    group = document.groups.get(attendance.group_id)
    if group is None:
        raise ValueError("이동수업 명부가 없습니다.")
    if current and attendance.roster_revision != group.revision:
        raise ValueError("명부가 변경됐습니다. 새 명부를 확인한 뒤 출결을 다시 저장해 주세요.")
    roster = group.history.get(str(attendance.roster_revision))
    if roster is None:
        raise ValueError("이 출결의 명부 이력을 찾을 수 없습니다.")
    ids = {student.student_id for student in roster}
    if any(a.student_id not in ids for a in attendance.absences):
        raise ValueError("명부에 없는 학생의 출결입니다.")
    return group
