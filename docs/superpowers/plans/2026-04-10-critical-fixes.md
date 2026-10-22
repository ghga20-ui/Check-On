# Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비밀번호 평문 저장, 무시된 예외, 버튼 race condition 3가지 치명적 버그를 `interface_teacher.py` 단독 수정으로 해결한다.

**Architecture:** win32crypt(DPAPI)로 비밀번호 암호화 저장, logger로 예외 기록, run_worker()에서 버튼 비활성화 중앙 처리. 변경 파일은 `interface_teacher.py` 하나뿐.

**Tech Stack:** Python, win32crypt (pywin32에 포함 — 추가 설치 불필요), CustomTkinter, logger_config (기존)

---

### Task 1: logger import 추가 + except:pass 4곳 교체

**Files:**
- Modify: `interface_teacher.py`

- [ ] **Step 1: logger import 추가**

`interface_teacher.py` 27번째 줄 `from regions import REGION_LIST, DEFAULT_REGION` 바로 아래에 추가:

```python
from logger_config import logger
```

- [ ] **Step 2: on_password_change() except 교체**

현재 코드 (약 134번째 줄):
```python
    def on_password_change(self, *args):
        pw = self.password_var.get()
        config.user_password = pw
        try:
            with open(PASSWORD_FILE, "w", encoding="utf-8") as f:
                f.write(pw)
        except: pass
```

변경 후 (`except: pass` → `except Exception as e: logger.warning(...)`):
```python
    def on_password_change(self, *args):
        pw = self.password_var.get()
        config.user_password = pw
        try:
            with open(PASSWORD_FILE, "w", encoding="utf-8") as f:
                f.write(pw)
        except Exception as e:
            logger.warning(f"비밀번호 저장 실패: {e}")
```

- [ ] **Step 3: load_data() 비밀번호 블록 except 교체**

현재 코드 (약 312번째 줄):
```python
        if os.path.exists(PASSWORD_FILE):
            try:
                with open(PASSWORD_FILE, 'r', encoding='utf-8') as f:
                    self.password_var.set(f.read().strip())
            except: pass
```

변경 후:
```python
        if os.path.exists(PASSWORD_FILE):
            try:
                with open(PASSWORD_FILE, 'r', encoding='utf-8') as f:
                    self.password_var.set(f.read().strip())
            except Exception as e:
                logger.warning(f"비밀번호 불러오기 실패: {e}")
```

- [ ] **Step 4: load_data() 메뉴 블록 print → logger 교체**

현재 코드 (약 335번째 줄):
```python
            except Exception as e:
                print(f"[오류] 설정 로드 실패: {e}")
```

변경 후:
```python
            except Exception as e:
                logger.warning(f"설정 불러오기 실패: {e}")
```

- [ ] **Step 5: backup_files() except 교체**

현재 코드 (약 463번째 줄):
```python
                try:
                    shutil.move(file_path, os.path.join(backup_folder, filename))
                except Exception: pass
```

변경 후:
```python
                try:
                    shutil.move(file_path, os.path.join(backup_folder, filename))
                except Exception as e:
                    logger.warning(f"파일 백업 실패 ({filename}): {e}")
```

- [ ] **Step 6: 실행 확인**

```bash
python interface_teacher.py
```

앱이 정상 실행되면 통과.

- [ ] **Step 7: 커밋**

```bash
git add interface_teacher.py
git commit -m "fix: except:pass 제거, logger로 예외 기록"
```

---

### Task 2: 비밀번호 DPAPI 암호화

**Files:**
- Modify: `interface_teacher.py`
- Create: `tests/test_password_crypto.py`

- [ ] **Step 1: 테스트 파일 작성**

`tests/test_password_crypto.py` 생성:

```python
import win32crypt

def test_dpapi_roundtrip():
    """DPAPI 암호화 → 복호화 왕복 테스트"""
    original = "test_password_123!@#"
    encrypted = win32crypt.CryptProtectData(original.encode('utf-8'))
    _, decrypted = win32crypt.CryptUnprotectData(encrypted)
    assert decrypted.decode('utf-8') == original

def test_dpapi_empty_password():
    """빈 비밀번호도 정상 처리"""
    original = ""
    encrypted = win32crypt.CryptProtectData(original.encode('utf-8'))
    _, decrypted = win32crypt.CryptUnprotectData(encrypted)
    assert decrypted.decode('utf-8') == original
```

