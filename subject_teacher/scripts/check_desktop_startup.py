"""Run the real built UI and Python bridge in a fresh, cloud-free profile.

Usage: py -3.14 -m subject_teacher.scripts.check_desktop_startup [--exe PATH]
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", type=Path)
    args = parser.parse_args()
    if args.exe and not args.exe.is_file():
        parser.error("실행 파일이 없습니다.")
    command = [str(args.exe.resolve())] if args.exe else [sys.executable, "-m", "subject_teacher.main"]
    with tempfile.TemporaryDirectory(prefix="checkon-startup-") as folder:
        report = Path(folder) / "result.json"
        env = dict(os.environ, LOCALAPPDATA=folder, CHECKON_SMOKE_REPORT=str(report))
        env.pop("NEIS_UI_DEV_URL", None)
        # A visible actual window is needed to exercise WinForms initialization.
        proc = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 75
            while time.monotonic() < deadline and not report.exists():
                if proc.poll() is not None:
                    break
                time.sleep(.2)
            result = json.loads(report.read_text()) if report.exists() else {"ok": False, "stage": "no_ready_report"}
            print(json.dumps(result))
            if not result["ok"]:
                raise SystemExit(1)
            try:
                # pythonnet unloads the CLR at exit, which alone can take ~10s.
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                raise SystemExit("창 종료 실패")
            if proc.returncode != 0:
                raise SystemExit(f"시작 검사 프로세스 오류: {proc.returncode}")
        finally:
            if proc.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
                else:
                    proc.kill()
                proc.wait(timeout=10)


if __name__ == "__main__":
    main()
