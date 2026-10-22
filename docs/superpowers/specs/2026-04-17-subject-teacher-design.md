# 나이스 출결관리 프로 — 교과담당교사용 설계

작성일: 2026-04-17
대상: 교과담당교사 (2025학년도 1학년 이후, 과목별 출결 입력 의무 대상)
관련 매뉴얼: `neis_manual.txt` (Section 07 출결 관리 — 교과담당교사)

---

## 1. 개요

### 1.1 목적

교과담당교사가 매 수업 직후 **모바일에서 출결을 즉시 체크**하고, 하루 수업이 끝난 뒤 **PC에서 버튼 하나로 NEIS에 자동 입력·저장·마감**할 수 있도록 지원한다.

### 1.2 배경

- 2025학년도 1학년부터 교과담당교사의 일자별·교시별 과목 출결 입력·마감이 의무화됨
- 매 수업마다 NEIS에 접속해 입력하는 것은 비효율 — 수업 직후 체크는 모바일이 적합
- NEIS 접속·메뉴 이동·엑셀 연동 자동화 노하우는 기존 담임용 앱에 존재

### 1.3 기존 앱과의 관계

현재 저장소의 담임용 앱(`interface_teacher.py` 등)과 **대상·워크플로우가 다르므로 별도 EXE**로 빌드한다. 단, Selenium 헬퍼(`utils.py`), 교육청 매핑(`regions.py`), 로거 설정(`logger_config.py`)은 **기존 파일을 수정 없이 공유**한다.

---

## 2. 아키텍처

### 2.1 시스템 구성

```
┌────────────────────┐         ┌──────────────────────────┐
│  모바일 PWA        │         │  교사의 Google Drive      │
│  (Vite+React+TS)   │ ──────▶ │  appDataFolder (숨김)     │
│                    │  Drive  │  - settings.json          │
│  - 오늘 수업 리스트│  API    │  - timetable.json         │
│  - 불참자 체크     │ ◀────── │  - students.json          │
│  - 비고 입력       │         │  - attendance-YYYY-MM.json│
└────────────────────┘         └──────────────────────────┘
                                         ▲
                                         │ Drive API
                                         │
                               ┌────────────────────┐
                               │  PC 앱 (Python)     │
                               │                     │
                               │  - Drive 최신 읽기  │
                               │  - NEIS 자동 입력   │
                               │  - 저장 / 마감 실행 │
                               └────────────────────┘
                                         │
                                         ▼ (Selenium)
                                    NEIS 웹사이트
```

### 2.2 설계 원칙

1. **서버리스** — 개발자 서버를 운영하지 않는다. 교사 Google 계정 + Drive `appDataFolder`가 유일한 백엔드.
2. **두 클라이언트, 하나의 데이터** — PWA와 PC 앱 모두 동일한 Drive JSON 파일을 읽고 쓴다.
3. **역할 분리** — 모바일은 입력 전용, PC는 NEIS 자동화 전용. 서로 겹치지 않는다.
4. **기존 앱 재사용** — `utils.py`, `regions.py`, `logger_config.py`는 수정하지 않고 import만 한다.
5. **낙관적 UI + 오프라인 큐** — 모바일이 네트워크 불안정해도 IndexedDB에 큐잉 후 복구 시 동기화.

### 2.3 기술 스택

| 계층 | 선택 | 비고 |
|---|---|---|
| 모바일 PWA | Vite + React + TypeScript | 가벼운 빌드, PWA 플러그인 성숙 |
| UI 컴포넌트 | shadcn/ui + Tailwind | 모바일 친화 |
| 인증 (PWA) | Google Identity Services (GIS) 토큰 모델 | 팝업 없는 silent refresh |
| PWA 호스팅 | Vercel 무료 tier | 자동 HTTPS, CI/CD |
| PC 앱 | Python 3 + CustomTkinter | 기존 담임용 앱과 일관 |
| 인증 (PC) | `google-auth-oauthlib`, `googleapiclient` | Installed App flow |
| 토큰 저장 (PC) | Windows DPAPI (`win32crypt`) | 기존 `password.bin` 방식 확장 |
| PyInstaller spec | 별도 (`NEIS_Subject_Teacher.spec`) | 단일 EXE 배포 |