- [ ] **Step 2: 테스트 실패 확인 (함수 미구현 상태에서는 통과 — 라이브러리 검증용)**

```bash
python -m pytest tests/test_password_crypto.py -v
```

Expected: PASS (win32crypt 라이브러리 자체 검증). 실패 시 pywin32 설치 확인: `pip install pywin32`

- [ ] **Step 3: win32crypt import 추가**

`interface_teacher.py` 12번째 줄 `import win32com.client` 바로 아래에 추가:

```python
import win32crypt
```

- [ ] **Step 4: PASSWORD_FILE 경로 변경**

현재 (약 52번째 줄):
```python
PASSWORD_FILE = os.path.join(APPLICATION_PATH, "password.txt")
```

변경 후:
```python
PASSWORD_FILE = os.path.join(APPLICATION_PATH, "password.bin")
```

- [ ] **Step 5: on_password_change() 암호화 저장으로 교체**

Task 1에서 수정한 `on_password_change()` 전체를 아래로 교체:

```python
    def on_password_change(self, *args):
        pw = self.password_var.get()
        config.user_password = pw
        try:
            encrypted = win32crypt.CryptProtectData(pw.encode('utf-8'))
            with open(PASSWORD_FILE, "wb") as f:
                f.write(encrypted)
        except Exception as e:
            logger.warning(f"비밀번호 저장 실패: {e}")
```

- [ ] **Step 6: load_data() 비밀번호 블록을 마이그레이션 + 복호화로 교체**

Task 1에서 수정한 비밀번호 블록 전체를 아래로 교체:

```python
        # 구 파일(password.txt) 마이그레이션
        old_password_file = os.path.join(APPLICATION_PATH, "password.txt")
        if os.path.exists(old_password_file):
            try:
                with open(old_password_file, 'r', encoding='utf-8') as f:
                    plain = f.read().strip()
                self.password_var.set(plain)  # on_password_change 트리거 → password.bin 암호화 저장
                os.remove(old_password_file)
                logger.info("password.txt → password.bin 마이그레이션 완료")
            except Exception as e:
                logger.warning(f"비밀번호 마이그레이션 실패: {e}")
        elif os.path.exists(PASSWORD_FILE):
            try:
                with open(PASSWORD_FILE, 'rb') as f:
                    _, decrypted = win32crypt.CryptUnprotectData(f.read())
                    self.password_var.set(decrypted.decode('utf-8'))
            except Exception as e:
                logger.warning(f"비밀번호 불러오기 실패: {e}")
```

- [ ] **Step 7: 실행 확인**

```bash
python interface_teacher.py
```

- 비밀번호 입력 후 앱 종료 → `password.bin` 파일 생성 확인 (바이너리, 평문 없음)
- 재실행 시 비밀번호 자동 복원 확인
- 기존 `password.txt` 있으면 마이그레이션 후 삭제되는지 확인

- [ ] **Step 8: 커밋**

```bash
git add interface_teacher.py tests/test_password_crypto.py
git commit -m "fix: 비밀번호 DPAPI 암호화 저장 (password.txt → password.bin)"
```

---

### Task 3: 버튼 비활성화 (Race condition 방지)

**Files:**
- Modify: `interface_teacher.py`

- [ ] **Step 1: create_action_buttons()에 _action_buttons 리스트 초기화 추가**

현재 `create_action_buttons()` (약 254번째 줄):
```python
    def create_action_buttons(self):
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.grid(row=3, column=0, padx=20, pady=5, sticky="ew")
        btn_frame.grid_columnconfigure(0, weight=1)
        btn_frame.grid_columnconfigure(1, weight=1)
```

변경 후 (`self._action_buttons = []` 추가):
```python
    def create_action_buttons(self):
        self._action_buttons = []
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.grid(row=3, column=0, padx=20, pady=5, sticky="ew")
        btn_frame.grid_columnconfigure(0, weight=1)
        btn_frame.grid_columnconfigure(1, weight=1)
```

- [ ] **Step 2: add_btn() 호출 결과를 _action_buttons에 누적**

