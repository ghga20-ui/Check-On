# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import json

from PyInstaller.utils.hooks import collect_submodules


ROOT = Path(SPECPATH)

datas = [
    # Ship only the built Vite UI, not node_modules/src.
    (
        str(ROOT / "subject_teacher" / "neis_attendance" / "dist"),
        "subject_teacher/neis_attendance/dist",
    ),
]

# Bundle the installed-app OAuth client if present (gitignored, so builds on a
# machine without it still succeed — the app then reads it from %LOCALAPPDATA%).
# Resolved at runtime via paths.get_client_secrets_path() from sys._MEIPASS.
_client_secrets = ROOT / "client_secrets.json"
if _client_secrets.exists():
    _oauth_config = json.loads(_client_secrets.read_text(encoding="utf-8-sig"))
    if "web" in _oauth_config or not isinstance(_oauth_config.get("installed"), dict):
        raise ValueError("Only installed-app OAuth configuration may be bundled; web secrets are forbidden.")
    datas.append((str(_client_secrets), "."))

hiddenimports = [
    "clr_loader",
    "googleapiclient.discovery",
    "googleapiclient.http",
    "google_auth_oauthlib.flow",
    "pythonnet",
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "win32timezone",
]

# selenium 4.42+ resolves webdriver.Chrome via PEP 562 lazy imports
# (importlib.import_module in selenium/webdriver/__init__.py), which
# PyInstaller's static analysis cannot follow — without this the EXE dies
# with "No module named 'selenium.webdriver.chrome.webdriver'".
hiddenimports += collect_submodules("selenium.webdriver")

a = Analysis(
    ["subject_teacher/main.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="NEIS_Subject_Teacher",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "installer" / "checkon.ico"),
)