---

## 3. 데이터 모델 (Drive 파일 스키마)

모든 파일은 교사 본인의 Google Drive `appDataFolder` 숨김 영역에 저장된다. 교사 외 사용자·앱은 접근할 수 없다.

### 3.1 `settings.json`

```json
{
  "schemaVersion": 1,
  "teacherName": "홍길동",
  "schoolName": "○○고등학교",
  "region": "B10",
  "semester": { "year": 2026, "term": 1 },
  "closeByDefault": false,
  "updatedAt": "2026-04-17T09:00:00+09:00"
}
```

- `region`: 17개 시도교육청 코드 (`regions.py` 참조)
- `closeByDefault`: PC 앱의 "출결마감까지 자동" 토글 기본값
- NEIS 인증서 비밀번호는 여기에 저장하지 않는다. PC 앱 로컬 `%LOCALAPPDATA%\NeisSubject\password.bin`에만 DPAPI로 저장.

### 3.2 `timetable.json`

```json
{
  "schemaVersion": 1,
  "effectiveFrom": "2026-03-02",
  "slots": [
    {
      "id": "mon-1",
      "dayOfWeek": 1,
      "period": 1,
      "grade": 2,
      "classNo": 3,
      "subjectName": "수학Ⅰ",
      "neisSubjectLabel": "수학Ⅰ(2-3)"
    }
  ]
}
```

- `dayOfWeek`: 1=월 ~ 5=금
- `neisSubjectLabel`: NEIS '담당과목' 드롭다운 라벨과 **정확히 일치**해야 자동화가 매칭된다. 세팅 시 PC 앱이 NEIS에서 읽어와 드롭다운으로 제안한다.

### 3.3 `students.json`

```json
{
  "schemaVersion": 1,
  "classes": {
    "2-3": [
      { "number": 1, "name": "김가나" },
      { "number": 2, "name": "박다라" }
    ]
  }
}
```

- 키 포맷: `"{grade}-{classNo}"`
- 학생 이름까지 저장 (교사 본인 드라이브 한정). 개발자 서버에는 전송되지 않는다.

### 3.4 `attendance-YYYY-MM.json`

월 단위로 파일을 분할한다.

```json
{
  "schemaVersion": 1,
  "month": "2026-04",
  "records": {
    "2026-04-17": {
      "mon-1": {
        "absences": [
          { "studentNumber": 15, "markType": "excused", "note": "교외체험학습" },
          { "studentNumber": 22, "markType": "absent",  "note": "" }
        ],
        "checkedAt": "2026-04-17T09:55:00+09:00",
        "source": "mobile",
        "syncedToNeis": false,
        "closedOnNeis": false
      }
    }
  }
}
```

- `absences` 빈 배열 = 전원 출석 (PC 자동화 시 NEIS에서 마감만 수행)
- `markType`:
  - `"absent"` — 일반 결과. NEIS 화면에서 `/`로 표기.
  - `"excused"` — 출석인정 결과. NEIS 화면에서 `∅`로 표기 (2026학년도 고1·고2부터 적용).
- `syncedToNeis` / `closedOnNeis`: 이중 입력 방지 플래그. PC 실행 중 실패한 수업은 false로 남아 재실행 시 재시도된다.
- `source`: 출처 기록용. "mobile"이 기본이며, 모바일을 쓸 수 없어 PC 세팅 탭에서 수동으로 편집한 경우 "pc"로 기록한다.

### 3.5 스키마 마이그레이션

모든 파일에 `schemaVersion` 필드를 유지한다. 앱 시작 시 버전을 확인하고 낮으면 자동 업그레이드 함수를 실행한다. 실패하면 원본 백업본을 만들고 사용자에게 수동 수정을 요청한다.

