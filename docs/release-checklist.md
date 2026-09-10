# 체크온(CheckOn) 배포 체크리스트

체크온은 **모바일 PWA + 데스크톱 앱 + 구글 OAuth 백엔드** 세 부분을 함께 배포합니다.
각 릴리스마다 아래를 순서대로 확인하세요.

---

## 0. 사전 조건 (한 번만)

- [ ] Google Cloud OAuth 동의 화면이 **프로덕션으로 게시**됨 (테스트 모드면 토큰이 7일마다 만료).
- [ ] 개인정보처리방침이 **공개 URL**로 접근 가능 (PWA `/privacy`), OAuth 동의 화면에 연결됨.
- [ ] 데스크톱용 **설치형(Installed) OAuth 클라이언트**와 PWA용 **웹(Web) OAuth 클라이언트**가 같은 프로젝트에 존재.
- [ ] 웹 클라이언트의 **승인된 자바스크립트 원본**에 Vercel 배포 URL 등록.
- [ ] (검토 권장) 학교·교육청 규정상 개인 구글 계정에 학번 출결 저장 가능 여부 확인.

## 1. 공통 검증 (배포 전)

- [ ] Python 테스트 통과: 레포 루트에서 `py -3.14 -m pytest tests/ -q`
- [ ] 데스크톱 UI 테스트: `subject_teacher/neis_attendance/`에서 `npm test`
- [ ] PWA 테스트: `subject_teacher_pwa/`에서 `npm test`
- [ ] 종단간 암호화 상호검증 벡터 통과 (`tests/test_drive_crypto.py`, PWA `crypto.test.ts`).

## 2. 데스크톱 앱 빌드

표준 빌드 명령: `py -3.14 -m subject_teacher.scripts.build_release`

이 명령은 Python·데스크톱·모바일 테스트, UI 빌드, 소스 시작 검사, EXE 빌드,
EXE 시작 검사, 설치본 생성 순서로 실행합니다. 검사한 EXE의 절대 경로를
Inno Setup에 전달하며 설치본과 함께 SHA-256 manifest를 남깁니다.
명령이 실패하면 기존 설치본을 새 빌드 결과로 취급하지 마세요.

- [ ] `ui_and_python_ready` 검사 통과: 실제 React 화면과 Python API 왕복 확인.
- [ ] 같은 수업 동시 수정 시 충돌 안내, 다른 수업 동시 수정 시 기록 보존 확인.
- [ ] 자동 입력 도중 수정·삭제한 수업이 반영 완료로 표시되지 않는지 확인.
- [ ] PC와 모바일을 함께 업데이트. 구버전의 무조건 덮어쓰기와 혼용하지 않음.
- [ ] 첫 월파일 생성 경쟁으로 중복 파일이 발견되면 원본 보존·작업 차단 확인.

- [ ] React UI 빌드: `subject_teacher/neis_attendance/`에서 `npm install && npm run build`
- [ ] `client_secrets.json`(설치형 클라이언트)이 레포 루트에 있는지 확인 (gitignore됨 → 커밋 금지, 빌드 시 EXE에 번들됨).
- [ ] EXE 빌드: 루트에서 `py -3.14 -m PyInstaller NEIS_Subject_Teacher.spec --noconfirm --distpath dist/checkon_build`
- [ ] 스모크 테스트: `py -3.14 -m subject_teacher.scripts.check_desktop_startup --exe dist/checkon_build/NEIS_Subject_Teacher.exe`.
      격리된 임시 사용자 데이터 경로에서 실제 창과 Python 연결을 검사하며 Google에는 접근하지 않음.
- [ ] 일반 실행에서 실제 Google 로그인을 별도 확인.
- [ ] 인스톨러 생성 (Inno Setup 6 필요): `ISCC.exe /DAppVersion=<버전> installer\checkon.iss`
      → `dist/installer/CheckOn-Setup-<버전>.exe`
- [ ] 인스톨러를 **다른 PC(관리자 권한 없는 환경 포함)**에서 설치·실행 테스트. WebView2 런타임 없는 PC에서 안내 메시지가 뜨는지 확인.
- [ ] (선택) 코드 서명 — 미서명 시 Windows SmartScreen "알 수 없는 게시자" 경고가 뜨므로 사용자 안내 필요.

## 3. 모바일 PWA 배포

- [ ] `subject_teacher_pwa/`가 Vercel에 자동 배포됨 (푸시 시). 커밋 계정이 연결된 GitHub 사용자여야 배포 통과.
- [ ] Vercel 환경변수 `VITE_GOOGLE_CLIENT_ID`에 **프로덕션 웹 클라이언트 ID** 설정.
- [ ] 휴대폰에서 PWA "홈 화면에 추가" 후 실행 → Google 로그인 → 데스크톱과 QR 페어링 → 출결 동기화 1회 확인.

## 4. 종단간 암호화 / 개인정보 최종 확인

