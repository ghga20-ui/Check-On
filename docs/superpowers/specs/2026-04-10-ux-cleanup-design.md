# UX 개선 + 코드 정리 Design

**Date:** 2026-04-10
**Scope:** 단계별 상태 레이블 추가, 미사용 코드 제거

---

## 1. 단계별 상태 레이블 (UX)

### 문제
자동화 실행 중 현재 어느 단계인지 알 수 없고, 하단 상태 박스의 로그만으로는 진행 상황 파악이 어려움.

### 설계

**새 위젯**: `ctk.CTkLabel` — 액션 버튼(row 3)과 상태 박스 사이에 삽입

- `create_status_label()` 메서드 추가, `__init__`에서 `create_action_buttons()` 다음에 호출
- 기존 row 배치 조정: 상태 박스 row 4 → row 5, footer row 5 → row 6
- `__init__`의 `self.grid_rowconfigure(4, weight=1)` → `self.grid_rowconfigure(5, weight=1)` 로 변경
- 레이블은 row 4, `sticky="w"`, `text_color=SOLARIZED["blue"]`
- 평상시 `text=""` (빈 텍스트)

**단계 업데이트 방식**

각 `task()` 람다에서 함수 호출 사이에 `self.after(0, lambda: self.step_label.configure(text="..."))` 호출. btn_commands.py 수정 없이 interface_teacher.py 내에서만 처리.

각 워크플로우별 단계:

| 워크플로우 | 단계 |
|---|---|
| 원스톱 자동화 | [1/5] 나이스 로그인 → [2/5] 결석 신고서 → [3/5] 지각·조퇴 신고서 → [4/5] 월별 출결 → [5/5] 엑셀 처리 |
| 신고서만 다운로드 | [1/3] 나이스 로그인 → [2/3] 결석 신고서 → [3/3] 지각·조퇴 신고서 |
| 월별 출결만 다운로드 | [1/2] 나이스 로그인 → [2/2] 월별 출결 |
| 엑셀 자동화만 실행 | [1/1] 엑셀 처리 중 |

**레이블 초기화**: `run_worker()`의 `finally` 블록에서 `self.after(0, ...)` 로 `text=""` 설정 (버튼 복원과 동일 패턴).

---

## 2. 코드 정리

### ① config_teacher.py 삭제
어디서도 import되지 않는 미사용 파일. `config.py`가 동일 역할 수행.

### ② interface_teacher.py 미사용 import 제거

현재:
```python
from btn_commands import (open_eduptl, open_neis, neis_attendace, download_monthly_attendance,
                          download_all_attendance, neis_attendace_v2, download_tardiness_report_v2,
                          download_all_attendance_v2)
```

변경 후 (실제 사용되는 것만):
```python
from btn_commands import (open_neis, neis_attendace_v2, download_tardiness_report_v2,
                          download_monthly_attendance)
```

제거 대상: `open_eduptl`, `neis_attendace`, `download_all_attendance`, `download_all_attendance_v2`

### ③ btn_commands.py v1 함수 제거

제거 전 grep으로 프로젝트 전체에서 참조 여부 확인 후 삭제:
- `open_eduptl()` — UI 버튼 없음, 어디서도 호출 안 됨
- `neis_attendace()` — v2(`neis_attendace_v2`)로 대체됨
- `download_all_attendance()` — v2(`download_all_attendance_v2`)로 대체, v2도 미사용
- `download_all_attendance_v2()` — import만 되고 호출 안 됨

### ④ save_menus() print → logger

```python
# 현재
except Exception as e:
    print(f"[오류] 메뉴 저장 실패: {e}")
# 변경
except Exception as e:
    logger.warning(f"메뉴 저장 실패: {e}")
```

---

## 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `interface_teacher.py` | 수정 — 레이블 추가, import 정리, save_menus logger |
| `btn_commands.py` | 수정 — v1 미사용 함수 제거 |
| `config_teacher.py` | 삭제 |
