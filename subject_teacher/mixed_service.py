"""Mixed roster preview, local names and desktop binding helpers."""
from __future__ import annotations

from subject_teacher.auth.token_store import TokenNotFoundError, load_token, save_token
from subject_teacher.paths import get_students_path
from subject_teacher.drive.mixed import MixedGroups


def with_local_names(document: MixedGroups) -> MixedGroups:
    try:
        names = load_token(get_students_path().with_name("mixed-names.bin"))
    except TokenNotFoundError:
        names = {}
    result = document.model_copy(deep=True)
    for group in result.groups.values():
        for roster in [group.students, *group.history.values()]:
            for student in roster:
                student.name = str(names.get(student.student_id, ""))
    return result


def save_local_names(document: MixedGroups):
    names = {}
    for group in document.groups.values():
        for roster in [*group.history.values(), group.students]:
            for student in roster:
                names[student.student_id] = student.name
    save_token(get_students_path().with_name("mixed-names.bin"), names)


def preview_rows(rows: list[list[str]], grade: int) -> list[dict]:
    """Keep unresolved combined IDs available for teacher correction; never silently discard."""
    rows = [row for row in rows if any(str(cell).strip() for cell in row)]
    if not rows:
        raise ValueError("명부가 비어 있습니다.")
    aliases = {"grade": {"학년", "grade"}, "homeClassNo": {"반", "학급", "원소속반", "class", "homeclassno"},
               "number": {"번호", "번", "출석번호", "number", "no"}, "name": {"이름", "성명", "name"},
               "rawStudentNumber": {"학번", "studentnumber", "studentno", "studentid"}}
    header = [str(cell).strip().lower().replace(" ", "") for cell in rows[0]]
    columns = {key: next((i for i, cell in enumerate(header) if cell in values), None)
               for key, values in aliases.items()}
    if all(index is None for index in columns.values()):
        raise ValueError("첫 행에 반·번호 또는 학번 열 이름을 넣어 주세요.")
    result = []
    for row in rows[1:]:
        item = {key: str(row[index]).strip() if index is not None and index < len(row) else ""
                for key, index in columns.items()}
        item["grade"] = item["grade"] or str(grade)
        raw = item["rawStudentNumber"]
        if not item["homeClassNo"] and not item["number"] and len(raw) == 5 and raw.isdigit():
            item.update(grade=str(int(raw[0])), homeClassNo=str(int(raw[1:3])), number=str(int(raw[3:])))
        result.append(item)
    return result


def matching_group(document: MixedGroups, grade: int, class_no: str, subject: str):
    matches = [g for g in document.groups.values() if g.matches(grade, class_no, subject)]
    if len(matches) > 1:
        raise ValueError("이동수업 집단이 중복됩니다. 명부를 확인해 주세요.")
    return matches[0] if matches else None
