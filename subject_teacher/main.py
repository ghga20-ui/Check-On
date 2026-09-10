from __future__ import annotations

import sys


def _enable_per_monitor_v2_dpi() -> None:
    """Opt into Per-Monitor-V2 DPI awareness before the window is created (Windows only).

    Reduces the transient blur seen when the window is shown or regains focus —
    Windows shows a scaled cached frame until WebView2 re-rasterizes. Best-effort:
    no-op on non-Windows / older Windows, or if a DPI context was already set.
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes

        user32 = ctypes.windll.user32
        user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        user32.SetProcessDpiAwarenessContext.restype = ctypes.c_bool
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        pass


def main() -> None:
    from subject_teacher.gui import startup
    startup.configure()
    try:
        from subject_teacher.gui.webview_app import start
        _enable_per_monitor_v2_dpi()
        start()
    except Exception as exc:
        startup.report_failure(exc)
        raise


if __name__ == "__main__":
    main()
