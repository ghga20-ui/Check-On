# Subject Teacher App Handoff

Date: 2026-04-27

This document is the quick-start handoff for a fresh Codex/OMX session. It records what the app is, what has actually progressed, and where to continue.

## Product Shape

We are building a separate **subject-teacher** app, not the existing homeroom-teacher attendance-document downloader.

The intended workflow has four parts:

1. **Mobile UI/PWA**
   - Teacher checks attendance immediately after each lesson.
   - Mobile writes attendance records to Google Drive `appDataFolder`.
   - Target stack from the design doc: Vite + React + TypeScript PWA, Google Identity Services, IndexedDB offline queue.

2. **Desktop GUI**
   - Teacher reviews Drive-backed lesson status on a PC.
   - Teacher manages settings, timetable, rosters, NEIS password, and starts NEIS sync.
   - Current direction is pywebview + existing React/HTML UI, replacing the earlier CustomTkinter shell.

3. **NEIS Automation Setup And Execution**
   - Selenium opens NEIS, navigates to subject attendance, selects date/period, marks absent or excused students, saves, and optionally closes attendance.
   - Setup helpers should eventually import the teacher's timetable and class rosters from NEIS where possible.

4. **Google Drive Data Management And Sync**
   - Google Drive `appDataFolder` is the only backend.
   - Shared files are `settings.json`, `timetable.json`, `students.json`, and `attendance-YYYY-MM.json`.
   - NEIS certificate password and Google OAuth tokens must stay local, never in Drive JSON.

## Current Progress

### Google Drive Data Management And Sync: 70-80%

Implemented:

- Pydantic Drive schemas in `drive/schemas.py`
- `DriveStore` persistence layer and migrations
- Google OAuth installed-app flow
- DPAPI-backed local token/password storage
- TSV serialization/parsing helpers for desktop setup screens
- Monthly attendance model with `syncedToNeis` and `closedOnNeis`
- Sample Drive seeding script
- Tests for Drive client/store/schema/migration/auth/path/password contracts

Known gaps:

- Conflict handling between future mobile offline queue and desktop edits is still not designed in code.
- Schema changes must stay compatible with existing Drive data or include migrations.

### Desktop GUI: 55-65%

Implemented in the active feature worktree:

`/mnt/c/users/admin/desktop/2026_project/neis-attendance/.worktrees/feature/pywebview-gui`

Relevant commits:

- `8de1bf9` pywebview and pythonnet dependencies
- `8648e00` pywebview API class and window launcher
- `ab21b5d` main entry point switched to pywebview
- `5e5a5fd` JS bridge for pywebview communication
- `d164c92` pywebview bridge handoff stabilized
- `ad2fb56` timetable subject labeling simplified
- `896ba65` setup views wired to Drive data
- `6112482` nonnumeric class labels allowed for subject groups

Implemented behavior:

- `subject_teacher.main` launches pywebview in the feature worktree.
- React UI loads through `subject_teacher/neis_attendance/index.html`.
- Python API exposes settings, timetable TSV, students TSV, password helpers, today's slots, and `start_run`.
- Setup screens can load/save Drive-backed settings, timetable, and roster data.
- Timetable `classNo` now accepts strings such as `A`, `문학 A`, or `선택1`, while legacy numeric data still loads.

Known gaps:

- Browser/pywebview manual click-through should be rechecked after every GUI change.
- The visible UI still needs a product-level review against the real workflow, not only mock-data behavior.
- Do not continue PyInstaller packaging before workflow verification.

### NEIS Automation Setup And Execution: 45-55%

Implemented:

- `app_service.py` builds a per-day input from Drive timetable + monthly attendance records.
- `neis/runner.py` processes each slot independently and updates Drive sync flags through callbacks.
- `neis/subject_commands.py` contains low-level selectors/actions for subject attendance pages.
- Re-run/idempotency behavior exists: synced slots are skipped when appropriate.

Known gaps:

- Needs real NEIS screen E2E verification with a teacher account/test scenario.
- Needs better diagnostics for selector drift, because NEIS markup is brittle.
- Needs setup import helpers: "NEIS에서 내 시간표 가져오기" and "NEIS에서 반 명부 가져오기" are design goals, not finished features.
- Notes/remarks handling exists in the data model but should be verified against the real NEIS table behavior.

### Mobile UI/PWA: 0-10%

Current state:

- The design is documented, but no Vite/React/TypeScript PWA scaffold was found in the repository.
- Treat mobile as mostly unstarted.

Expected scope:

- Google OAuth via GIS using Drive `appDataFolder` scope.
- Today lesson list from `timetable.json`.
- Lesson detail with student roster, absent/excused toggles, note entry, and "all present" save.
- IndexedDB local cache and offline queue.
- Drive sync with visible pending/synced status.

## Recommended Next Steps

1. Continue from the feature worktree, not the stale base `subject_teacher/` copy:

   ```bash
   cd /mnt/c/users/admin/desktop/2026_project/neis-attendance/.worktrees/feature/pywebview-gui
   ```

2. Reconfirm the current desktop GUI workflow:

   - Launch `python -m subject_teacher.main` on Windows Python.
   - Check settings load/save.
   - Check timetable save with nonnumeric class labels.
   - Check roster save/load.
   - Check today's slots refresh from Drive sample data.

3. Then choose one lane:

   - **NEIS lane**: verify one real/sandbox day against NEIS and harden selectors/diagnostics.
   - **Mobile lane**: scaffold the PWA and implement Drive OAuth + read-only data load first.
   - **Desktop lane**: polish setup/run UX only after the data/workflow contracts are settled.

4. Only after those lanes are coherent, resume packaging:

   - Review any draft `NEIS_Subject_Teacher.spec`.
   - Confirm `subject_teacher/neis_attendance` static assets are included.
   - Run PyInstaller build as a separate packaging task.

## Verification Evidence From Last Session

Feature worktree evidence:

- `python -m pytest tests/test_drive_schemas.py tests/test_subject_teacher_state.py -q` passed with 20 tests.
- `python -m pytest -q` passed with 59 tests.
- Monkeypatched `Api.save_timetable_tsv` accepted `classNo="문학 A"`.
- Node extraction of React TSV conversion preserved `classNo="문학 A"`.
- PyInstaller build was intentionally interrupted and should not be treated as verified.

## Important Cautions

- The repository contains both homeroom and subject-teacher code. Keep subject-teacher work under `subject_teacher/*` unless shared modules are truly needed.
- The root AGENTS/README still describe the older homeroom app. For this app, the subject-teacher docs are authoritative.
- Never put `client_secrets.json`, `token.bin`, `password.bin`, plaintext passwords, or debug dumps into release artifacts.
- Drive JSON uses camelCase aliases. Keep stored data compatible or write migrations.
- Mobile unchecked lessons must be skipped by desktop NEIS sync. Only explicitly saved "all present" lessons should be closed as all-present.
