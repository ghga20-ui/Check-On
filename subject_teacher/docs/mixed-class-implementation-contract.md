# Implementation contract (2026-09-10)

Root: C:/Users/admin/Desktop/2026_project/neis-attendance. Existing dirty changes belong to user; preserve them. No commits, external writes or live NEIS operations.

New independent encrypted Drive file `mixed-groups.json`:
`{schemaVersion:1, revision:0, groups:{[id]: {id, grade, classNo, subjectName, neisSubjectLabel, revision:1, students:[{studentId, grade, homeClassNo, number, name?}], history:{[revisionString]: [students]}}}}`.
classNo identifies teaching group, NOT homeroom. All students share grade. IDs UUID strings stable across roster reimports of same grade/homeClassNo/number. Names stripped from current and history on cloud write. Existing students.json remains unchanged. Desktop is roster writer; conditional snapshot/revision guards protect writes.

Timetable matching by exact grade+classNo+subjectName (NEIS label optional alternative). Main adds optional `groupId` to TimetableSlot and assigned lessons? Prefer derive groupId by matching mixed groups so legacy TSV untouched. Group bindings declared by new creation UI; refuse collision with existing legacy timetable/assigned-lesson tuple when creating mixed group.

PWA loadAll gains optional mixedGroups document and Root decorates matching slots with groupId, merges rosters key `mixed:<groupId>`. App accepts optional mixedGroups for history resolution. Mobile save payload for mixed:
`{absences:[{studentId,markType,note:""}], groupId, rosterRevision:1, checkedAt,source,syncedToNeis,closedOnNeis}`.
Legacy absences retain `{studentNumber,...}`. Python Absence student_number optional None, student_id optional None, exactly one required. SlotAttendance optional group_id, roster_revision, pair required for mixed; all mixed absences use studentId. TS use matching discriminated validation; old fixtures no new fields required. Monthly schemaVersion 1 legacy only, 2 when any mixed records, readers accept 1/2 but reject future. Python migrations accepts 2 unchanged; preserve on merging. Do not drop group/revision metadata when normalizing concurrency comparisons.

Mobile must validate current mixed group revision before uploading offline draft; mismatch => conflict and preserve draft. History reopens records using recorded rosterRevision; saving obsolete revision blocked until teacher reopens current roster/reconciles. Low-level write boundary must reject mixed payload without key. Load/save mixed groups always encrypted; normal legacy data remains supported. New group all-present also requires metadata.

Desktop API additions (JSON-string responses):
- get_mixed_groups() => {ok:true, document:<doc including local names>, encryptionEnabled:boolean}
- save_mixed_group(payloadJSON) => {ok:true, document:<doc>}; payload {id?:string, expectedRevision:number (document revision), grade,classNo,subjectName,neisSubjectLabel,students:[{grade?,homeClassNo,number,name?}]} . New creation requires encryption; no ID means generate. Return error on stale revision/invalid/legacy collision. Existing group identity cannot change. File/history updated atomically. API creates/binds scheduled lessons via existing timetable setup (desktop agent owns this integration).
- import_mixed_students_file(grade:number) => {rows:[{grade,homeClassNo,number,name,rawStudentNumber?}],cancelled?:true}; raw combined supported 5-digit suggestion, unresolved retains raw and empty fields for UI edits. Name optional.
- save_slot_attendance existing accepts optional group_id:string|null, roster_revision:int|null AFTER expected_checked_at; marks keys UUID for mixed.
- get_today_slots main decorates matched slots {groupId, rosterRevision, roster:"mixed:<id>", mixedStudents:[...]}, resolves historical revisions for existing attendance.

NEIS agent owns neis/runner.py, neis/subject_commands.py (or separate neis/mixed_commands.py), app_service.py only and tests/test_mixed_neis.py. Add DayInput optional mixed_groups dict; build_day_input loads store.load_mixed_groups() only if mixed attendance, resolves roster history via group/revision and checks selected slot binding. Run mixed separate branch before legacy reset; preflight all targets, no broad number fallback, verify per student not counts. Failure prewrite isolate; failure after write conservatively stop rest unless clean reset verified. Preserve run expected_records snapshot exactly (do not mutate persisted attendance). Main store exposes load_mixed_groups() returning typed MixedGroups with .groups, each .history/.students, students .student_id/.grade/.home_class_no/.number. Group .revision, .class_no, .subject_name, .neis_subject_label. Use history[str(attendance.roster_revision)].

Agents own only assigned files, no child agents. Tests synthetic. No secrets/logs. Report tests and limitations honestly.
