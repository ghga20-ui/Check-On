# UX 개선 + 코드 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단계별 상태 레이블 추가로 UX를 개선하고, 미사용 코드를 제거해 코드베이스를 정리한다.

**Architecture:** `interface_teacher.py`에 단계 레이블 위젯을 추가하고 각 워크플로우 task 람다에 단계 업데이트를 삽입. 코드 정리는 `config_teacher.py` 삭제, `btn_commands.py` v1 함수 제거, `interface_teacher.py` import/logger 정리.

**Tech Stack:** Python, CustomTkinter, Solarized 색상 팔레트 (기존 코드 패턴 유지)

---

### Task 1: 코드 정리

**Files:**
- Delete: `C:/Users/admin/Desktop/2026_project/neis-attendance/config_teacher.py`
- Modify: `C:/Users/admin/Desktop/2026_project/neis-attendance/btn_commands.py`
- Modify: `C:/Users/admin/Desktop/2026_project/neis-attendance/interface_teacher.py`

- [ ] **Step 1: config_teacher.py가 어디서도 import되지 않는지 확인**

```bash
cd C:/Users/admin/Desktop/2026_project/neis-attendance
grep -r "config_teacher" . --include="*.py"
```

Expected: 결과 없음. 결과가 있으면 중단하고 보고.

- [ ] **Step 2: config_teacher.py 삭제**

```bash
rm C:/Users/admin/Desktop/2026_project/neis-attendance/config_teacher.py
```

- [ ] **Step 3: btn_commands.py에서 제거할 v1 함수 확인**

아래 함수들이 프로젝트 전체에서 호출되는지 확인:

```bash
grep -rn "open_eduptl\|neis_attendace\b\|download_all_attendance\b\|download_all_attendance_v2" . --include="*.py"
```

Expected: `btn_commands.py` 내 함수 정의만 나오고, `interface_teacher.py`에서의 import 라인만 보임. 다른 곳에서 호출된다면 중단하고 보고.

- [ ] **Step 4: btn_commands.py에서 v1 미사용 함수 제거**

`btn_commands.py`를 읽고 아래 함수들의 전체 정의를 제거하세요 (함수 시작부터 다음 함수 시작 전까지):
- `open_eduptl()` — UI 버튼 없음, 호출 안 됨
- `neis_attendace()` — `neis_attendace_v2`로 대체됨
- `download_all_attendance()` — `download_all_attendance_v2`로 대체됨
- `download_all_attendance_v2()` — import만 되고 실제 호출 안 됨

함수 제거 후 파일 문법 확인:
```bash
python -c "import ast; ast.parse(open('btn_commands.py', encoding='utf-8-sig').read()); print('OK')"
```

- [ ] **Step 5: interface_teacher.py import 라인 정리**

현재 (약 24번째 줄):
```python
from btn_commands import (open_eduptl, open_neis, neis_attendace, download_monthly_attendance,
                          download_all_attendance, neis_attendace_v2, download_tardiness_report_v2,
                          download_all_attendance_v2)
```

변경 후:
```python
from btn_commands import (open_neis, neis_attendace_v2, download_tardiness_report_v2,
                          download_monthly_attendance)
```

- [ ] **Step 6: save_menus() print → logger 교체**

`save_menus()` 내 (약 377번째 줄):
```python
        except Exception as e:
            print(f"[오류] 메뉴 저장 실패: {e}")
```

변경 후:
```python
        except Exception as e:
            logger.warning(f"메뉴 저장 실패: {e}")
```

- [ ] **Step 7: 문법 검사 및 import 확인**

```bash
cd C:/Users/admin/Desktop/2026_project/neis-attendance
python -c "import ast; ast.parse(open('interface_teacher.py', encoding='utf-8-sig').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 8: 변경 파일 확인**

- `config_teacher.py` 삭제됨
- `btn_commands.py` v1 함수 없음
- `interface_teacher.py` import 라인 정리됨, save_menus logger 교체됨

---

### Task 2: 단계 레이블 위젯 추가

**Files:**
- Modify: `C:/Users/admin/Desktop/2026_project/neis-attendance/interface_teacher.py`

- [ ] **Step 1: __init__의 grid_rowconfigure 수정**

현재 (약 96번째 줄):
```python
        self.grid_rowconfigure(4, weight=1)
