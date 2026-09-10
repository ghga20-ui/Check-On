"""Startup diagnostics and an isolated, real-WebView smoke check."""
from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import threading

from subject_teacher.paths import get_app_data_dir

log = logging.getLogger("checkon.startup")


def configure() -> None:
    if log.handlers:
        return
    handler = RotatingFileHandler(get_app_data_dir() / "startup.log", maxBytes=256_000,
                                  backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.info("process_started")


def report_failure(error: BaseException) -> None:
    # Only stage/type are recorded; do not log credentials or page contents.
    log.error("startup_failed type=%s", type(error).__name__)
    if os.name == "nt" and not os.environ.get("CHECKON_SMOKE_REPORT"):
        import ctypes
        ctypes.windll.user32.MessageBoxW(None,
            "체크온 화면을 준비하지 못했습니다. 프로그램을 다시 실행해 주세요.\n"
            f"진단 기록: {get_app_data_dir() / 'startup.log'}", "체크온 시작 오류", 16)


def monitor(window) -> None:
    ready = threading.Event()
    report = os.environ.get("CHECKON_SMOKE_REPORT")

    def finish(ok: bool, stage: str) -> None:
        log.info("%s", stage)
        if report:
            path = Path(report)
            tmp = path.with_suffix(".pending")
            tmp.write_text(json.dumps({"ok": ok, "stage": stage, "pid": os.getpid()}), encoding="utf-8")
            tmp.replace(path)

    def verify() -> None:
        log.info("html_loaded")
        try:
            answered = threading.Event()
            answer = []
            def receive(value):
                answer.append(value)
                answered.set()
            window.evaluate_js("""
                new Promise((resolve) => {
                  const deadline = Date.now() + 20000;
                  const poll = () => {
                    if (window.pywebview?.api?.startup_probe && document.getElementById('root')?.children.length) {
                      window.pywebview.api.startup_probe().then(p => resolve(p.app === 'CheckOn')).catch(() => resolve(false));
                    } else if (Date.now() >= deadline) resolve(false);
                    else setTimeout(poll, 50);
                  }; poll();
                })
            """, callback=receive)
            if not answered.wait(25) or answer != [True]:
                raise RuntimeError("bridge_not_ready")
            ready.set()
            finish(True, "ui_and_python_ready")
            if report:
                window.destroy()
        except Exception as exc:
            ready.set()
            finish(False, "bridge_check_failed")
            report_failure(exc)
            if report:
                os._exit(2)

    def watchdog() -> None:
        if not ready.wait(40):
            finish(False, "startup_timeout")
            if report:
                os._exit(2)
            report_failure(TimeoutError())

    window.events.loaded += verify
    window.events.closed += lambda: ready.set()
    threading.Thread(target=watchdog, daemon=True, name="checkon-startup-watchdog").start()


def smoke_api():
    from subject_teacher.gui.api import Api

    class SmokeApi(Api):
        """Real bridge with cloud access disabled. No sample students or secrets."""
        def _store(self):
            raise RuntimeError("시작 검사: 계정 연결 없음")

        def get_drive_user(self):
            return "{}"

        def get_password(self):
            return ""

        def get_neis_api_key(self):
            return ""

    return SmokeApi()
