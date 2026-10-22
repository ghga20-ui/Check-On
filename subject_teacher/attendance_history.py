"""Read saved attendance without querying today's timetable or synthesizing presence."""
from __future__ import annotations

import hashlib
import json
from datetime import date

from subject_teacher.neis_open_api import parse_neis_slot_id


def months_in_range(start: str, end: str) -> list[str]:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last or (last - first).days > 365:
        raise ValueError("시작일과 종료일을 확인해 주세요. 한 번에 최대 366일을 조회할 수 있습니다.")
    months = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def resolve_slot(slot_id, record, timetable, groups, weekday):
    """Encoded date-independent IDs take precedence over a replaced weekly timetable."""
    from subject_teacher.drive.schemas import TimetableSlot
    parsed = parse_neis_slot_id(slot_id)
    existing = next((s for s in timetable.slots if s.id == slot_id), None) if timetable else None
    group = groups.get(record.group_id) if record.group_id else None
    if parsed:
        grade, class_no, period = parsed
        prefix = f"neis-{grade}-{class_no}-{period}-"
        subject = slot_id[len(prefix):] if slot_id.startswith(prefix) else ""
        return TimetableSlot(id=slot_id, dayOfWeek=min(weekday, 5), period=period,
                             grade=grade, classNo=class_no,
                             subjectName=group.subject_name if group else subject or "보강",
                             neisSubjectLabel=group.neis_subject_label if group else subject)
    return existing if existing and existing.day_of_week == weekday else None


def load_history(store, start: str, end: str, *, include_records=False, local_students=None, local_groups=None) -> dict:
    months = months_in_range(start, end)
    timetable = store.load_timetable()
    settings = store.load_settings()
    groups = store.load_mixed_groups().groups
    classes = {f"{s.grade}-{s.class_no}": f"{s.grade}학년 {s.class_no}반" for s in (timetable.slots if timetable else [])
               if not any(g.matches(s.grade, s.class_no, s.subject_name) for g in groups.values())}
    for lesson in (settings.assigned_lessons if settings else []):
        if not any(g.matches(lesson.grade, lesson.class_no, lesson.subject_name) for g in groups.values()):
            classes[f"{lesson.grade}-{lesson.class_no}"] = f"{lesson.grade}학년 {lesson.class_no}반"
    for group in groups.values():
        classes[f"mixed:{group.id}"] = f"{group.grade}학년 {group.class_no} · {group.subject_name}"
    rows, fingerprints, saved = [], [], {}
    for month in months:
        monthly = store.load_monthly(month)
        if not monthly:
            continue
        for day, records in sorted(monthly.records.items()):
            if not start <= day <= end:
                continue
            for slot_id, record in sorted(records.items()):
                slot = resolve_slot(slot_id, record, timetable, groups, date.fromisoformat(day).isoweekday())
                group = groups.get(record.group_id)
                key = f"mixed:{record.group_id}" if record.group_id else (f"{slot.grade}-{slot.class_no}" if slot else "unknown")
                classes.setdefault(key, f"{group.grade}학년 {group.class_no} · {group.subject_name}" if group else
                                   f"{slot.grade}학년 {slot.class_no}반" if slot and not record.group_id else "이전 수업 · 학급 확인 필요")
                roster = group.history.get(str(record.roster_revision), []) if group else []
                by_id = {student.student_id: student for student in roster}
                marks = []
                for absence in record.absences:
                    student = by_id.get(absence.student_id)
                    label = (f"{student.home_class_no}반 {student.number}번" if student else
                             f"{absence.student_number}번" if absence.student_number else "이전 명부 학생 · 확인 필요")
                    name = ""
                    if student and local_groups:
                        local_group = local_groups.groups.get(record.group_id)
                        local_roster = local_group.history.get(str(record.roster_revision), []) if local_group else []
                        local_student = next((s for s in local_roster if s.student_id == student.student_id), None)
                        name = local_student.name if local_student else ""
                    elif not record.group_id and local_students and settings:
                        # Regular rosters have no historical identity. Do not attach
                        # this year's names to a reused number from a prior year.
                        record_date = date.fromisoformat(day)
                        academic_year = record_date.year - (record_date.month < 3)
                        if academic_year == settings.semester.year:
                            entry = next((s for s in local_students.classes.get(key, []) if s.number == absence.student_number), None)
                            name = entry.name if entry else ""
                    marks.append({"student": label, "name": name, "mark": absence.mark_type.value})
                rows.append({"date": day, "slotId": slot_id, "classKey": key,
                             "period": slot.period if slot else None,
                             "subject": slot.subject_name if slot else slot_id,
                             "synced": record.synced_to_neis, "closed": record.closed_on_neis,
                             "marks": marks, "checkedAt": record.checked_at,
                             "resolvable": slot is not None})
                fingerprints.append([day, slot_id, record.model_dump(mode="json"),
                                     slot.model_dump(mode="json") if slot else None])
                saved.setdefault(day, {})[slot_id] = (slot, record.model_copy(deep=True))
    metadata = [settings.model_dump(mode="json") if settings else None,
                {key: group.model_dump(mode="json") for key, group in groups.items()}]
    def digest(values):
        return hashlib.sha256(json.dumps([values, metadata], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    token = digest(fingerprints)
    content = [[day, slot_id, {k: v for k, v in record.items() if k not in {"synced_to_neis", "closed_on_neis"}}, slot]
               for day, slot_id, record, slot in fingerprints]
    result = {"start": start, "end": end, "classes": [{"key": key, "label": label} for key, label in sorted(classes.items())],
            "rows": rows, "token": token, "year": settings.semester.year if settings else None,
            "term": settings.semester.term if settings else None, "contentToken": digest(content)}
    if include_records:
        result.update(_records=saved, _settings=settings, _groups=groups)
    return result