현재 버튼 생성 코드 (약 266번째 줄):
```python
        # 메인 버튼 (원스톱 자동화)
        self.add_btn(btn_frame, "🚀 원스톱 자동화 (다운+엑셀)", self.run_onestop_teacher, 0, 0, fg_color=highlight_color, hover_color=highlight_hover, colspan=2)

        # 기본 도구
        self.add_btn(btn_frame, "신고서만 다운로드", self.run_download_reports, 1, 0, fg_color=unified_color, hover_color=unified_hover)
        self.add_btn(btn_frame, "월별 출결만 다운로드", self.run_download_monthly, 1, 1, fg_color=unified_color, hover_color=unified_hover)

        self.add_btn(btn_frame, "엑셀 자동화만 실행", self.run_only_excel_macro, 2, 0, fg_color=unified_color, hover_color=unified_hover)
        self.add_btn(btn_frame, "나이스 접속", open_neis, 2, 1, fg_color=unified_color, hover_color=unified_hover)
```

변경 후 (`self._action_buttons.append(...)` 로 감싸기):
```python
        # 메인 버튼 (원스톱 자동화)
        self._action_buttons.append(self.add_btn(btn_frame, "🚀 원스톱 자동화 (다운+엑셀)", self.run_onestop_teacher, 0, 0, fg_color=highlight_color, hover_color=highlight_hover, colspan=2))

        # 기본 도구
        self._action_buttons.append(self.add_btn(btn_frame, "신고서만 다운로드", self.run_download_reports, 1, 0, fg_color=unified_color, hover_color=unified_hover))
        self._action_buttons.append(self.add_btn(btn_frame, "월별 출결만 다운로드", self.run_download_monthly, 1, 1, fg_color=unified_color, hover_color=unified_hover))

        self._action_buttons.append(self.add_btn(btn_frame, "엑셀 자동화만 실행", self.run_only_excel_macro, 2, 0, fg_color=unified_color, hover_color=unified_hover))
        self._action_buttons.append(self.add_btn(btn_frame, "나이스 접속", open_neis, 2, 1, fg_color=unified_color, hover_color=unified_hover))
```

- [ ] **Step 3: _set_buttons_state() 헬퍼 메서드 추가**

`run_worker()` 바로 위에 삽입:

```python
    def _set_buttons_state(self, state):
        for btn in self._action_buttons:
            btn.configure(state=state)
```

- [ ] **Step 4: run_worker() 버튼 비활성화 로직 추가**

현재 `run_worker()` (약 370번째 줄):
```python
    def run_worker(self, task_func, task_name):
        def wrapper():
            print(f"[시작] {task_name} 시작합니다...")
            try:
                task_func()
                print(f"[완료] {task_name} 완료되었습니다.")
                CTkMessagebox(title="완료", message=f"{task_name} 작업이 완료되었습니다!", icon="check")
            except Exception as e:
                print(f"[오류] {task_name} 실패: {e}")
                CTkMessagebox(title="오류", message=f"작업 중 오류가 발생했습니다.\n{e}", icon="cancel")
        thread = threading.Thread(target=wrapper, daemon=True)
        thread.start()
```

변경 후:
```python
    def run_worker(self, task_func, task_name):
        self._set_buttons_state("disabled")  # 메인 스레드에서 즉시 비활성화
        def wrapper():
            print(f"[시작] {task_name} 시작합니다...")
            try:
                task_func()
                print(f"[완료] {task_name} 완료되었습니다.")
                CTkMessagebox(title="완료", message=f"{task_name} 작업이 완료되었습니다!", icon="check")
            except Exception as e:
                print(f"[오류] {task_name} 실패: {e}")
                CTkMessagebox(title="오류", message=f"작업 중 오류가 발생했습니다.\n{e}", icon="cancel")
            finally:
                self.after(0, lambda: self._set_buttons_state("normal"))  # 메인 스레드로 복원 위임
        thread = threading.Thread(target=wrapper, daemon=True)
        thread.start()
```

- [ ] **Step 5: 실행 확인**

```bash
python interface_teacher.py
```

- 버튼 클릭 시 즉시 모든 버튼이 비활성화(회색)되는지 확인
- 작업 완료/오류 다이얼로그 닫으면 버튼 다시 활성화되는지 확인

- [ ] **Step 6: 커밋**

```bash
git add interface_teacher.py
git commit -m "fix: 작업 중 버튼 비활성화로 race condition 방지"
```