### 3.6 파일 크기 예상

- 시간표 ~5KB, 학생 명부 ~15KB, 월별 출결 ~100KB
- Drive 무료 15GB 중 연간 수 MB 수준 사용

---

## 4. 화면 흐름

### 4.1 모바일 PWA

```
① 로그인 (Google OAuth, appDataFolder 권한 1개)
      ↓
② 초기 세팅 가이드 (시간표/학생 명부 비어 있으면 "PC에서 세팅" 안내)
      ↓
③ 오늘의 수업 메인
   - 날짜 기본: 오늘. 상단에 날짜 선택 드롭다운
   - 교시 리스트: "1교시 · 2-3 · 수학Ⅰ [체크됨/미체크]"
   - [시간표 수정] 버튼: 당일 단건 변경 수준(보결·특강 등 돌발 대응). 주간 시간표 대량 편집은 PC 세팅 탭에서만 수행
      ↓ 교시 탭
④ 수업 상세
   - 학생 리스트, 기본 상태 '출석'
   - 학생 탭 1회 = 출석 ↔ 결과(`/`) 토글 (일반 불참)
   - 학생 롱프레스 = 상태·비고 바텀시트
   - 셀 표시: 아무것도 없음(출석) / `/`(결과) / `∅`(출석인정 결과)
   - [전원 출석으로 저장], [저장] 버튼
      ↓ 롱프레스
⑤ 상태·비고 바텀시트
   - 상태 라디오: ○ 출석 / ○ 결과(`/`) / ○ 출석인정(`∅`)
   - 비고: 프리셋 칩(질병 / 미인정 / 기타 / 교외체험학습 등) + 자유 입력 필드
   - [확인]
```

**UX 원칙**:
- 저장 = Drive 쓰기 + IndexedDB 캐시 갱신
- 네트워크 단절 시 IndexedDB 큐 → 복구 시 자동 업로드. "동기화 대기 중" 배지 표시.

### 4.2 PC 앱

```
상단: Google 계정 연결 상태 / 교육청 선택 / NEIS 비밀번호 관리
중단 (출결 입력 탭):
   - 대상 날짜 선택 (기본: 오늘)
   - Drive에서 읽은 오늘의 수업 현황
     ✓ 1교시 · 2-3 · 수학Ⅰ    불참 2명
     ✓ 3교시 · 2-5 · 수학Ⅰ    전원 출석
     ✗ 5교시 · 1-2 · 공통수학  미체크 (건너뜀)
   - 체크박스: "출결마감까지 자동 실행"
   - [Drive 다시 읽기] / [출결 입력 시작]
하단: 진행 로그 (기존 logger_config 큐 패턴)
```

**UX 원칙**:
- 모바일에서 체크하지 않은(미체크) 수업은 자동 스킵. 교사가 명시적으로 "전원 출석으로 저장"한 것만 마감 대상.
- 수업 단위 성공/실패 표시. 실패 항목만 재실행 가능.

### 4.3 PC 세팅 탭 (최초 사용)

```
[시간표 입력] 탭
   - "NEIS에서 내 시간표 가져오기" (선택적 크롤링)
   - 수동 입력 그리드 (요일×교시)
   - 각 칸: 학년-반 + 과목명 (neisSubjectLabel은 NEIS에서 긁은 목록에서 선택)

[학생 명부 입력] 탭
   - 반별 탭 (2-3, 2-5, …)
   - 학생 번호·이름 입력, 엑셀 붙여넣기 지원
   - "NEIS에서 반 명부 가져오기" (선택적)

저장 시 Drive에 업로드 → 모바일에서 자동 반영
```

---

## 5. 인증·보안·개인정보

### 5.1 Google OAuth

- 스코프: `https://www.googleapis.com/auth/drive.appdata` **1개만**
- 비-민감 스코프 — Google Security Assessment 불필요
- 초기 배포 단계에서 미인증 앱 경고 화면 노출, 100명 한도 내 동작
- 100명 초과 시 Basic Verification 신청 (도메인 소유 + 기본 서류)

