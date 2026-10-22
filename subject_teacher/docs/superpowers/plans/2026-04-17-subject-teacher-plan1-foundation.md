# Subject Teacher Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 스키마·토큰 저장·Google Drive 왕복·NEIS 과목별 출결 자동화 코어까지 완성해, 수동 입력 데이터로 실제 NEIS 자동화를 검증할 수 있는 기반 만들기.

**Architecture:** Python 패키지 `subject_teacher/`에 4개 서브모듈(`auth`, `drive`, `neis`, + 공용 스키마)을 구성. 각 모듈은 독립 테스트 가능. NEIS 자동화는 기존 `utils.py`를 import해 재사용.

**Tech Stack:** Python 3.x · pytest · pydantic v2 · google-auth-oauthlib · google-api-python-client · pywin32 (DPAPI) · selenium

**연관 스펙:** [docs/superpowers/specs/2026-04-17-subject-teacher-design.md](../specs/2026-04-17-subject-teacher-design.md)

**이 플랜의 산출물**: Plan 1 완료 시 `python -m subject_teacher.scripts.run_day_manually`로 수동 데이터를 넣어 NEIS에 자동 입력·저장·마감까지 돌아간다. GUI는 Plan 2, 모바일 PWA는 Plan 3.

**Plan 1에서 고정하는 결정:**
- `settings.json`의 `region`은 공식 코드(`B10`)가 아니라 현재 저장소의 `regions.py`가 바로 이해하는 키(`"경기"`, `"서울"` 등)로 저장한다. 코드형 지역값이 필요해지면 후속 스키마 마이그레이션에서 추가한다.
- 실행 명령은 Windows PowerShell 기준으로 적는다. bash 전용 명령(`mkdir -p`, `touch`, `grep`)은 사용하지 않는다.
- NEIS 로그인은 기존 `utils.open_neis_direct()`와 `utils.neis_go_menu()`를 재사용하되, 브라우저 생성과 `config.selected_region` 설정은 `subject_teacher` 쪽에서 담당한다.

---

## Task 0: 프로젝트 초기화 (git, 디렉토리, 의존성)

**Files:**
- Create: `.gitignore`
- Create: `subject_teacher/__init__.py`
- Create: `subject_teacher/auth/__init__.py`
- Create: `subject_teacher/drive/__init__.py`
- Create: `subject_teacher/neis/__init__.py`
- Create: `subject_teacher/scripts/__init__.py`
- Modify: `requirements.txt`

- [ ] **Step 1: git 저장소 초기화**

```bash
git init
git config user.name "YOUR_NAME"
git config user.email "YOUR_EMAIL@example.com"
```

Expected: `Initialized empty Git repository in …/neis-attendance/.git/`

- [ ] **Step 2: `.gitignore` 작성**

Create `.gitignore`:

```gitignore
# Python
__pycache__/
*.pyc
*.pyo
*.egg-info/
.pytest_cache/
.venv/
venv/
dist/
build/

# PyInstaller
*.spec.bak

# Credentials / tokens
password.bin
password.txt
token.bin
client_secrets.json
*.pem

# Logs
logs/
*.log

# IDE
.idea/
.vscode/

# OS
Thumbs.db
.DS_Store

# App data
%LOCALAPPDATA%/
```

- [ ] **Step 3: 디렉토리 구조 생성**

```powershell
New-Item -ItemType Directory -Force `
  subject_teacher, `
  subject_teacher/auth, `
  subject_teacher/drive, `
  subject_teacher/neis, `
  subject_teacher/scripts, `
  tests | Out-Null

New-Item -ItemType File -Force `
  subject_teacher/__init__.py, `
  subject_teacher/auth/__init__.py, `
  subject_teacher/drive/__init__.py, `
  subject_teacher/neis/__init__.py, `
  subject_teacher/scripts/__init__.py, `
  tests/__init__.py | Out-Null
```

- [ ] **Step 4: `requirements.txt`에 새 의존성 추가**

기존 파일을 다음으로 교체:

```
customtkinter
CTkMessagebox
selenium
webdriver-manager
pandas
openpyxl
pywin32
pydantic>=2.6
google-auth-oauthlib>=1.2
google-auth-httplib2>=0.2
google-api-python-client>=2.120
pytest>=8.0
```

- [ ] **Step 5: 의존성 설치 확인**

```bash
pip install -r requirements.txt
```

Expected: `Successfully installed …` (에러 없이 종료)

- [ ] **Step 6: 첫 커밋 (기존 코드 포함)**

```powershell
git add .gitignore requirements.txt subject_teacher tests/__init__.py interface_teacher.py btn_commands.py utils.py config.py regions.py logger_config.py tests/test_password_crypto.py docs neis_menu_teacher.json NEIS_Teacher_20251230.spec neis_manual.txt
git commit -m "chore: initialize git repo and scaffold subject_teacher package"
```

Expected: `[master (root-commit) …] chore: initialize git repo and scaffold subject_teacher package`

---

## Task 1: DPAPI 토큰 저장 모듈

**Files:**
- Create: `subject_teacher/auth/token_store.py`
- Test: `tests/test_token_store.py`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/test_token_store.py`:

```python
import json
from pathlib import Path
import pytest
from subject_teacher.auth.token_store import save_token, load_token, delete_token, TokenNotFoundError


def test_save_and_load_roundtrip(tmp_path: Path):
    path = tmp_path / "token.bin"
    payload = {"access_token": "ya29.abc", "refresh_token": "1//xyz"}
    save_token(path, payload)
    loaded = load_token(path)
    assert loaded == payload


def test_load_missing_raises(tmp_path: Path):
    path = tmp_path / "nonexistent.bin"
    with pytest.raises(TokenNotFoundError):
        load_token(path)


def test_delete_token(tmp_path: Path):
    path = tmp_path / "token.bin"
    save_token(path, {"refresh_token": "x"})
    assert path.exists()
    delete_token(path)
    assert not path.exists()


def test_delete_missing_is_idempotent(tmp_path: Path):
    path = tmp_path / "nonexistent.bin"
    delete_token(path)  # should not raise


def test_saved_file_is_not_plaintext(tmp_path: Path):
    """DPAPI로 암호화되어 원본 JSON이 바이트에 안 보여야 함."""
    path = tmp_path / "token.bin"
    save_token(path, {"refresh_token": "SECRET_MARKER_ZZZ"})
    raw = path.read_bytes()
    assert b"SECRET_MARKER_ZZZ" not in raw
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_token_store.py -v`
Expected: `ModuleNotFoundError: No module named 'subject_teacher.auth.token_store'`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/auth/token_store.py`:

```python
"""DPAPI(Windows Data Protection API)로 토큰을 현재 사용자 계정 단위 암호화해 저장.

기존 `password.bin` 방식을 토큰 저장용으로 확장.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import win32crypt


class TokenNotFoundError(FileNotFoundError):
    """저장된 토큰 파일이 없을 때."""


def save_token(path: Path, payload: dict[str, Any]) -> None:
    """토큰 payload(JSON 직렬화 가능)를 DPAPI로 암호화해 파일에 저장."""
    path.parent.mkdir(parents=True, exist_ok=True)
    plaintext = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    ciphertext = win32crypt.CryptProtectData(plaintext, None, None, None, None, 0)
    path.write_bytes(ciphertext)


def load_token(path: Path) -> dict[str, Any]:
    """DPAPI로 복호화해 dict로 반환. 파일이 없으면 TokenNotFoundError."""
    if not path.exists():
        raise TokenNotFoundError(str(path))
    ciphertext = path.read_bytes()
    _description, plaintext = win32crypt.CryptUnprotectData(ciphertext, None, None, None, 0)
    return json.loads(plaintext.decode("utf-8"))


def delete_token(path: Path) -> None:
    """토큰 파일 삭제. 없으면 무시."""
    try:
        path.unlink()
    except FileNotFoundError:
        pass
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_token_store.py -v`
Expected: `5 passed`

- [ ] **Step 5: 커밋**

```bash
git add subject_teacher/auth/token_store.py tests/test_token_store.py
git commit -m "feat(auth): DPAPI-backed token store with JSON roundtrip"
```

---

## Task 2: JSON 스키마 정의 (pydantic 모델)

**Files:**
- Create: `subject_teacher/drive/schemas.py`
- Test: `tests/test_drive_schemas.py`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/test_drive_schemas.py`:

```python
import pytest
from pydantic import ValidationError
from subject_teacher.drive.schemas import (
    Settings, Timetable, TimetableSlot, Students, StudentEntry,
    MonthlyAttendance, DayAttendance, SlotAttendance, Absence, MarkType,
    SCHEMA_VERSION,
)