- [ ] 암호화를 켠 뒤 구글 드라이브 파일이 **암호문 봉투**(`checkonEnc`) 형태인지 확인.
- [ ] 클라우드 로스터에 **학생 이름이 없는지**(학번만) 확인.
- [ ] 페어링 키/QR payload가 로그·커밋·클라우드에 남지 않는지 확인.
- [ ] **열쇠 복구/재발급 흐름**이 동작하는지 확인 (PC 교체·초기화 시 데이터 복구 가능 여부).

## 5. NEIS 자동화 실기기 검증

- [ ] 실제 NEIS "과목별출결관리" 화면에서: 날짜 선택 → 교시·과목 선택 → 출결 셀 체크 → 저장 → `결과: n명` 카운트 일치 확인.
- [ ] 같은 과목 다른 반(예: `2학년 1(문학)` / `2학년 2(문학)`)이 혼동되지 않는지 확인.
- [ ] (활성화 시) `출결마감` 동작을 소수 케이스에서 먼저 라이브 검증.

## 6. 민감 파일 제외

배포 산출물(EXE·설치본·zip)과 커밋에 아래가 섞이지 않도록 확인:

- [ ] `token.bin`, `password.bin`, `sync_key.bin` 및 웹 OAuth 비밀키 제외. `client_secrets.json`은 커밋 금지이며 설치형(`installed`) OAuth 공개 클라이언트 설정만 데스크톱 패키지에 포함 가능. 웹형(`web`)은 빌드에서 거부.
- [ ] `tmp_*.json`(NEIS 진단 덤프), `logs/`, `__pycache__/`, `.pytest_cache/`
- [ ] 학생 **이름**이 담긴 로컬 파일(`students.local.json`)

## 배포 보류 기준

아래 중 하나라도 실패하면 재빌드 후 다시 확인:

- EXE 실행 불가 / 창이 안 뜸
- Google 로그인 실패 (OAuth 게시·client_secrets 확인)
- 드라이브 파일이 평문으로 올라감 (암호화 미적용)
- 클라우드에 학생 이름 노출
- NEIS 저장 후 `결과` 카운트 불일치
- 민감 파일 포함

## 2026-09-10 통합·보안 배포 게이트

- [ ] 혼합수업은 기존 1.0.8 설치본에 포함되지 않으므로 PC·모바일을 대응 버전으로 함께 검증하고 배포.
- [ ] 혼합수업 실제 NEIS에서 원소속 반이 다르고 번호가 같은 학생을 구별해 입력·저장·재조회 확인. 자동 테스트의 건너뛴 실기기 증거를 통과로 취급하지 않음.
- [ ] 삼성인터넷 설치형 웹앱에서 장시간 미사용 후 자동 로그인 갱신, 미전송 기록 재시도, 기존 계정 확인 및 다른 계정 전환 차단 확인.
- [ ] 개인정보 안내 원본은 `subject_teacher_pwa/src/privacy-policy.json`. 수정 후 `node scripts/privacy.mjs`로 HTML·문서 생성. 빌드가 안내 일치 여부를 검사함.
- [ ] 별도 배포 스냅샷에는 PWA의 `scripts/`와 루트 `docs/legal/privacy-policy.md`, 테스트가 참조하는 `tests/fixtures/`도 포함.
- [ ] 운영자 표시, 외부 사업자의 실제 처리 지역·접속 로그 보유기간·국외 이전 근거 및 학교의 처리 권한 확정. 법률 준수 완료로 임의 표시하지 않음.
- [ ] 프로덕션 응답의 보안 헤더와 Google 로그인·QR 카메라 동작 확인.
- [ ] 웹 OAuth 비밀키와 쿠키 암호화 키는 서버 환경변수에만 저장. 프런트 `VITE_` 환경변수로 비밀키를 제공하지 않음.
- [ ] 로그아웃 후 로컬 캐시·완료 대기열·열쇠 삭제 확인. 미전송 출결은 삭제 대신 보존되는지 확인.

## 동료 교사용 안내 배포

- 안내 원본: `subject_teacher_pwa/src/privacy-policy.json`, `getting-started.json`, `school-guide.json`.
- `subject_teacher_pwa/scripts/privacy.mjs`가 공개 HTML과 `docs/legal/` 문서를 생성하며 `--check`로 일치 여부 확인.
- 별도 PWA 배포 스냅샷에는 생성된 `docs/legal/privacy-policy.md`, `getting-started.md`, `school-guide.md` 모두 포함.
- PC UI도 같은 JSON 원본을 빌드에 포함하므로 PC 빌드 환경에 해당 PWA 원본 파일 필요. 설치본 실행 시 웹 접속 없이 안내 열람 가능.
- 모바일 로그인 화면에서 이용 안내·학교 담당자용 안내 접근 가능. PC·모바일 설정 안내 창에서도 문서 선택 가능.
- 동료 배포 시 이용 안내를 전달하고, 학교 검토가 필요한 경우 데이터 처리 안내를 함께 제공. 안내 게시를 학교 승인·법적 검토 완료로 표시하지 않음.
