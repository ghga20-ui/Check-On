"""Remove a class and its saved attendance without touching other classes."""
import re
from datetime import date
from subject_teacher.attendance_history import resolve_slot


def remove_class(store, key: str) -> None:
    settings = store.load_settings()
    timetable = store.load_timetable()
    document = store.load_mixed_groups()
    if key.startswith("mixed:"):
        group = document.groups.get(key[6:])
        if group is None:
            return
        def selected(lesson):
            return (lesson.grade == group.grade and str(lesson.class_no) == group.class_no
                    and lesson.subject_name in {group.subject_name, group.neis_subject_label})
    else:
        if not re.fullmatch(r"[1-3]-[1-9]\d*", key):
            raise ValueError("삭제할 학급을 확인해 주세요.")
        grade, class_no = key.split("-", 1)
        def selected(lesson):
            return (lesson.grade == int(grade) and str(lesson.class_no) == class_no
                    and not any(g.matches(lesson.grade, str(lesson.class_no), lesson.subject_name)
                                for g in document.groups.values()))
    # Purge before removing timetable metadata so manual IDs remain resolvable.
    for filename in store.client.list_files():
        if not key.startswith("mixed:") and re.fullmatch(r"homeroom-\d{4}-\d{2}\.json", filename):
            from subject_teacher.drive.homeroom import purge_class_month
            purge_class_month(store, filename[9:16], key)
        match = re.fullmatch(r"attendance-(\d{4}-\d{2})\.json", filename)
        if not match:
            continue
        monthly = store.load_monthly(match[1])
        if monthly is None:
            continue
        changed = False
        for day, records in list(monthly.records.items()):
            for slot_id, record in list(records.items()):
                slot = resolve_slot(slot_id, record, timetable, document.groups, date.fromisoformat(day).isoweekday())
                remove = (record.group_id == key[6:] if key.startswith("mixed:") else
                          not record.group_id and slot is not None and selected(slot))
                if remove:
                    del records[slot_id]
                    changed = True
            if not records:
                del monthly.records[day]
        if changed:
            store.save_monthly(monthly)
    if not key.startswith("mixed:"):
        students = store.load_students()
        if students and key in students.classes:
            del students.classes[key]
            store.save_students(students)
    if timetable:
        kept = [slot for slot in timetable.slots if not selected(slot)]
        if len(kept) != len(timetable.slots):
            timetable.slots = kept
            store.save_timetable(timetable)
    if settings:
        kept = [lesson for lesson in settings.assigned_lessons if not selected(lesson)]
        if len(kept) != len(settings.assigned_lessons):
            settings.assigned_lessons = kept
            store.save_settings(settings)
    if key.startswith("mixed:"):
        store.purge_mixed_group(key[6:])
