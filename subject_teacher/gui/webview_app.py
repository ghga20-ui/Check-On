"""pywebview-based desktop window for subject_teacher."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import webview

from subject_teacher.gui.api import Api
from subject_teacher.gui import startup


def _apply_windows_icon(window, icon_path: Path) -> None:
    """Set the native icon on the UI thread, before the window is shown.

    pywebview's ``webview.start(icon=...)`` is GTK/QT-only, so on Windows the
    running app showed the default form icon in the taskbar. Cosmetic only —
    never let a failure here block startup.
    """
    try:
        from System.Drawing import Icon  # pythonnet, present on win32

        window.native.Icon = Icon(str(icon_path))
    except Exception:
        pass


def _html_url() -> str:
    # Dev override: point at the Vite dev server (`npm run dev`) for fast iteration.
    dev_url = os.environ.get("NEIS_UI_DEV_URL")
    if dev_url:
        return dev_url
    here = Path(__file__).resolve().parent
    dist_index = here.parent / "neis_attendance" / "dist" / "index.html"
    if not dist_index.exists():
        raise FileNotFoundError(
            "Desktop UI is not built. Run:\n"
            "  cd subject_teacher/neis_attendance && npm install && npm run build"
        )
    # A plain path (not file://) so webview.start(http_server=True) serves it over
    # localhost. WebView2 intermittently never runs the Vite module script from
    # file://, leaving a blank window.
    return str(dist_index.resolve())


def start() -> None:
    if sys.platform == "win32":
        # Give the process its own taskbar identity so Windows groups the app
        # under the 체크온 icon instead of the Python/host default.
        try:
            import ctypes

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("CheckOn.Desktop")
        except Exception:
            pass

    api = startup.smoke_api() if os.environ.get("CHECKON_SMOKE_REPORT") else Api()
    window = webview.create_window(
        title="체크온 · 교과 출결",
        url=_html_url(),
        js_api=api,
        width=1440,
        height=900,
        min_size=(1200, 800),
        background_color="#F2F2F7",
    )
    api.set_window(window)
    startup.log.info("window_created")
    startup.monitor(window)

    # Window / taskbar icon (체크온). pywebview has no per-tab favicon — a
    # chromeless window shows no HTML <link rel=icon> — so set the window icon
    # explicitly. The packaged EXE icon is set separately in the PyInstaller spec.
    here = Path(__file__).resolve().parent
    icon_path = here.parent / "neis_attendance" / "dist" / "favicon.ico"
    if not icon_path.exists():
        icon_path = here.parent / "neis_attendance" / "public" / "favicon.ico"
    if icon_path.exists() and sys.platform == "win32":
        # before_show runs synchronously on the WinForms UI thread. shown
        # handlers run on a worker and assigning Icon there can deadlock CLR.
        window.events.before_show += lambda: _apply_windows_icon(window, icon_path)
    try:
        if icon_path.exists():
            # GTK/QT path; ignored on Windows (handled via the shown event above).
            webview.start(debug=False, http_server=True, icon=str(icon_path))
        else:
            webview.start(debug=False, http_server=True)
    except TypeError:
        # Older pywebview without the `icon` parameter.
        webview.start(debug=False, http_server=True)