def test_settings_roundtrip():
    data = {
        "schemaVersion": 1,
        "teacherName": "홍길동",
        "schoolName": "○○고등학교",
        "region": "경기",
        "semester": {"year": 2026, "term": 1},
        "closeByDefault": False,
        "updatedAt": "2026-04-17T09:00:00+09:00",
    }
    s = Settings.model_validate(data)
    assert s.teacher_name == "홍길동"
    assert s.region == "경기"
    assert s.semester.year == 2026
    # JSON 직렬화 시 원본 camelCase 키로 복원
    assert s.model_dump(by_alias=True)["teacherName"] == "홍길동"


def test_settings_region_validation():
    """region은 `regions.py`의 REGIONS 키 중 하나."""
    bad = {
        "schemaVersion": 1,
        "teacherName": "X",
        "schoolName": "Y",
        "region": "ZZ99",
        "semester": {"year": 2026, "term": 1},
        "closeByDefault": False,
        "updatedAt": "2026-04-17T09:00:00+09:00",
    }
    with pytest.raises(ValidationError):
        Settings.model_validate(bad)


def test_timetable_slot_day_period_range():
    with pytest.raises(ValidationError):
        TimetableSlot(
            id="x-0", dayOfWeek=0, period=1, grade=2, classNo=3,
            subjectName="수학", neisSubjectLabel="수학(2-3)",
        )
    with pytest.raises(ValidationError):
        TimetableSlot(
            id="x-8", dayOfWeek=1, period=8, grade=2, classNo=3,
            subjectName="수학", neisSubjectLabel="수학(2-3)",
        )


def test_students_key_format():
    students = Students.model_validate({
        "schemaVersion": 1,
        "classes": {
            "2-3": [{"number": 1, "name": "김가나"}],
        },
    })
    assert "2-3" in students.classes
    assert students.classes["2-3"][0].name == "김가나"


def test_students_invalid_class_key():
    with pytest.raises(ValidationError):
        Students.model_validate({
            "schemaVersion": 1,
            "classes": {"two-three": [{"number": 1, "name": "김"}]},
        })


def test_absence_mark_type_accepts_both():
    a1 = Absence(studentNumber=1, markType="absent", note="")
    a2 = Absence(studentNumber=2, markType="excused", note="교외체험학습")
    assert a1.mark_type is MarkType.ABSENT
    assert a2.mark_type is MarkType.EXCUSED


def test_absence_rejects_invalid_mark_type():
    with pytest.raises(ValidationError):
        Absence(studentNumber=1, markType="tardy", note="")


def test_monthly_attendance_minimal():
    data = {
        "schemaVersion": 1,
        "month": "2026-04",
        "records": {
            "2026-04-17": {
                "mon-1": {
                    "absences": [
                        {"studentNumber": 15, "markType": "excused", "note": "교외체험학습"},
                        {"studentNumber": 22, "markType": "absent", "note": ""},
                    ],
                    "checkedAt": "2026-04-17T09:55:00+09:00",
                    "source": "mobile",
                    "syncedToNeis": False,
                    "closedOnNeis": False,
                }
            }
        },
    }
    m = MonthlyAttendance.model_validate(data)
    slot = m.records["2026-04-17"]["mon-1"]
    assert len(slot.absences) == 2
    assert slot.source == "mobile"
    # 직렬화 라운드트립
    dumped = m.model_dump(by_alias=True, mode="json")
    assert dumped["records"]["2026-04-17"]["mon-1"]["syncedToNeis"] is False


def test_month_format_validation():
    with pytest.raises(ValidationError):
        MonthlyAttendance.model_validate({
            "schemaVersion": 1,
            "month": "202604",
            "records": {},
        })


def test_schema_version_constant():
    assert SCHEMA_VERSION == 1
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_drive_schemas.py -v`
Expected: `ModuleNotFoundError: No module named 'subject_teacher.drive.schemas'`

- [ ] **Step 3: 스키마 구현 작성**

Create `subject_teacher/drive/schemas.py`:

```python
"""Drive appDataFolder에 저장되는 4개 JSON 파일 스키마 (pydantic v2).

- settings.json  : 교사 설정
- timetable.json : 주간 시간표
- students.json  : 반별 학생 명부
- attendance-YYYY-MM.json : 월별 출결 기록
"""
from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

import regions  # 기존 모듈 재사용

SCHEMA_VERSION = 1

_CLASS_KEY_RE = re.compile(r"^\d+-\d+$")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class _Base(BaseModel):
    """camelCase 별칭 자동, extra 무시."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# ─────────────────────────── settings.json ───────────────────────────

class Semester(_Base):
    year: int = Field(ge=2024, le=2100)
    term: Literal[1, 2]


class Settings(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    teacher_name: str
    school_name: str
    region: str
    semester: Semester
    close_by_default: bool = False
    updated_at: str

    @field_validator("region")
    @classmethod
    def _region_in_catalog(cls, v: str) -> str:
        if v not in regions.REGIONS:
            raise ValueError(f"unknown region code: {v}")
        return v


# ─────────────────────────── timetable.json ───────────────────────────

class TimetableSlot(_Base):
    id: str
    day_of_week: Annotated[int, Field(ge=1, le=5)]
    period: Annotated[int, Field(ge=1, le=7)]
    grade: Annotated[int, Field(ge=1, le=3)]
    class_no: Annotated[int, Field(ge=1, le=20)]
    subject_name: str
    neis_subject_label: str


class Timetable(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    effective_from: str
    slots: list[TimetableSlot]


# ─────────────────────────── students.json ───────────────────────────

class StudentEntry(_Base):
    number: Annotated[int, Field(ge=1, le=99)]
    name: str


class Students(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    classes: dict[str, list[StudentEntry]]

    @field_validator("classes")
    @classmethod
    def _key_format(cls, v: dict[str, list[StudentEntry]]) -> dict[str, list[StudentEntry]]:
        for k in v:
            if not _CLASS_KEY_RE.match(k):
                raise ValueError(f"class key must match 'grade-classNo', got {k!r}")
        return v


# ────────────────────────── attendance-YYYY-MM ──────────────────────────

class MarkType(str, Enum):
    ABSENT = "absent"       # NEIS에서 '/' 표기
    EXCUSED = "excused"     # NEIS에서 '∅' 표기 (출석인정, 2026학년도 고1·고2)


class Absence(_Base):
    student_number: Annotated[int, Field(ge=1, le=99)]
    mark_type: MarkType
    note: str = ""


class SlotAttendance(_Base):
    absences: list[Absence]
    checked_at: str
    source: Literal["mobile", "pc"] = "mobile"
    synced_to_neis: bool = False
    closed_on_neis: bool = False


class DayAttendance(_Base):
    # 동적 키(slot id)를 표현하기 위해 RootModel 대신 dict를 사용한다.
    # 실제로는 MonthlyAttendance.records[date]가 dict[str, SlotAttendance]로 쓰인다.
    pass


class MonthlyAttendance(_Base):
    schema_version: int = Field(default=SCHEMA_VERSION)
    month: str
    records: dict[str, dict[str, SlotAttendance]]

    @field_validator("month")
    @classmethod
    def _month_format(cls, v: str) -> str:
        if not _MONTH_RE.match(v):
            raise ValueError(f"month must be 'YYYY-MM', got {v!r}")
        return v
```

- [ ] **Step 4: `regions.py`에 `REGIONS` 상수가 있는지 확인**

```powershell
Select-String -Path regions.py -Pattern '^REGIONS\\s*='
```

Expected: 리전 코드 컨테이너가 존재. 없거나 다른 이름이면 아래 스텝으로 보완.

- [ ] **Step 5: `regions.py` 호환성 보강 (필요 시)**

조회 결과에 `REGIONS` 이름이 없으면 기존 매핑을 재사용하도록 alias를 추가:

```powershell
Select-String -Path regions.py -Pattern '^[A-Z_][A-Z0-9_]*\\s*=\\s*\\{'
```

기존 dict 이름이 예컨대 `REGION_MAP`이라면, 파일 하단에 별칭을 덧붙여라:

```python
REGIONS = REGION_MAP  # noqa: F821  (alias for subject_teacher schema validation)
```

이미 `REGIONS`이 있으면 이 스텝은 스킵한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pytest tests/test_drive_schemas.py -v`
Expected: `9 passed`

- [ ] **Step 7: 커밋**

```bash
git add subject_teacher/drive/schemas.py tests/test_drive_schemas.py regions.py
git commit -m "feat(drive): pydantic schemas for settings/timetable/students/attendance"
```

---

## Task 3: 스키마 마이그레이션 스텁

**Files:**
- Create: `subject_teacher/drive/migrations.py`
- Test: `tests/test_drive_migrations.py`

목적: 장래 `schemaVersion`이 올라갔을 때 자동 업그레이드 포인트를 지금 만들어 두기. 지금은 v1이 최신이므로 "같은 버전이면 그대로 반환, 더 높은 버전이면 에러, 더 낮은 버전이면 등록된 업그레이더 체인 호출" 구조만 구현.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/test_drive_migrations.py`:

```python
import pytest
from subject_teacher.drive.migrations import (
    migrate, UnsupportedSchemaVersionError, register_upgrader,
)
from subject_teacher.drive.schemas import SCHEMA_VERSION


def test_same_version_is_noop():
    data = {"schemaVersion": SCHEMA_VERSION, "teacherName": "X"}
    assert migrate(data) == data


def test_higher_version_raises():
    data = {"schemaVersion": SCHEMA_VERSION + 1}
    with pytest.raises(UnsupportedSchemaVersionError):
        migrate(data)


def test_missing_version_treated_as_v1():
    data = {"teacherName": "X"}  # no schemaVersion
    migrated = migrate(data)
    assert migrated["schemaVersion"] == SCHEMA_VERSION


def test_register_and_run_upgrader():
    # v0 → v1: add a marker field
    def _v0_to_v1(d: dict) -> dict:
        d = dict(d)
        d["_upgraded"] = True
        return d
    register_upgrader(0, _v0_to_v1)
    data = {"schemaVersion": 0, "teacherName": "X"}
    out = migrate(data)
    assert out["_upgraded"] is True
    assert out["schemaVersion"] == SCHEMA_VERSION
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_drive_migrations.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/drive/migrations.py`:

```python
"""스키마 버전 업그레이드 레지스트리.