```

변경 후 (상태 박스가 row 5로 이동):
```python
        self.grid_rowconfigure(5, weight=1)
```

- [ ] **Step 2: __init__에 create_status_label() 호출 추가**

현재 (약 102번째 줄):
```python
        self.create_action_buttons()
        self.create_status_bar()
```

변경 후:
```python
        self.create_action_buttons()
        self.create_status_label()
        self.create_status_bar()
```

- [ ] **Step 3: create_status_label() 메서드 추가**

`create_status_bar()` 메서드 바로 위에 삽입:

```python
    def create_status_label(self):
        self.step_label = ctk.CTkLabel(self, text="", font=self.main_font,
                                       text_color=SOLARIZED["blue"])
        self.step_label.grid(row=4, column=0, padx=20, pady=(2, 0), sticky="w")
```

- [ ] **Step 4: create_status_bar()의 grid row 수정**

현재 `create_status_bar()` 내:
```python
        self.status_box.grid(row=4, column=0, padx=20, pady=(5, 10), sticky="ew")
```

변경 후:
```python
        self.status_box.grid(row=5, column=0, padx=20, pady=(5, 10), sticky="ew")
```

- [ ] **Step 5: create_footer()의 grid row 수정**

현재 `create_footer()` 내:
```python
        footer.grid(row=5, column=0, pady=(0, 10))
```

변경 후:
```python
        footer.grid(row=6, column=0, pady=(0, 10))
```

- [ ] **Step 6: run_worker() finally 블록에 레이블 초기화 추가**

현재 `run_worker()` finally (약 415번째 줄):
```python
            finally:
                try:
                    self.after(0, lambda: self._set_buttons_state("normal"))  # 메인 스레드로 복원 위임
                except Exception:
                    pass  # 창이 이미 종료된 경우 TclError 방어
```

변경 후:
```python
            finally:
                try:
                    self.after(0, lambda: self.step_label.configure(text=""))
                    self.after(0, lambda: self._set_buttons_state("normal"))
                except Exception:
                    pass  # 창이 이미 종료된 경우 TclError 방어
```

- [ ] **Step 7: 실행 확인**

```bash
python interface_teacher.py
```

앱이 정상 실행되고 레이아웃이 깨지지 않으면 통과.

- [ ] **Step 8: 변경 확인**

- `step_label` 위젯이 버튼 아래, 상태 박스 위에 표시됨
- 레이아웃 깨짐 없음

---

### Task 3: 워크플로우별 단계 업데이트 삽입

**Files:**
- Modify: `C:/Users/admin/Desktop/2026_project/neis-attendance/interface_teacher.py`

- [ ] **Step 1: run_onestop_teacher() task 람다 수정**

현재 `task()` 람다 (약 436번째 줄):
```python
        def task():
            # 단일 학급 모드로 실행 (config.class_count = 1로 설정)
            import btn_commands as cmd
            original_class_count = getattr(config, 'class_count', 12)
            config.class_count = 1  # 단일 학급
            
            print(f"[정보] {class_num}반 출결 자동화를 시작합니다.")
            
            # 나이스 직접 로그인 (경량화)
            open_neis()
            
            # 신고서 다운로드 (로그인 스킵)
            neis_attendace_v2(start, end, download_dir=folder, skip_open=True, skip_click=True, menu=menu_abs)
            download_tardiness_report_v2(start, end, download_dir=folder, skip_open=True, skip_click=True, menu=menu_tard)
            
            # 월별 출결현황 다운로드 (로그인 스킵)
            download_monthly_attendance(month, download_dir=folder, skip_open=True, skip_click=True, menu=menu_mon)
            
            # 엑셀 매크로 실행
            self.run_excel_macro_direct(folder)
            
            config.class_count = original_class_count