### 5.2 토큰 저장

| 항목 | 위치 | 보호 |
|---|---|---|
| PC refresh_token | `%LOCALAPPDATA%\NeisSubject\token.bin` | Windows DPAPI |
| PC NEIS 인증서 비번 | `%LOCALAPPDATA%\NeisSubject\password.bin` | Windows DPAPI |
| PWA access_token | 브라우저 메모리 + GIS silent refresh | localStorage 사용 금지 |

### 5.3 개인정보처리방침 요약

- 수집: 교사가 입력한 시간표, 학급 학생 명부(이름·번호), 출결 기록, 비고. Google OAuth 토큰.
- 저장: 교사 본인의 Google Drive `appDataFolder` + PC 로컬. 개발자 서버 없음.
- 제3자 제공/위탁: 없음. Google Drive API와만 통신.
- 보관 기간: 교사가 앱 내에서 삭제하거나 Google 계정에서 앱 권한을 철회할 때까지.
- 배포 시 안내: "학생 정보 입력 전 학교의 개인정보 정책을 확인하세요."
- 처리자 정보(이름·연락처)는 배포 시 실제 개발자 정보로 구체화한다.

### 5.4 권한 철회

PWA·PC 모두 "연결 해제" 버튼 제공:
1. Google 토큰 revoke API 호출
2. 로컬 토큰 파일 삭제
3. Drive 파일 유지 안내 (교사가 Drive에서 직접 삭제 가능)

### 5.5 위협 모델

| 위협 | 완화책 |
|---|---|
| PC 토큰 파일 탈취 | DPAPI — 같은 Windows 사용자 계정 외 복호화 불가 |
| PWA XSS | Vite 빌드 + CSP, 외부 스크립트 차단 |
| 중간자 공격 | HTTPS 강제 (Vercel 기본) |
| Drive 파일 실수 삭제 | 월별 분할로 피해 최소화, Drive 휴지통 30일 복구 |
| NEIS 인증서 비번 유출 | 기존과 동일: DPAPI, 메모리 외 평문 저장 금지 |

---

## 6. 모듈 구조

### 6.1 디렉토리 레이아웃

```
neis-attendance/
│
├─ (기존 — 담임용, 손대지 않음)
│  ├─ interface_teacher.py
│  ├─ btn_commands.py
│  ├─ config.py
│  ├─ utils.py              ← 공통 (공유)
│  ├─ regions.py            ← 공통 (공유)
│  ├─ logger_config.py      ← 공통 (공유)
│  └─ NEIS_Teacher_20251230.spec
│
├─ subject_teacher/         (신규 Python 앱)
│  ├─ __init__.py
│  ├─ main.py               (진입점)
│  ├─ gui/
│  │  ├─ app.py             (메인 윈도우)
│  │  ├─ setup_tab.py       (시간표·학생 입력)
│  │  ├─ run_tab.py         (출결 입력 실행)
│  │  └─ log_panel.py
│  ├─ auth/
│  │  ├─ google_oauth.py
│  │  └─ token_store.py     (DPAPI 래퍼)
│  ├─ drive/
│  │  ├─ client.py          (appDataFolder CRUD)
│  │  └─ schemas.py         (JSON 스키마·마이그레이션)
│  ├─ neis/
│  │  ├─ subject_commands.py   (과목별 출결관리 자동화 — 신규)
│  │  └─ crawl_timetable.py    (첫 세팅용 시간표 크롤 — 선택)
│  └─ state.py              (교과용 런타임 상태)
│
├─ subject_teacher_pwa/     (신규 웹앱)
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ vercel.json
│  ├─ public/
│  │  ├─ manifest.webmanifest
│  │  └─ icons/
│  └─ src/
│     ├─ main.tsx / App.tsx
│     ├─ routes/
│     │  ├─ Login.tsx
│     │  ├─ Home.tsx           (오늘의 수업)
│     │  └─ ClassDetail.tsx    (불참자 체크)
│     ├─ lib/
│     │  ├─ auth.ts
│     │  ├─ drive.ts
│     │  ├─ indexeddb.ts       (오프라인 큐)
│     │  └─ schemas.ts         (zod)
│     └─ components/
│        ├─ StudentRow.tsx
│        └─ NoteSheet.tsx
│
├─ tests/
│  ├─ test_password_crypto.py   (기존)
│  └─ test_drive_schemas.py     (신규)
│
└─ NEIS_Subject_Teacher.spec    (신규 PyInstaller spec)
```