현재는 v1이 최신이라 등록된 업그레이더가 없다. 장래 v2 도입 시:

    @register_upgrader(1)
    def _v1_to_v2(d: dict) -> dict:
        ...
"""
from __future__ import annotations

from typing import Callable

from subject_teacher.drive.schemas import SCHEMA_VERSION


class UnsupportedSchemaVersionError(RuntimeError):
    """현재 앱 버전이 알 수 없는(더 높은) 스키마를 만났을 때."""


Upgrader = Callable[[dict], dict]
_UPGRADERS: dict[int, Upgrader] = {}


def register_upgrader(from_version: int, fn: Upgrader | None = None) -> Upgrader | Callable[[Upgrader], Upgrader]:
    """v{from_version} → v{from_version+1} 업그레이더를 등록한다. 데코레이터로도 사용 가능."""
    def _register(f: Upgrader) -> Upgrader:
        _UPGRADERS[from_version] = f
        return f
    if fn is not None:
        return _register(fn)
    return _register


def migrate(data: dict) -> dict:
    version = data.get("schemaVersion", 1)
    if version > SCHEMA_VERSION:
        raise UnsupportedSchemaVersionError(
            f"file was written by a newer app (v{version} > v{SCHEMA_VERSION})"
        )
    while version < SCHEMA_VERSION:
        upgrader = _UPGRADERS.get(version)
        if upgrader is None:
            raise UnsupportedSchemaVersionError(
                f"no upgrader registered for v{version}"
            )
        data = upgrader(data)
        version += 1
    data = dict(data)
    data["schemaVersion"] = SCHEMA_VERSION
    return data
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_drive_migrations.py -v`
Expected: `4 passed`

- [ ] **Step 5: 커밋**

```bash
git add subject_teacher/drive/migrations.py tests/test_drive_migrations.py
git commit -m "feat(drive): schema version migration registry"
```

---

## Task 4: 앱 경로 해석 (LOCALAPPDATA 기반)

**Files:**
- Create: `subject_teacher/paths.py`
- Test: `tests/test_paths.py`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/test_paths.py`:

```python
from pathlib import Path
from subject_teacher.paths import get_app_data_dir, get_token_path, get_password_path


def test_app_data_dir_uses_localappdata(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    d = get_app_data_dir()
    assert d == tmp_path / "NeisSubject"


def test_app_data_dir_is_created(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    d = get_app_data_dir()
    assert d.exists() and d.is_dir()


def test_token_and_password_paths(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert get_token_path().name == "token.bin"
    assert get_password_path().name == "password.bin"
    assert get_token_path().parent == tmp_path / "NeisSubject"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_paths.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/paths.py`:

```python
"""교과담당교사 앱의 로컬 경로를 해석한다.

%LOCALAPPDATA%\\NeisSubject\\{token.bin, password.bin, ...}
"""
from __future__ import annotations

import os
from pathlib import Path

APP_DIR_NAME = "NeisSubject"


def get_app_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        base = str(Path.home() / "AppData" / "Local")
    path = Path(base) / APP_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_token_path() -> Path:
    return get_app_data_dir() / "token.bin"


def get_password_path() -> Path:
    return get_app_data_dir() / "password.bin"


def get_client_secrets_path() -> Path:
    """Google OAuth client_secrets.json 위치.

    개발 환경에서는 프로젝트 루트의 파일을, 배포(PyInstaller) 환경에서는
    앱 데이터 디렉토리의 파일을 사용한다.
    """
    proj_root = Path(__file__).resolve().parent.parent
    dev = proj_root / "client_secrets.json"
    if dev.exists():
        return dev
    return get_app_data_dir() / "client_secrets.json"
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_paths.py -v`
Expected: `3 passed`

- [ ] **Step 5: 커밋**

```bash
git add subject_teacher/paths.py tests/test_paths.py
git commit -m "feat: app data dir and credential path resolution"
```

---

## Task 5: Google OAuth Installed App Flow

**Files:**
- Create: `subject_teacher/auth/google_oauth.py`
- Create: `subject_teacher/scripts/authorize.py`
- Test: `tests/test_google_oauth.py`

목적: `drive.appdata` 단일 스코프로 refresh_token 발급, DPAPI 암호화 저장. 수동 확인 스크립트도 함께.

- [ ] **Step 1: 실패하는 단위 테스트 작성 (저장/복원 로직만)**

Create `tests/test_google_oauth.py`:

```python
from pathlib import Path
from unittest.mock import MagicMock

from subject_teacher.auth import google_oauth


def test_credentials_to_payload_roundtrip():
    creds = MagicMock()
    creds.token = "ya29.xxx"
    creds.refresh_token = "1//xyz"
    creds.token_uri = "https://oauth2.googleapis.com/token"
    creds.client_id = "abc.apps.googleusercontent.com"
    creds.client_secret = "GOCSPX-secret"
    creds.scopes = ["https://www.googleapis.com/auth/drive.appdata"]

    payload = google_oauth._credentials_to_payload(creds)
    assert payload["refresh_token"] == "1//xyz"
    assert payload["scopes"] == ["https://www.googleapis.com/auth/drive.appdata"]


def test_payload_to_credentials_roundtrip():
    payload = {
        "token": "ya29.xxx",
        "refresh_token": "1//xyz",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "abc.apps.googleusercontent.com",
        "client_secret": "GOCSPX-secret",
        "scopes": ["https://www.googleapis.com/auth/drive.appdata"],
    }
    creds = google_oauth._payload_to_credentials(payload)
    assert creds.refresh_token == "1//xyz"
    assert "drive.appdata" in creds.scopes[0]


def test_load_credentials_returns_none_when_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert google_oauth.load_credentials() is None
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_google_oauth.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/auth/google_oauth.py`:

```python
"""Google Drive appDataFolder 접근을 위한 OAuth Installed App 플로우.

스코프는 drive.appdata 단 하나. refresh_token은 DPAPI로 암호화 저장.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from subject_teacher.auth.token_store import (
    TokenNotFoundError, load_token, save_token,
)
from subject_teacher.paths import get_client_secrets_path, get_token_path

SCOPES = ["https://www.googleapis.com/auth/drive.appdata"]


def _credentials_to_payload(creds: Credentials) -> dict[str, Any]:
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else list(SCOPES),
    }


def _payload_to_credentials(payload: dict[str, Any]) -> Credentials:
    return Credentials(
        token=payload.get("token"),
        refresh_token=payload.get("refresh_token"),
        token_uri=payload.get("token_uri"),
        client_id=payload.get("client_id"),
        client_secret=payload.get("client_secret"),
        scopes=payload.get("scopes") or SCOPES,
    )


