from unittest.mock import MagicMock

from subject_teacher.gui import webview_app


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self


def test_icon_is_set_on_synchronous_before_show_not_worker_shown(monkeypatch):
    window = MagicMock()
    window.events.before_show = Event()
    window.events.shown = Event()
    monkeypatch.setattr(webview_app.webview, "create_window", lambda **kwargs: window)
    monkeypatch.setattr(webview_app.webview, "start", lambda **kwargs: None)
    monkeypatch.setattr(webview_app.startup, "monitor", lambda window: None)
    monkeypatch.setattr(webview_app.Path, "exists", lambda path: True)
    monkeypatch.setattr(webview_app, "_html_url", lambda: "file:///test/index.html")
    monkeypatch.setattr(webview_app.sys, "platform", "win32")
    apply_icon = MagicMock()
    monkeypatch.setattr(webview_app, "_apply_windows_icon", apply_icon)
    webview_app.start()
    assert len(window.events.before_show.handlers) == 1
    assert not window.events.shown.handlers
    window.events.before_show.handlers[0]()
    apply_icon.assert_called_once()


def test_smoke_api_never_connects_to_google(monkeypatch):
    from subject_teacher.gui import startup
    api = startup.smoke_api()
    assert api.startup_probe()["app"] == "CheckOn"
    assert api.get_drive_user() == "{}"
    assert api.get_password() == ""
    assert "error" in api.get_settings()