### 6.2 공유 vs 분리

| 공유 (수정 없이 import) | 신규 작성 |
|---|---|
| `utils.py` — login, neis_go_menu, retry_on_error | `neis/subject_commands.py` |
| `regions.py` | `auth/`, `drive/` 전체 |
| `logger_config.py` | `state.py`, `gui/` 전체 |

### 6.3 NEIS 자동화 스케치

NEIS 화면(`[학적-출결관리-과목별출결관리-과목별출결관리(창의적체험활동제외)]`)의 핵심 요소:
- **일자순/과목순 라디오** — "일자순" 선택
- **일자 선택** + **조회** 버튼
- **좌측 교시 리스트** — 해당 날짜의 교시를 클릭해 학생 테이블 로드
- **상단 "출석인정" 체크박스** — 글로벌 모드 토글 (ON 상태에서 셀 클릭 시 `∅`)
- **학생 테이블** — 학년/반/번호/성명/전달내용/**출석상태**/비고/일출결사유 컬럼
- 출석상태 셀 클릭 = 현재 모드에 따라 `/` 또는 `∅` 표기
- **[초기화] / [저장] / [출결마감]** 버튼 (우측 상단)

```python
MENU_PATH = ["학적", "출결관리", "과목별출결관리", "과목별출결관리(창의적체험활동제외)"]

def process_day(driver, date, slot_records, close_after):
    neis_go_menu(driver, MENU_PATH)
    select_year_semester(driver, year, term)
    select_day_mode(driver, "일자순")
    select_date(driver, date)
    click_search(driver)
    
    for slot_id, att in slot_records.items():
        if att.syncedToNeis:
            continue
        select_period_on_left_panel(driver, att.period)   # 좌측 교시 리스트 클릭
        
        click_reset(driver)                                # 초기화 → 재실행 안전성
        ensure_excused_mode(driver, False)
        
        # 1단계: 일반 결과 (/)
        for a in [x for x in att.absences if x.markType == "absent"]:
            click_attendance_cell(driver, a.studentNumber)
            if a.note:
                fill_note(driver, a.studentNumber, a.note)
        
        # 2단계: 출석인정 결과 (∅)
        if any(a.markType == "excused" for a in att.absences):
            ensure_excused_mode(driver, True)
            for a in [x for x in att.absences if x.markType == "excused"]:
                click_attendance_cell(driver, a.studentNumber)
                if a.note:
                    fill_note(driver, a.studentNumber, a.note)
            ensure_excused_mode(driver, False)            # 다음 교시 영향 방지
        
        click_save(driver)
        mark_synced_in_drive(slot_id, synced=True)
        
        if close_after:
            click_close(driver)
            mark_synced_in_drive(slot_id, closed=True)
```

- **초기화 활용**: 매 교시 처리 시작 시 NEIS 화면을 리셋해 부분 실패·수기 입력 상태를 정리. Drive 데이터를 단일 source of truth로 삼는 전략과 일치.
- **모드 전환 최소화**: 한 교시당 출석인정 모드 전환은 최대 2회(OFF→ON→OFF).
- **비고일괄 기능 (선택적 최적화)**: 같은 비고 텍스트를 가진 학생이 N명 이상이면 "비고일괄" 입력으로 한 번에 적용해 클릭 수 감소. 초기 구현에서는 스킵해도 무방.