def authorize_interactive() -> Credentials:
    """브라우저를 열어 사용자 동의를 받고 refresh_token 발급 후 저장."""
    secrets_path = get_client_secrets_path()
    if not secrets_path.exists():
        raise FileNotFoundError(
            f"client_secrets.json not found at {secrets_path}. "
            "Download from Google Cloud Console and place it there."
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(secrets_path), SCOPES)
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    save_token(get_token_path(), _credentials_to_payload(creds))
    return creds


def load_credentials() -> Credentials | None:
    """저장된 토큰에서 Credentials 복원. 없으면 None."""
    try:
        payload = load_token(get_token_path())
    except TokenNotFoundError:
        return None
    return _payload_to_credentials(payload)


def get_credentials() -> Credentials:
    """필요 시 refresh, 없으면 interactive 동의 플로우."""
    creds = load_credentials()
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_token(get_token_path(), _credentials_to_payload(creds))
        return creds
    if creds and creds.valid:
        return creds
    return authorize_interactive()


def revoke() -> None:
    """로컬 토큰 삭제. (Google 측 revoke는 Credentials.revoke()로 별도)."""
    from subject_teacher.auth.token_store import delete_token
    delete_token(get_token_path())
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_google_oauth.py -v`
Expected: `3 passed`

- [ ] **Step 5: 수동 확인 스크립트 작성**

Create `subject_teacher/scripts/authorize.py`:

```python
"""수동 실행: 최초 OAuth 동의 플로우를 돌려 refresh_token을 저장한다.

실행 전 준비:
  1) Google Cloud Console → OAuth 클라이언트(데스크톱 앱) 생성
  2) client_secrets.json 다운로드 → 프로젝트 루트에 저장
  3) `python -m subject_teacher.scripts.authorize`
"""
from __future__ import annotations

from subject_teacher.auth.google_oauth import authorize_interactive


def main() -> None:
    creds = authorize_interactive()
    print("OK — refresh_token saved.")
    print("  has_refresh_token:", bool(creds.refresh_token))
    print("  scopes:", creds.scopes)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 수동 확인 (네트워크 필요, 사용자 개입 필요)**

다음 단계는 **사용자가 Google Cloud Console에서 OAuth 클라이언트(데스크톱 앱)를 만들고 `client_secrets.json`을 프로젝트 루트에 둔 뒤** 실행한다. 이 파일은 `.gitignore`에 의해 커밋되지 않는다.

```bash
python -m subject_teacher.scripts.authorize
```

Expected: 기본 브라우저가 열리며 Google 동의 화면 → 완료 후 콘솔에 `OK — refresh_token saved.` 출력.

- [ ] **Step 7: 커밋**

```bash
git add subject_teacher/auth/google_oauth.py subject_teacher/scripts/authorize.py tests/test_google_oauth.py
git commit -m "feat(auth): Google OAuth installed-app flow with drive.appdata scope"
```

---

## Task 6: Drive appDataFolder 클라이언트

**Files:**
- Create: `subject_teacher/drive/client.py`
- Create: `subject_teacher/scripts/drive_roundtrip.py`
- Test: `tests/test_drive_client.py` (순수 단위 — 요청 구성만)

목적: 4개 JSON 파일을 `appDataFolder`에서 읽고 쓰고 삭제. 실제 네트워크 호출은 수동 확인 스크립트에서 검증.

- [ ] **Step 1: 실패하는 단위 테스트 작성**

Create `tests/test_drive_client.py`:

```python
from unittest.mock import MagicMock
from subject_teacher.drive.client import DriveAppDataClient


def _mock_files(list_result: list[dict]):
    files = MagicMock()
    files.list.return_value.execute.return_value = {"files": list_result}
    return files


def test_find_file_id_returns_none_when_absent():
    svc = MagicMock()
    svc.files.return_value = _mock_files([])
    client = DriveAppDataClient(service=svc)
    assert client.find_file_id("settings.json") is None
    svc.files.return_value.list.assert_called_once()


def test_find_file_id_returns_id_when_present():
    svc = MagicMock()
    svc.files.return_value = _mock_files([{"id": "abc123", "name": "settings.json"}])
    client = DriveAppDataClient(service=svc)
    assert client.find_file_id("settings.json") == "abc123"


def test_upsert_json_creates_when_absent():
    svc = MagicMock()
    svc.files.return_value.list.return_value.execute.return_value = {"files": []}
    svc.files.return_value.create.return_value.execute.return_value = {"id": "new123"}
    client = DriveAppDataClient(service=svc)
    file_id = client.upsert_json("settings.json", {"schemaVersion": 1})
    assert file_id == "new123"
    svc.files.return_value.create.assert_called_once()


def test_upsert_json_updates_when_present():
    svc = MagicMock()
    svc.files.return_value.list.return_value.execute.return_value = {
        "files": [{"id": "existing", "name": "settings.json"}]
    }
    svc.files.return_value.update.return_value.execute.return_value = {"id": "existing"}
    client = DriveAppDataClient(service=svc)
    file_id = client.upsert_json("settings.json", {"schemaVersion": 1})
    assert file_id == "existing"
    svc.files.return_value.update.assert_called_once()
    svc.files.return_value.create.assert_not_called()
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_drive_client.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/drive/client.py`:

```python
"""Google Drive appDataFolder의 JSON 파일 CRUD.

- find_file_id(name)    : 이름으로 파일 ID 조회 (없으면 None)
- read_json(name)       : JSON 파일 내용을 dict로 반환 (없으면 None)
- upsert_json(name, obj): 없으면 생성, 있으면 덮어쓰기. file_id 반환
- delete(name)          : 삭제 (없으면 무시)
- list_files()          : appDataFolder의 파일 이름 목록
"""
from __future__ import annotations

import io
import json
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload


class DriveAppDataClient:
    """appDataFolder 스코프 Drive 클라이언트.

    service 인자는 주입 가능 (테스트 시 Mock, 기본은 oauth creds로 빌드).
    """

    def __init__(self, credentials=None, service=None):
        if service is None:
            if credentials is None:
                raise ValueError("either credentials or service must be provided")
            service = build("drive", "v3", credentials=credentials, cache_discovery=False)
        self._svc = service

    def find_file_id(self, name: str) -> str | None:
        resp = (
            self._svc.files()
            .list(
                q=f"name = '{name}' and 'appDataFolder' in parents and trashed = false",
                spaces="appDataFolder",
                fields="files(id, name)",
                pageSize=10,
            )
            .execute()
        )
        files = resp.get("files", [])
        return files[0]["id"] if files else None

    def read_json(self, name: str) -> dict[str, Any] | None:
        file_id = self.find_file_id(name)
        if file_id is None:
            return None
        req = self._svc.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _status, done = downloader.next_chunk()
        return json.loads(buf.getvalue().decode("utf-8"))

    def upsert_json(self, name: str, obj: dict[str, Any]) -> str:
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        media = MediaIoBaseUpload(io.BytesIO(payload), mimetype="application/json", resumable=False)
        file_id = self.find_file_id(name)
        if file_id is None:
            resp = (
                self._svc.files()
                .create(
                    body={"name": name, "parents": ["appDataFolder"]},
                    media_body=media,
                    fields="id",
                )
                .execute()
            )
            return resp["id"]
        self._svc.files().update(fileId=file_id, media_body=media, fields="id").execute()
        return file_id

    def delete(self, name: str) -> bool:
        file_id = self.find_file_id(name)
        if file_id is None:
            return False
        self._svc.files().delete(fileId=file_id).execute()
        return True

    def list_files(self) -> list[str]:
        resp = (
            self._svc.files()
            .list(
                spaces="appDataFolder",
                fields="files(id, name)",
                pageSize=100,
            )
            .execute()
        )
        return [f["name"] for f in resp.get("files", [])]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_drive_client.py -v`
Expected: `4 passed`

- [ ] **Step 5: 수동 왕복 확인 스크립트 작성**

Create `subject_teacher/scripts/drive_roundtrip.py`:

```python
"""수동 실행: Drive appDataFolder에 샘플 파일을 쓰고 읽고 지우는 것을 검증한다.

사전 조건: `python -m subject_teacher.scripts.authorize` 를 먼저 돌려 토큰이 있어야 함.

실행: `python -m subject_teacher.scripts.drive_roundtrip`
"""
from __future__ import annotations

from subject_teacher.auth.google_oauth import get_credentials
from subject_teacher.drive.client import DriveAppDataClient


def main() -> None:
    creds = get_credentials()
    client = DriveAppDataClient(credentials=creds)

    sample = {"schemaVersion": 1, "hello": "world"}
    fid = client.upsert_json("_roundtrip.json", sample)
    print(f"upserted: {fid}")

    loaded = client.read_json("_roundtrip.json")
    assert loaded == sample, f"roundtrip mismatch: {loaded!r}"
    print("roundtrip OK")

    names = client.list_files()
    print(f"files in appDataFolder: {names}")

    removed = client.delete("_roundtrip.json")
    print(f"deleted: {removed}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 수동 확인 (네트워크 + 인증 필요)**

```bash
python -m subject_teacher.scripts.drive_roundtrip
```

Expected:
```
upserted: <file-id>
roundtrip OK
files in appDataFolder: ['_roundtrip.json']
deleted: True
```

- [ ] **Step 7: 커밋**

```bash
git add subject_teacher/drive/client.py subject_teacher/scripts/drive_roundtrip.py tests/test_drive_client.py
git commit -m "feat(drive): appDataFolder JSON CRUD client"
```

---

## Task 7: Drive 저장소 파사드 (스키마 검증 + 마이그레이션 + 파일명 규칙 캡슐화)

**Files:**
- Create: `subject_teacher/drive/store.py`
- Test: `tests/test_drive_store.py`

목적: 상위 코드가 `DriveAppDataClient`와 pydantic 모델을 직접 섞지 않도록, 타입 안전한 파사드(`DriveStore`)를 제공. 예: `store.load_settings()`, `store.save_timetable(tt)`, `store.load_monthly("2026-04")`.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/test_drive_store.py`:

```python
from unittest.mock import MagicMock
from subject_teacher.drive.store import DriveStore
from subject_teacher.drive.schemas import (
    Settings, Semester, Timetable, TimetableSlot,
    Students, StudentEntry, MonthlyAttendance, SlotAttendance, Absence, MarkType,
)


def _client_with(read_map: dict):
    client = MagicMock()
    client.read_json.side_effect = lambda name: read_map.get(name)
    return client


def test_load_settings_none_when_absent():
    store = DriveStore(client=_client_with({}))
    assert store.load_settings() is None


def test_load_and_save_settings():
    client = _client_with({
        "settings.json": {
            "schemaVersion": 1,
            "teacherName": "홍길동",
            "schoolName": "○○고",
            "region": "경기",
            "semester": {"year": 2026, "term": 1},
            "closeByDefault": False,
            "updatedAt": "2026-04-17T09:00:00+09:00",
        }
    })
    store = DriveStore(client=client)
    s = store.load_settings()
    assert s is not None and s.teacher_name == "홍길동"
    store.save_settings(s)
    client.upsert_json.assert_called_once()
    name, payload = client.upsert_json.call_args.args
    assert name == "settings.json"
    assert payload["teacherName"] == "홍길동"


def test_monthly_filename_format():
    store = DriveStore(client=_client_with({}))
    assert store._monthly_filename("2026-04") == "attendance-2026-04.json"


def test_load_monthly_returns_none_when_absent():
    store = DriveStore(client=_client_with({}))
    assert store.load_monthly("2026-04") is None


def test_save_monthly_roundtrip():
    client = _client_with({})
    store = DriveStore(client=client)
    m = MonthlyAttendance(
        schemaVersion=1,
        month="2026-04",
        records={
            "2026-04-17": {
                "mon-1": SlotAttendance(
                    absences=[Absence(studentNumber=15, markType=MarkType.EXCUSED, note="")],
                    checkedAt="2026-04-17T09:55:00+09:00",
                    source="mobile",
                    syncedToNeis=False,
                    closedOnNeis=False,
                ),
            },
        },
    )
    store.save_monthly(m)
    name, payload = client.upsert_json.call_args.args
    assert name == "attendance-2026-04.json"
    assert payload["month"] == "2026-04"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_drive_store.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/drive/store.py`:

```python
"""상위 앱이 쓸 타입-안전한 Drive 파사드.

- load/save settings / timetable / students
- load/save 월별 attendance (YYYY-MM)
- 읽을 때 migrate() 통과, pydantic 검증. 쓸 때 pydantic 직렬화(by_alias, camelCase).
"""
from __future__ import annotations

from subject_teacher.drive.client import DriveAppDataClient
from subject_teacher.drive.migrations import migrate
from subject_teacher.drive.schemas import (
    MonthlyAttendance, Settings, Students, Timetable,
)


class DriveStore:
    SETTINGS = "settings.json"
    TIMETABLE = "timetable.json"
    STUDENTS = "students.json"

    def __init__(self, client: DriveAppDataClient):
        self._c = client

    # settings
    def load_settings(self) -> Settings | None:
        raw = self._c.read_json(self.SETTINGS)
        if raw is None:
            return None
        return Settings.model_validate(migrate(raw))

    def save_settings(self, s: Settings) -> str:
        return self._c.upsert_json(self.SETTINGS, s.model_dump(by_alias=True, mode="json"))

    # timetable
    def load_timetable(self) -> Timetable | None:
        raw = self._c.read_json(self.TIMETABLE)
        if raw is None:
            return None
        return Timetable.model_validate(migrate(raw))

    def save_timetable(self, t: Timetable) -> str:
        return self._c.upsert_json(self.TIMETABLE, t.model_dump(by_alias=True, mode="json"))

    # students
    def load_students(self) -> Students | None:
        raw = self._c.read_json(self.STUDENTS)
        if raw is None:
            return None
        return Students.model_validate(migrate(raw))

    def save_students(self, s: Students) -> str:
        return self._c.upsert_json(self.STUDENTS, s.model_dump(by_alias=True, mode="json"))

    # monthly attendance
    @staticmethod
    def _monthly_filename(month: str) -> str:
        return f"attendance-{month}.json"

    def load_monthly(self, month: str) -> MonthlyAttendance | None:
        raw = self._c.read_json(self._monthly_filename(month))
        if raw is None:
            return None
        return MonthlyAttendance.model_validate(migrate(raw))

    def save_monthly(self, m: MonthlyAttendance) -> str:
        return self._c.upsert_json(self._monthly_filename(m.month),
                                   m.model_dump(by_alias=True, mode="json"))
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_drive_store.py -v`
Expected: `5 passed`

- [ ] **Step 5: 커밋**

```bash
git add subject_teacher/drive/store.py tests/test_drive_store.py
git commit -m "feat(drive): typed facade over appDataFolder (DriveStore)"
```

---

## Task 8: NEIS 자동화 — 낮은-수준 셀렉터 함수

**Files:**
- Create: `subject_teacher/neis/subject_commands.py`
- Test: `tests/test_subject_commands_selectors.py`

목적: Selenium을 직접 호출하는 원자 함수들을 한곳에 모은다. DOM 셀렉터는 매뉴얼 스크린샷 기반 추정 + 실행 시 조정이 필요하므로, **각 셀렉터를 상수로 분리**해 한 곳만 고치면 되게 한다.

- [ ] **Step 1: 실패하는 단위 테스트 작성 (상수/순수 로직만)**

Create `tests/test_subject_commands_selectors.py`:

```python
from subject_teacher.neis.subject_commands import (
    SEL, MENU_PATH, build_student_row_xpath, normalize_neis_date,
)


def test_menu_path_matches_manual():
    assert MENU_PATH == [
        "학적", "출결관리", "과목별출결관리", "과목별출결관리(창의적체험활동제외)",
    ]


def test_selectors_are_strings():
    for k, v in SEL.items():
        assert isinstance(v, str) and v, f"selector {k} must be non-empty string"


def test_row_xpath_includes_student_number():
    xp = build_student_row_xpath(student_number=15)
    assert "15" in xp


def test_normalize_neis_date_converts_dash_format():
    assert normalize_neis_date("2026-04-17") == "2026.04.17"
    assert normalize_neis_date("2026.04.17") == "2026.04.17"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_subject_commands_selectors.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/neis/subject_commands.py`:

```python
"""NEIS 교과담당교사 '과목별 출결관리(창의적체험활동제외)' 자동화.

매뉴얼 경로: [학적-출결관리-과목별출결관리-과목별출결관리(창의적체험활동제외)]

셀렉터는 SEL dict에 모아 두어 NEIS UI 변경 시 한 곳만 고치면 되게 한다.
실제 배포 전 한 번은 실제 환경에서 DOM Inspector로 검증이 필요하다.
"""
from __future__ import annotations

import time
from typing import Iterable

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import utils  # 기존 모듈 재사용: login(), neis_go_menu(), retry_on_error

MENU_PATH = [
    "학적", "출결관리", "과목별출결관리", "과목별출결관리(창의적체험활동제외)",
]

# NEIS 과목별 출결관리 화면의 주요 엘리먼트 셀렉터.
# 스크린샷(2026-04-17) 기반 추정치. 실행 시 DOM Inspector로 확정해야 한다.
SEL: dict[str, str] = {
    "radio_day_mode": "//input[@type='radio' and @value='일자순']",
    "radio_subject_mode": "//input[@type='radio' and @value='과목순']",
    "input_date": "//input[contains(@id, '일자') or contains(@id, 'date')]",
    "btn_search": "//button[normalize-space()='조회']",
    "left_panel_period_row": "//table[contains(@class,'period-list')]//tr[td[normalize-space()='{period}']]",
    "excused_checkbox": "//label[normalize-space()='출석인정']/preceding-sibling::input[@type='checkbox']",
    "btn_reset": "//button[normalize-space()='초기화']",
    "btn_save": "//button[normalize-space()='저장']",
    "btn_close": "//button[normalize-space()='출결마감']",
    "student_row_by_number": "//table[contains(@class,'attend-grid')]//tr[td[normalize-space()='{number}']]",
    "cell_status_in_row": ".//td[contains(@class,'status')]//input",
    "cell_note_in_row": ".//td[contains(@class,'note')]//input",
}


def build_student_row_xpath(student_number: int) -> str:
    return SEL["student_row_by_number"].format(number=student_number)


def normalize_neis_date(date_str: str) -> str:
    return date_str.replace("-", ".")


def _wait(driver: WebDriver, timeout: float = 10.0) -> WebDriverWait:
    return WebDriverWait(driver, timeout)


def open_subject_attendance_page(driver: WebDriver, year: int, term: int) -> None:
    utils.neis_go_menu(driver, *MENU_PATH)
    utils.select_combobox_option_by_visible_text(driver, "학년도", str(year))
    utils.select_combobox_option_by_visible_text(driver, "학기", f"{term}학기")


def select_day_mode(driver: WebDriver) -> None:
    el = _wait(driver).until(EC.element_to_be_clickable((By.XPATH, SEL["radio_day_mode"])))
    el.click()


def select_date(driver: WebDriver, date_str: str) -> None:
    """date_str: 'YYYY.MM.DD' 또는 'YYYY-MM-DD'."""
    el = _wait(driver).until(EC.presence_of_element_located((By.XPATH, SEL["input_date"])))
    el.clear()
    el.send_keys(normalize_neis_date(date_str))


def click_search(driver: WebDriver) -> None:
    _wait(driver).until(EC.element_to_be_clickable((By.XPATH, SEL["btn_search"]))).click()


def select_period(driver: WebDriver, period: int) -> None:
    xp = SEL["left_panel_period_row"].format(period=period)
    _wait(driver).until(EC.element_to_be_clickable((By.XPATH, xp))).click()


def ensure_excused_mode(driver: WebDriver, on: bool) -> None:
    """'출석인정' 체크박스가 원하는 상태인지 확인하고, 아니면 토글."""
    el = _wait(driver).until(EC.presence_of_element_located((By.XPATH, SEL["excused_checkbox"])))
    is_checked = el.is_selected()
    if is_checked != on:
        el.click()
        # 토글이 즉시 반영되지 않는 환경에 대비한 짧은 대기
        time.sleep(0.2)


def click_reset(driver: WebDriver) -> None:
    _wait(driver).until(EC.element_to_be_clickable((By.XPATH, SEL["btn_reset"]))).click()


def click_attendance_cell(driver: WebDriver, student_number: int) -> None:
    row_xp = build_student_row_xpath(student_number)
    row = _wait(driver).until(EC.presence_of_element_located((By.XPATH, row_xp)))
    cell = row.find_element(By.XPATH, SEL["cell_status_in_row"])
    cell.click()


def fill_note(driver: WebDriver, student_number: int, note: str) -> None:
    row_xp = build_student_row_xpath(student_number)
    row = _wait(driver).until(EC.presence_of_element_located((By.XPATH, row_xp)))
    field = row.find_element(By.XPATH, SEL["cell_note_in_row"])
    field.clear()
    field.send_keys(note)


def click_save(driver: WebDriver) -> None:
    _wait(driver).until(EC.element_to_be_clickable((By.XPATH, SEL["btn_save"]))).click()


def click_close(driver: WebDriver) -> None:
    _wait(driver).until(EC.element_to_be_clickable((By.XPATH, SEL["btn_close"]))).click()


def absent_numbers(absences: Iterable) -> list[int]:
    """markType=='absent'인 학생 번호들."""
    return [a.student_number for a in absences if a.mark_type.value == "absent"]


def excused_numbers(absences: Iterable) -> list[int]:
    """markType=='excused'인 학생 번호들."""
    return [a.student_number for a in absences if a.mark_type.value == "excused"]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_subject_commands_selectors.py -v`
Expected: `4 passed`

- [ ] **Step 5: 커밋**

```bash
git add subject_teacher/neis/subject_commands.py tests/test_subject_commands_selectors.py
git commit -m "feat(neis): low-level Selenium actions for 과목별 출결관리"
```

---

## Task 9: NEIS 자동화 — process_day 오케스트레이션

**Files:**
- Create: `subject_teacher/neis/runner.py`
- Test: `tests/test_neis_runner.py`

목적: 하루치 수업을 순회하며 `subject_commands.py`의 원자 함수들을 조합. DriveStore 콜백으로 `syncedToNeis` / `closedOnNeis` 플래그 갱신. 수업 단위 실패 격리.

- [ ] **Step 1: 실패하는 테스트 작성 (모든 Selenium 함수 Mock)**

Create `tests/test_neis_runner.py`:

```python
from dataclasses import dataclass
from unittest.mock import MagicMock, call

from subject_teacher.drive.schemas import (
    Absence, MarkType, SlotAttendance, TimetableSlot,
)
from subject_teacher.neis.runner import process_day, DayInput, SlotResult


def _slot(slot_id: str, period: int, grade: int = 2, classNo: int = 3) -> TimetableSlot:
    return TimetableSlot(
        id=slot_id, dayOfWeek=1, period=period,
        grade=grade, classNo=classNo,
        subjectName="수학Ⅰ", neisSubjectLabel=f"수학Ⅰ({grade}-{classNo})",
    )


def _att(absences: list[Absence], synced: bool = False) -> SlotAttendance:
    return SlotAttendance(
        absences=absences,
        checkedAt="2026-04-17T09:55:00+09:00",
        source="mobile",
        syncedToNeis=synced,
        closedOnNeis=False,
    )


def test_skips_slots_already_synced(monkeypatch):
    driver = MagicMock()
    commands = MagicMock()
    on_update = MagicMock()

    slot_a = _slot("mon-1", 1)
    slot_b = _slot("mon-2", 2)
    day = DayInput(
        date="2026-04-17",
        year=2026,
        term=1,
        slots=[
            (slot_a, _att([], synced=True)),
            (slot_b, _att([Absence(studentNumber=1, markType=MarkType.ABSENT, note="")])),
        ],
    )

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)
    commands.open_subject_attendance_page.assert_called_once_with(driver, year=2026, term=1)
    assert [r.slot_id for r in results] == ["mon-1", "mon-2"]
    assert results[0].status == "skipped"
    assert results[1].status == "ok"
    # 건너뛴 슬롯에 대해서는 select_period가 호출되지 않았다
    periods_called = [c.args[1] for c in commands.select_period.call_args_list]
    assert periods_called == [2]


def test_orders_absent_before_excused_and_toggles_mode(monkeypatch):
    driver = MagicMock()
    commands = MagicMock()
    on_update = MagicMock()

    slot = _slot("mon-1", 1)
    att = _att([
        Absence(studentNumber=5, markType=MarkType.ABSENT, note=""),
        Absence(studentNumber=15, markType=MarkType.EXCUSED, note="교외체험"),
    ])
    day = DayInput(date="2026-04-17", year=2026, term=1, slots=[(slot, att)])

    process_day(driver, day, close_after=True, cmd=commands, on_update=on_update)

    # 초기화 → 모드 OFF → absent 클릭 → 모드 ON → excused 클릭 → 모드 OFF → 저장 → 마감
    expected = [
        call.click_reset(driver),
        call.ensure_excused_mode(driver, False),
        call.click_attendance_cell(driver, 5),
        call.ensure_excused_mode(driver, True),
        call.click_attendance_cell(driver, 15),
        call.fill_note(driver, 15, "교외체험"),
        call.ensure_excused_mode(driver, False),
        call.click_save(driver),
        call.click_close(driver),
    ]
    # select_period, select_date 같은 주변 호출은 건너뛰고 위 조합이 순서대로 있어야 함
    actual = [c for c in commands.method_calls if c[0] in {
        "click_reset", "ensure_excused_mode", "click_attendance_cell",
        "fill_note", "click_save", "click_close",
    }]
    assert actual == expected


def test_on_update_is_called_after_save(monkeypatch):
    driver = MagicMock()
    commands = MagicMock()
    on_update = MagicMock()

    slot = _slot("mon-1", 1)
    att = _att([Absence(studentNumber=1, markType=MarkType.ABSENT, note="")])
    day = DayInput(date="2026-04-17", year=2026, term=1, slots=[(slot, att)])

    process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)
    on_update.assert_called_once_with("mon-1", synced=True, closed=False)


def test_failure_in_one_slot_does_not_halt_others(monkeypatch):
    driver = MagicMock()
    commands = MagicMock()
    commands.click_save.side_effect = [RuntimeError("boom"), None]
    on_update = MagicMock()

    slot_a = _slot("mon-1", 1)
    slot_b = _slot("mon-2", 2)
    day = DayInput(date="2026-04-17", year=2026, term=1, slots=[
        (slot_a, _att([Absence(studentNumber=1, markType=MarkType.ABSENT, note="")])),
        (slot_b, _att([Absence(studentNumber=2, markType=MarkType.ABSENT, note="")])),
    ])

    results = process_day(driver, day, close_after=False, cmd=commands, on_update=on_update)
    assert results[0].status == "failed"
    assert "boom" in results[0].error
    assert results[1].status == "ok"
    # 첫 번째 실패했어도 on_update는 두 번째에 대해 호출됐다
    assert on_update.call_args_list == [call("mon-2", synced=True, closed=False)]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pytest tests/test_neis_runner.py -v`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현 작성**