```

변경 후:
```python
        def task():
            # 단일 학급 모드로 실행 (config.class_count = 1로 설정)
            import btn_commands as cmd
            original_class_count = getattr(config, 'class_count', 12)
            config.class_count = 1  # 단일 학급
            
            print(f"[정보] {class_num}반 출결 자동화를 시작합니다.")
            
            self.after(0, lambda: self.step_label.configure(text="[1/5] 나이스 로그인 중..."))
            open_neis()
            
            self.after(0, lambda: self.step_label.configure(text="[2/5] 결석 신고서 다운로드 중..."))
            neis_attendace_v2(start, end, download_dir=folder, skip_open=True, skip_click=True, menu=menu_abs)
            
            self.after(0, lambda: self.step_label.configure(text="[3/5] 지각·조퇴 신고서 다운로드 중..."))
            download_tardiness_report_v2(start, end, download_dir=folder, skip_open=True, skip_click=True, menu=menu_tard)
            
            self.after(0, lambda: self.step_label.configure(text="[4/5] 월별 출결 다운로드 중..."))
            download_monthly_attendance(month, download_dir=folder, skip_open=True, skip_click=True, menu=menu_mon)
            
            self.after(0, lambda: self.step_label.configure(text="[5/5] 엑셀 처리 중..."))
            self.run_excel_macro_direct(folder)
            
            config.class_count = original_class_count
```

- [ ] **Step 2: run_download_reports() task 람다 수정**

현재:
```python
        def task():
            open_neis()  # 나이스 직접 로그인
            neis_attendace_v2(start_date, end_date, download_dir=folder, skip_open=True, skip_click=True, menu=menu_abs)
            download_tardiness_report_v2(start_date, end_date, download_dir=folder, skip_open=True, skip_click=True, menu=menu_tard)
```

변경 후:
```python
        def task():
            self.after(0, lambda: self.step_label.configure(text="[1/3] 나이스 로그인 중..."))
            open_neis()
            self.after(0, lambda: self.step_label.configure(text="[2/3] 결석 신고서 다운로드 중..."))
            neis_attendace_v2(start_date, end_date, download_dir=folder, skip_open=True, skip_click=True, menu=menu_abs)
            self.after(0, lambda: self.step_label.configure(text="[3/3] 지각·조퇴 신고서 다운로드 중..."))
            download_tardiness_report_v2(start_date, end_date, download_dir=folder, skip_open=True, skip_click=True, menu=menu_tard)
```

- [ ] **Step 3: run_download_monthly() task 람다 수정**

현재:
```python
        def task():
            open_neis()  # 나이스 직접 로그인
            download_monthly_attendance(month_str, download_dir=folder, skip_open=True, skip_click=True, menu=menu)
```

변경 후:
```python
        def task():
            self.after(0, lambda: self.step_label.configure(text="[1/2] 나이스 로그인 중..."))
            open_neis()
            self.after(0, lambda: self.step_label.configure(text="[2/2] 월별 출결 다운로드 중..."))
            download_monthly_attendance(month_str, download_dir=folder, skip_open=True, skip_click=True, menu=menu)
```

- [ ] **Step 4: run_only_excel_macro() task 람다 수정**

현재:
```python
        def task():
            self.run_excel_macro_direct(folder)
```

변경 후:
```python
        def task():
            self.after(0, lambda: self.step_label.configure(text="[1/1] 엑셀 처리 중..."))
            self.run_excel_macro_direct(folder)
```

- [ ] **Step 5: 문법 검사**

```bash
cd C:/Users/admin/Desktop/2026_project/neis-attendance
python -c "import ast; ast.parse(open('interface_teacher.py', encoding='utf-8-sig').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 6: 변경 확인**

4개 워크플로우 task 람다에 `self.after(0, ...)` 단계 업데이트 삽입됨