---

## 7. 구현 로드맵

| 단계 | 결과물 | 의존 |
|---|---|---|
| 1 | 스키마 + DPAPI 토큰 저장 + 단위 테스트 | 독립 |
| 2 | PC Google OAuth + Drive 왕복 검증 (콘솔 스크립트) | 1 |
| 3 | PC NEIS 과목별 메뉴 자동화 (수동 데이터) | `utils.py` |
| 4 | PC GUI 최소 버전 (날짜 선택 + 실행 버튼) | 1~3 |
| 5 | PWA 뼈대 (Vite, OAuth, Drive 왕복) | 2 |
| 6 | PWA 오늘 수업 + 체크 화면 | 5 |
| 7 | PWA 오프라인 큐 (IndexedDB + Service Worker) | 6 |
| 8 | PC 세팅 UI (시간표·학생 입력) | 4 |
| 9 | 통합 E2E 테스트 (실제 교사 시나리오 1일치) | 전부 |
| 10 | 배포 (Vercel PWA, PyInstaller EXE) | 전부 |

각 단계는 독립적으로 검증 가능하다. 4·5단계가 끝난 시점에 이미 수동 데이터로 NEIS 자동화를 검증할 수 있다.

---

## 8. 에러 처리

| 영역 | 실패 시나리오 | 대응 |
|---|---|---|
| Google OAuth | 토큰 만료, 권한 철회 | 재로그인 유도, 로컬 큐 유지 |
| Drive API | 네트워크 단절, 429 | 지수 백오프 3회 → 실패 시 IndexedDB 큐 |
| JSON 파싱 | 손상, 스키마 버전 불일치 | 자동 마이그레이션 → 실패 시 백업본 생성 후 사용자 수동 수정 |
| NEIS 로그인 | 비번 오류, 점검 | 메시지박스 + 중단 (기존 앱과 동일) |
| NEIS 화면 구조 변경 | 엘리먼트 못 찾음 | `retry_on_error` 3회 → 해당 수업 스킵, 로그, 나머지 수업 계속 |
| 과목 라벨 매칭 | `neisSubjectLabel` 불일치 | 해당 수업 스킵, 불일치 목록 수집 → 종료 후 일괄 안내 |
| 학생 번호 매칭 | NEIS에 없는 번호, 전학 | 해당 학생 스킵, 로그 경고 |
| PWA 오프라인 | 체크 중 네트워크 단절 | IndexedDB 큐 + "동기화 대기 중" 배지 |
| 동시 수정 충돌 | 모바일·PC 동시 저장 | 최종 쓰기 승리 + `updatedAt` 기록 |

**공통 원칙**: 하나의 실패가 전체를 멈추지 않는다. 실패 항목만 로그에 수집 후 종료 시 요약. 재실행 시 성공분은 `syncedToNeis` 플래그로 자동 스킵.

---

## 9. 테스트 전략

### 9.1 Python PC 앱 (`pytest`)

- 단위: `drive/schemas.py` JSON 검증·마이그레이션, `auth/token_store.py` DPAPI 암복호화 (기존 `test_password_crypto.py` 패턴 확장)
- 단위: `neis/subject_commands.py` 내부 함수 (Selenium driver는 Mock)
- 통합: Drive appDataFolder 왕복 — 개발자 테스트 계정, 로컬 전용
- 수동: NEIS 자동화는 개발자 계정의 테스트 반으로 실제 브라우저 실행

### 9.2 PWA (`vitest` + `playwright`)

- 단위: `lib/schemas.ts` (zod), `lib/indexeddb.ts` 큐 로직
- 컴포넌트: 학생 행 토글, 비고 시트
- E2E: 로그인 → 오늘 수업 → 체크 → 저장 → Drive 파일 확인 (Playwright)
- 수동: iOS Safari, Android Chrome에서 PWA 설치 + 오프라인 시나리오

### 9.3 하지 않을 것