Create `subject_teacher/neis/runner.py`:

```python
"""하루치 수업을 NEIS에 자동 입력·저장·(선택적)마감하는 오케스트레이션."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable, Literal

from selenium.webdriver.remote.webdriver import WebDriver

from subject_teacher.drive.schemas import SlotAttendance, TimetableSlot
from subject_teacher.neis import subject_commands as _cmd_default

log = logging.getLogger(__name__)

SlotPair = tuple[TimetableSlot, SlotAttendance]


@dataclass
class DayInput:
    date: str                    # "YYYY-MM-DD"
    year: int
    term: int
    slots: list[SlotPair]


@dataclass
class SlotResult:
    slot_id: str
    status: Literal["ok", "skipped", "failed"]
    error: str = ""


OnUpdate = Callable[[str, bool, bool], None]  # (slot_id, synced, closed)


def process_day(
    driver: WebDriver,
    day: DayInput,
    close_after: bool,
    cmd=_cmd_default,
    on_update: OnUpdate | None = None,
) -> list[SlotResult]:
    """하루치를 처리한다. 수업 단위 실패는 격리한다."""
    results: list[SlotResult] = []

    # 화면 공통 준비: 메뉴 진입 + 학년도/학기 선택 + 일자순 + 날짜 선택 + 조회.
    try:
        cmd.open_subject_attendance_page(driver, year=day.year, term=day.term)
        cmd.select_day_mode(driver)
        cmd.select_date(driver, day.date)
        cmd.click_search(driver)
    except Exception as e:
        log.exception("failed to prepare day view")
        # 준비 단계 실패 시 모든 슬롯을 failed로 처리
        return [SlotResult(slot_id=s.id, status="failed", error=f"prepare: {e}")
                for s, _ in day.slots]

    for slot, att in day.slots:
        if att.synced_to_neis and (att.closed_on_neis or not close_after):
            results.append(SlotResult(slot_id=slot.id, status="skipped"))
            continue
        try:
            cmd.select_period(driver, slot.period)
            cmd.click_reset(driver)

            absent = [a for a in att.absences if a.mark_type.value == "absent"]
            excused = [a for a in att.absences if a.mark_type.value == "excused"]

            cmd.ensure_excused_mode(driver, False)
            for a in absent:
                cmd.click_attendance_cell(driver, a.student_number)
                if a.note:
                    cmd.fill_note(driver, a.student_number, a.note)

            if excused:
                cmd.ensure_excused_mode(driver, True)
                for a in excused:
                    cmd.click_attendance_cell(driver, a.student_number)
                    if a.note:
                        cmd.fill_note(driver, a.student_number, a.note)
                cmd.ensure_excused_mode(driver, False)

            cmd.click_save(driver)
            if close_after:
                cmd.click_close(driver)

            if on_update is not None:
                on_update(slot.id, synced=True, closed=close_after)
            results.append(SlotResult(slot_id=slot.id, status="ok"))
        except Exception as e:
            log.exception("slot %s failed", slot.id)
            results.append(SlotResult(slot_id=slot.id, status="failed", error=str(e)))

    return results
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pytest tests/test_neis_runner.py -v`
Expected: `4 passed`

- [ ] **Step 5: 커밋**

```bash
git add subject_teacher/neis/runner.py tests/test_neis_runner.py
git commit -m "feat(neis): process_day orchestration with per-slot failure isolation"
```

---

## Task 10: 엔드투엔드 수동 실행 스크립트

**Files:**
- Create: `subject_teacher/scripts/run_day_manually.py`

목적: Plan 1의 최종 산출물. GUI 없이 CLI로 다음을 순차 실행:
1. Google OAuth + DriveStore로 시간표·학생·월별 출결 로드 (또는 샘플 JSON 사용)
2. 기존 `utils.open_neis_direct()`로 NEIS 로그인
3. `process_day()` 실행
4. 결과를 DriveStore에 기록 (flag 갱신)

- [ ] **Step 1: 스크립트 작성**

Create `subject_teacher/scripts/run_day_manually.py`:

```python
"""수동 실행: 하루치 출결을 Drive에서 읽어 NEIS에 자동 입력한다.

사용 예:
  python -m subject_teacher.scripts.run_day_manually --date 2026-04-17 `
      --region 경기 --neis-password "xxx" --close

전제:
  - `python -m subject_teacher.scripts.authorize` 로 OAuth 토큰이 있어야 함
  - Drive appDataFolder에 settings.json, timetable.json, students.json, attendance-YYYY-MM.json 이 있어야 함
    (샘플 생성은 scripts/seed_sample.py — Plan 2에서 GUI로 대체)
  - NEIS 접속에 필요한 인증서가 PC에 설치되어 있어야 함
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

import config
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from subject_teacher.auth.google_oauth import get_credentials
from subject_teacher.drive.client import DriveAppDataClient
from subject_teacher.drive.store import DriveStore
from subject_teacher.drive.schemas import Settings
from subject_teacher.neis.runner import DayInput, process_day

import regions
import utils


def _create_driver():
    options = Options()
    profile_dir = os.path.join(os.path.expanduser("~"), "AppData", "Local", "Chrome_NEIS_Profile")
    os.makedirs(profile_dir, exist_ok=True)
    options.add_argument(f"--user-data-dir={profile_dir}")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-popup-blocking")
    return webdriver.Chrome(options=options)


def _build_day_input(store: DriveStore, settings: Settings, date: str) -> DayInput:
    tt = store.load_timetable()
    if tt is None:
        raise RuntimeError("timetable.json not found in Drive appDataFolder")
    month = date[:7]
    monthly = store.load_monthly(month)
    if monthly is None or date not in monthly.records:
        raise RuntimeError(f"no attendance records for {date}")

    day_map = monthly.records[date]  # dict[slot_id, SlotAttendance]
    # 오늘 요일에 해당하는 슬롯만 추출
    from datetime import date as _date
    y, m, d = map(int, date.split("-"))
    dow = _date(y, m, d).isoweekday()  # 월=1..일=7
    today_slots = [s for s in tt.slots if s.day_of_week == dow]

    pairs = []
    for slot in today_slots:
        att = day_map.get(slot.id)
        if att is None:
            # 모바일에서 체크하지 않은 수업은 스킵 (설계 §4.2)
            continue
        pairs.append((slot, att))
    return DayInput(
        date=date,
        year=settings.semester.year,
        term=settings.semester.term,
        slots=pairs,
    )


