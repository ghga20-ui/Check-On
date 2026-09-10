"""Build and verify exactly the EXE passed to Inno Setup. No publishing.

Run from the repository root:
    py -3.14 -m subject_teacher.scripts.build_release
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from subject_teacher.version import VERSION

ROOT = Path(__file__).resolve().parents[2]


def run(command, cwd=ROOT):
    subprocess.run(command, cwd=cwd, check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    compiler = shutil.which("ISCC.exe")
    if not compiler:
        for folder in (Path(os.environ.get("LOCALAPPDATA", "")) / "Programs",
                       Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)"))):
            candidate = folder / "Inno Setup 6" / "ISCC.exe"
            if candidate.is_file():
                compiler = str(candidate)
                break
    if not npm or not compiler:
        raise SystemExit("Node.js/npm과 Inno Setup 6이 필요합니다.")
    run([sys.executable, "-m", "pytest", "tests/", "-q"])
    for relative in ("subject_teacher/neis_attendance", "subject_teacher_pwa"):
        run([npm, "test"], ROOT / relative)
        run([npm, "run", "build"], ROOT / relative)
    run([sys.executable, "-m", "subject_teacher.scripts.check_desktop_startup"])
    dist = ROOT / "dist" / "checkon_build"
    run([sys.executable, "-m", "PyInstaller", "NEIS_Subject_Teacher.spec", "--noconfirm",
         "--clean", "--distpath", str(dist)])
    exe = dist / "NEIS_Subject_Teacher.exe"
    run([sys.executable, "-m", "subject_teacher.scripts.check_desktop_startup", "--exe", str(exe)])
    exe_hash = digest(exe)
    output = ROOT / "dist" / "installer"
    run([compiler, f"/DAppVersion={VERSION}", f"/DSourceExe={exe}", f"/DOutputDir={output}",
         str(ROOT / "installer" / "checkon.iss")])
    if digest(exe) != exe_hash:
        raise SystemExit("검증 후 실행 파일이 변경됐습니다. 배포를 중단합니다.")
    installer = output / f"CheckOn-Setup-{VERSION}.exe"
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    manifest = {"version": VERSION, "commit": commit,
                "workingTreeModified": bool(subprocess.check_output(
                    ["git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
                "exeSha256": exe_hash, "installerSha256": digest(installer),
                "startupCheck": "ui_and_python_ready", "published": False}
    (output / f"CheckOn-{VERSION}-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"검증된 설치본: {installer}")


if __name__ == "__main__":
    main()