NEIS 자체 Mock은 만들지 않는다. NEIS 화면은 자주 바뀌므로 Mock은 거짓 안전감을 유발한다. 실제 브라우저로만 검증한다.

---

## 10. 알려진 제약과 트레이드오프

1. **첫 사용자 세팅 부담**: 교사가 시간표·학생 명부를 직접 입력해야 한다. 학기 초 30~60분 소요. NEIS 크롤링 자동 채우기는 선택 기능으로 남긴다.
2. **NEIS UI 변경 취약성**: Selenium은 NEIS 화면 구조에 의존한다. 교육부 업데이트 시 `subject_commands.py` 수정 필요. 수정 포인트를 한 파일에 집중시킨다.
3. **과목 라벨 매칭**: NEIS 드롭다운 라벨이 학교마다 다를 수 있다. 세팅 시 PC 앱이 실제 NEIS에서 읽어와 드롭다운으로 제공해 정확도를 높인다.
4. **Google 미인증 앱 경고**: 초기 100명 한도 내에서 배포. 초과 시 Verification 진행.
5. **모바일 오프라인 한계**: Drive API 자체는 오프라인 동작하지 않는다. IndexedDB 큐로 체크·저장은 가능하지만, 타 기기 동기화는 네트워크 복구 후에만 가능하다.
6. **학교 정책 차이**: 일부 학교가 외부 클라우드 사용을 제한할 수 있다. 배포 안내에 "학교 정책 확인 후 사용" 명시.
7. **2025학년도 1학년 이후 한정**: 과목별 출결 입력 자체가 해당 학년부터 의무다. 그 이전 학년용으로는 사용 의미가 없다.
8. **담임 겸임 시 두 앱 실행**: 담임용과 교과용을 별도 EXE로 가져간 귀결. 향후 런처로 묶을 수 있다.
9. **출석인정 `∅` 표기는 2026학년도 고1·고2부터**: 2022 개정 교육과정 대상 학년에 2026.2.27. 적용. 그 이전 방식(비고에 "출석인정 결과" 기재)은 지원하지 않는다. 실사용 대상인 2025학년도 1학년 코호트가 2026학년도 2학년이 되므로 전원 신 방식 적용 대상이다.
10. **NEIS 수기 입력과의 충돌**: 본 앱은 매 교시 NEIS 화면을 [초기화] 후 Drive 데이터로 재입력하므로, **앱 도입 이후에는 출결 수정을 앱(모바일 또는 PC 세팅 탭)에서만 수행해야 한다**. 교사가 NEIS에서 직접 수정한 내용은 다음 실행 시 덮어써진다. 이 운영 규칙을 앱 내 안내 문구와 초기 설정 가이드에 명시한다.

---

## 11. 설계 결정 요약

| 항목 | 결정 |
|---|---|
| 대상 | 교과담당교사 (2025학년도 1학년 이후) |
| 모바일 | PWA (Vite+React+TS, Vercel) |
| PC | 기존 앱과 별도 EXE, 공통 모듈 공유 |
| 저장소 | Google Drive appDataFolder (서버리스) |
| 인증 스코프 | `drive.appdata` 1개 |
| 토큰 저장 | Windows DPAPI |
| 모바일 UX | 오늘의 수업 중심 (A), 기본 출석·불참자만 체크 (i) |
| PC 실행 | 하루 일괄 처리 (A) + 마감 토글형 (다) |
| 데이터 모델 | settings / timetable / students / attendance-YYYY-MM |
| 학생 식별 | 이름+번호까지 저장 (쌤핀과 동일 수준) |
| 출결 마크 | `markType: "absent"` (`/`) / `"excused"` (`∅`) — 2026학년도 고1·고2 신 방식 |
| 자동화 흐름 | 교시별 [초기화] → 일반 결과 → 출석인정 모드 전환 후 ∅ → [저장] (+ [출결마감]) |
| 에러 처리 | 수업 단위 실패 격리, `syncedToNeis` 플래그로 재실행 시 스킵 |