def _update_flags(store: DriveStore, month: str, slot_id: str, date: str, synced: bool, closed: bool) -> None:
    monthly = store.load_monthly(month)
    if monthly is None:
        return
    slot_att = monthly.records.get(date, {}).get(slot_id)
    if slot_att is None:
        return
    updated = slot_att.model_copy(update={"synced_to_neis": synced, "closed_on_neis": closed})
    monthly.records[date][slot_id] = updated
    store.save_monthly(monthly)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--region", help="교육청 이름 override (예: 경기)")
    parser.add_argument("--neis-password", required=True)
    parser.add_argument("--close", action="store_true", help="출결마감까지 자동 실행")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    # 1) Google Drive
    creds = get_credentials()
    store = DriveStore(DriveAppDataClient(credentials=creds))
    settings = store.load_settings()
    if settings is None:
        raise RuntimeError("settings.json not found in Drive appDataFolder")

    day_input = _build_day_input(store, settings, args.date)
    print(f"slots to process on {args.date}: {[s.id for s, _ in day_input.slots]}")

    # 2) NEIS 로그인 (기존 utils.open_neis_direct 재사용)
    region_key = args.region or settings.region
    if region_key not in regions.REGIONS:
        sys.stderr.write(f"unknown region: {region_key}\n")
        return 2
    config.selected_region = region_key
    driver = _create_driver()
    utils.open_neis_direct(driver, args.neis_password)

    # 3) 자동화
    month = args.date[:7]
    def _cb(slot_id, synced, closed):
        _update_flags(store, month, slot_id, args.date, synced, closed)

    results = process_day(driver, day_input, close_after=args.close, on_update=_cb)

    # 4) 결과 요약
    ok = sum(1 for r in results if r.status == "ok")
    skipped = sum(1 for r in results if r.status == "skipped")
    failed = [r for r in results if r.status == "failed"]
    print(f"OK={ok} SKIPPED={skipped} FAILED={len(failed)}")
    for r in failed:
        print(f"  - {r.slot_id}: {r.error}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: `utils.open_neis_direct` / `utils.neis_go_menu` 시그니처 확인**

```powershell
Select-String -Path utils.py -Pattern '^def open_neis_direct|^def neis_go_menu'
```

Expected: `utils.py`에 `open_neis_direct(driver, password)`와 `neis_go_menu(driver, ...)`가 있어야 한다. 시그니처가 다르면 `run_day_manually.py`의 로그인/메뉴 진입 코드를 기존 정의에 맞춰 조정한다. 변경 시 같은 커밋에 포함.

- [ ] **Step 3: `regions.REGIONS` 또는 별칭 확인**

Plan 1에서는 `settings.json`의 `region`과 CLI override 둘 다 `regions.py`의 키(`"경기"`, `"서울"` 등)를 쓴다. 없는 키면 CLI에서 친절한 에러로 전환한다:

```python
try:
    region_key = args.region or settings.region
    _ = regions.REGIONS[region_key]
except KeyError:
    sys.stderr.write(f"unknown region: {region_key}\n")
    return 2
```

위 블록을 `main()`의 NEIS 로그인 직전에 삽입.

- [ ] **Step 4: 샘플 데이터 시드 스크립트 작성**

수동 검증 편의를 위해 샘플 JSON을 Drive에 올리는 스크립트를 만든다.

Create `subject_teacher/scripts/seed_sample.py`:

```python
"""개발용: Drive appDataFolder에 최소한의 시간표·학생·출결 샘플을 업로드.

Plan 2에서 GUI가 생기면 더 이상 필요 없다.
"""
from __future__ import annotations

import argparse

from subject_teacher.auth.google_oauth import get_credentials
from subject_teacher.drive.client import DriveAppDataClient
from subject_teacher.drive.store import DriveStore
from subject_teacher.drive.schemas import (
    Absence, MarkType, MonthlyAttendance, Semester, Settings,
    SlotAttendance, StudentEntry, Students, Timetable, TimetableSlot,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default="2026-04-17")
    parser.add_argument("--region", default="경기")
    args = parser.parse_args()

    creds = get_credentials()
    store = DriveStore(DriveAppDataClient(credentials=creds))

    store.save_settings(Settings(
        schemaVersion=1, teacherName="TEST", schoolName="TEST-HS",
        region=args.region, semester=Semester(year=2026, term=1),
        closeByDefault=False, updatedAt=f"{args.date}T09:00:00+09:00",
    ))
    store.save_timetable(Timetable(
        schemaVersion=1, effectiveFrom="2026-03-02",
        slots=[TimetableSlot(
            id="fri-1", dayOfWeek=5, period=1, grade=1, classNo=7,
            subjectName="공통국어1", neisSubjectLabel="공통국어1(1-7)",
        )],
    ))
    store.save_students(Students(
        schemaVersion=1,
        classes={"1-7": [
            StudentEntry(number=1, name="경승주"),
            StudentEntry(number=2, name="권서하"),
            StudentEntry(number=15, name="TEST-EXCUSED"),
        ]},
    ))
    store.save_monthly(MonthlyAttendance(
        schemaVersion=1,
        month=args.date[:7],
        records={args.date: {"fri-1": SlotAttendance(
            absences=[
                Absence(studentNumber=2, markType=MarkType.ABSENT, note=""),
                Absence(studentNumber=15, markType=MarkType.EXCUSED, note="교외체험"),
            ],
            checkedAt=f"{args.date}T09:55:00+09:00",
            source="mobile", syncedToNeis=False, closedOnNeis=False,
        )}},
    ))
    print("seeded.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 수동 E2E 검증 (NEIS 테스트 계정에서만 실행)**

**경고**: 실제 학생 반 데이터에 실행하지 말 것. 개발자 테스트 반 또는 스테이징 계정에서만.

```bash
python -m subject_teacher.scripts.seed_sample --date 2026-04-17 --region 경기
python -m subject_teacher.scripts.run_day_manually `
    --date 2026-04-17 --region 경기 --neis-password "테스트비번"
```

Expected: NEIS 창이 뜨고 자동 로그인 → 과목별 출결관리 화면 이동 → 지정 교시 선택 → 2번 학생 `/`, 15번 학생 `∅` + 비고 입력 → 저장. `OK=1 SKIPPED=0 FAILED=0` 출력.

실패 시 `SEL` 상수를 DOM Inspector로 대조해 보정한다. 셀렉터 수정 커밋은 별도로 남긴다(`fix(neis): correct XPath for <element>`).

- [ ] **Step 6: 커밋 (스크립트들)**

```bash
git add subject_teacher/scripts/run_day_manually.py subject_teacher/scripts/seed_sample.py
git commit -m "feat(scripts): end-to-end manual runner and sample seeder"
```

---

## Task 11: 회귀 테스트 스위트 확인 + Plan 1 종료 커밋

- [ ] **Step 1: 전체 단위 테스트 통과 확인**

```bash
pytest -v
```

Expected: `test_password_crypto.py` (기존) + 이번 플랜의 모든 테스트 통과.

- [ ] **Step 2: README 간단 추가 (선택)**

Create `subject_teacher/README.md`:

```markdown
# subject_teacher — 나이스 출결관리 프로 (교과담당교사용)

담임용 앱(`interface_teacher.py`)과 별도 EXE로 배포되는 교과담당교사용 앱의 백엔드/자동화 코어.

- Plan 1 (현재): CLI로 하루치 NEIS 자동 입력·마감까지 검증 가능
- Plan 2: PC GUI (CustomTkinter)
- Plan 3: 모바일 PWA

설계 문서: `docs/superpowers/specs/2026-04-17-subject-teacher-design.md`
```

- [ ] **Step 3: 최종 커밋**

```bash
git add subject_teacher/README.md
git commit -m "docs(subject_teacher): plan 1 README stub"
```

---

## 완료 기준 (Plan 1 Definition of Done)

- [ ] `pytest -v` 전체 녹색
- [ ] `python -m subject_teacher.scripts.authorize` 로 OAuth 토큰 발급 완료
- [ ] `python -m subject_teacher.scripts.drive_roundtrip` 로 Drive 왕복 통과
- [ ] `python -m subject_teacher.scripts.seed_sample` + `run_day_manually` 로 **테스트 반**에 실제 NEIS 자동 입력·저장 완료
- [ ] 모든 커밋이 git 로그에 남아있음
- [ ] `SEL` 상수의 XPath들이 실제 NEIS 화면과 일치하도록 검증됨 (필요 시 Task 10 Step 5의 주석대로 보정)

---

## 다음 플랜 (Plan 2 예고)

- PC CustomTkinter GUI — 시간표·학생 세팅 탭, 출결 입력 실행 탭, 진행 로그 패널
- NEIS 시간표 크롤링(선택) — 최초 세팅 시 Selenium으로 긁어서 시간표 JSON 자동 채우기
- PyInstaller spec 작성 (`NEIS_Subject_Teacher.spec`)
