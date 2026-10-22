# Critical Fixes Design — 나이스 출결관리 프로

**Date:** 2026-04-10
**Scope:** `interface_teacher.py` 단독 수정 (3개 이슈)

---

## 1. 비밀번호 암호화 (Windows DPAPI)

### 문제
`password.txt`에 인증서 비밀번호가 평문으로 저장됨. README에는 "암호화 저장"이라고 명시되어 있어 사용자 신뢰 문제.

### 설계
- `win32crypt.CryptProtectData` / `CryptUnprotectData` 사용 (pywin32 이미 의존성에 포함)
- 저장 파일명: `password.txt` → `password.bin` (바이너리)
- 암호화 범위: 현재 Windows 사용자 계정 기준 (다른 계정/PC에서는 복호화 불가)

### 변경 위치
- `PASSWORD_FILE` 상수: `"password.txt"` → `"password.bin"`
- `on_password_change()`: 평문 write → DPAPI 암호화 후 바이너리 write
- `load_data()` 비밀번호 블록: 평문 read → 바이너리 read 후 DPAPI 복호화

### 마이그레이션
앱 시작 시 `password.txt`(구 파일)가 존재하면:
1. 평문 읽기
2. DPAPI 암호화 후 `password.bin`으로 저장
3. `password.txt` 삭제

---

## 2. `except: pass` 제거

### 문제
오류가 조용히 묻혀 디버깅 불가. 사용자는 작업이 실패했는지 알 수 없음.

### 설계
`interface_teacher.py` 상단에 `from logger_config import logger` 추가 후 아래 4곳 수정:

| 위치 | 변경 내용 |
|---|---|
| `on_password_change()` | `except: pass` → `except Exception as e: logger.warning(f"비밀번호 저장 실패: {e}")` |
| `load_data()` 비밀번호 블록 | `except: pass` → `except Exception as e: logger.warning(f"비밀번호 불러오기 실패: {e}")` |
| `load_data()` 메뉴 블록 | `except Exception as e: print(...)` → `logger.warning(f"설정 불러오기 실패: {e}")` |
| `backup_files()` | `except Exception: pass` → `except Exception as e: logger.warning(f"파일 백업 실패 ({filename}): {e}")` |

---

## 3. 버튼 비활성화 (Race condition 방지)

### 문제
자동화 작업 실행 중 사용자가 버튼을 다시 누르면 두 번째 스레드가 시작되어 `config.class_count` 등 전역 상태 충돌 발생.

### 설계
`run_worker()`에서 중앙 처리:
- 스레드 시작 **직전** (메인 스레드에서) `_set_buttons_state("disabled")`
- 작업 완료/실패 시 `finally` 블록에서 `self.after(0, lambda: self._set_buttons_state("normal"))` 로 메인 스레드에 위임 (tkinter 스레드 안전)

`_set_buttons_state(state)` 헬퍼 메서드 추가:
- `self._action_buttons` 리스트의 모든 버튼에 `configure(state=state)` 적용

`create_action_buttons()`에서 `add_btn()` 반환값을 `self._action_buttons` 리스트에 누적.

---

## 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `interface_teacher.py` | 수정 (유일한 변경 파일) |
