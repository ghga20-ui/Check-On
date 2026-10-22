import base64
import json as json_module
import ssl
from unittest.mock import MagicMock

import pytest

from subject_teacher.drive import crypto as drive_crypto
from subject_teacher.drive.client import DriveAppDataClient

E2E_KEY = bytes(range(32))


def test_list_files_follows_all_pages():
    service = MagicMock()
    service.files.return_value.list.return_value.execute.side_effect = [
        {"files":[{"name":"attendance-2025-01.json"}], "nextPageToken":"page2"},
        {"files":[{"name":"attendance-2026-09.json"}]},
    ]
    assert DriveAppDataClient(service=service).list_files() == ["attendance-2025-01.json", "attendance-2026-09.json"]
    assert service.files.return_value.list.call_args.kwargs["pageToken"] == "page2"


def mock_files(list_result: list[dict]):
    files = MagicMock()
    files.list.return_value.execute.return_value = {"files": list_result}
    return files


def test_find_file_id_returns_none_when_absent():
    service = MagicMock()
    service.files.return_value = mock_files([])

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") is None
    service.files.return_value.list.assert_called_once()


def test_find_file_id_returns_id_when_present():
    service = MagicMock()
    service.files.return_value = mock_files([{"id": "abc123", "name": "settings.json"}])

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"


def test_find_file_id_retries_transient_ssl_wrong_version():
    execute = MagicMock(side_effect=[
        ssl.SSLError("[SSL: WRONG_VERSION_NUMBER] wrong version number"),
        {"files": [{"id": "abc123", "name": "settings.json"}]},
    ])
    service = MagicMock()
    service.files.return_value.list.return_value.execute = execute

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"
    assert execute.call_count == 2


def test_find_file_id_retries_transient_ssl_bad_record_mac():
    execute = MagicMock(side_effect=[
        ssl.SSLError("[SSL: DECRYPTION_FAILED_OR_BAD_RECORD_MAC] decryption failed or bad record mac"),
        {"files": [{"id": "abc123", "name": "settings.json"}]},
    ])
    service = MagicMock()
    service.files.return_value.list.return_value.execute = execute

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"
    assert execute.call_count == 2


def test_find_file_id_retries_transient_ssl_internal_error():
    # "[SSL] internal error" is another poisoned-keep-alive symptom (seen when a
    # second thread raced the shared httplib2 connection). Retry on a fresh socket.
    execute = MagicMock(side_effect=[
        ssl.SSLError("[SSL] internal error (_ssl.c:2710)"),
        {"files": [{"id": "abc123", "name": "settings.json"}]},
    ])
    service = MagicMock()
    service.files.return_value.list.return_value.execute = execute

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"
    assert execute.call_count == 2


def test_find_file_id_retries_connection_aborted_10053():
    # WinError 10053 (WSAECONNABORTED): the OS aborted a stale keep-alive socket.
    # Must be treated as transient and retried, not surfaced to the user.
    execute = MagicMock(side_effect=[
        ConnectionAbortedError(10053, "An established connection was aborted by the software in your host machine"),
        {"files": [{"id": "abc123", "name": "settings.json"}]},
    ])
    service = MagicMock()
    service.files.return_value.list.return_value.execute = execute

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"
    assert execute.call_count == 2


def test_find_file_id_retries_connection_reset_10054():
    execute = MagicMock(side_effect=[
        ConnectionResetError(10054, "An existing connection was forcibly closed by the remote host"),
        {"files": [{"id": "abc123", "name": "settings.json"}]},
    ])
    service = MagicMock()
    service.files.return_value.list.return_value.execute = execute

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"
    assert execute.call_count == 2


def test_transient_error_drops_poisoned_connection_before_retry():
    # A poisoned keep-alive connection must be closed and evicted before the
    # retry, otherwise httplib2 reuses the dead socket and the retry fails too.
    execute = MagicMock(side_effect=[
        ssl.SSLError("[SSL: WRONG_VERSION_NUMBER] wrong version number"),
        {"files": [{"id": "abc123", "name": "settings.json"}]},
    ])
    service = MagicMock()
    service.files.return_value.list.return_value.execute = execute
    # httplib2 caches live connections at service._http.http.connections.
    conn = MagicMock()
    service._http.http.connections = {"https:drive.googleapis.com": conn}

    client = DriveAppDataClient(service=service)

    assert client.find_file_id("settings.json") == "abc123"
    conn.close.assert_called_once()
    assert service._http.http.connections == {}


def test_upsert_json_encrypts_when_key_present():
    service = MagicMock()
    service.files.return_value.list.return_value.execute.return_value = {"files": []}
    service.files.return_value.create.return_value.execute.return_value = {"id": "new123"}

    client = DriveAppDataClient(service=service, sync_key=E2E_KEY)
    client.upsert_json("settings.json", {"schemaVersion": 1})

    media = service.files.return_value.create.call_args.kwargs["media_body"]
    stored = json_module.loads(media._fd.getvalue().decode("utf-8"))
    assert drive_crypto.is_envelope(stored)
    assert drive_crypto.decrypt_envelope("settings.json", stored, E2E_KEY) == {"schemaVersion": 1}


def test_upsert_json_stays_plaintext_without_key():
    service = MagicMock()
    service.files.return_value.list.return_value.execute.return_value = {"files": []}
    service.files.return_value.create.return_value.execute.return_value = {"id": "new123"}

    client = DriveAppDataClient(service=service)
    client.upsert_json("settings.json", {"schemaVersion": 1})

    media = service.files.return_value.create.call_args.kwargs["media_body"]
    stored = json_module.loads(media._fd.getvalue().decode("utf-8"))
    assert stored == {"schemaVersion": 1}


def test_read_json_decrypts_envelope(monkeypatch):
    envelope = drive_crypto.encrypt_envelope("settings.json", {"schemaVersion": 1}, E2E_KEY)
    client = DriveAppDataClient(service=MagicMock(), sync_key=E2E_KEY)
    monkeypatch.setattr(client, "read_json_raw", lambda name: envelope)
    assert client.read_json("settings.json") == {"schemaVersion": 1}


def test_read_json_passes_legacy_plaintext(monkeypatch):
    client = DriveAppDataClient(service=MagicMock(), sync_key=E2E_KEY)
    monkeypatch.setattr(client, "read_json_raw", lambda name: {"schemaVersion": 1})
    assert client.read_json("settings.json") == {"schemaVersion": 1}


def test_read_json_envelope_without_key_raises(monkeypatch):
    envelope = drive_crypto.encrypt_envelope("settings.json", {"schemaVersion": 1}, E2E_KEY)
    client = DriveAppDataClient(service=MagicMock())
    monkeypatch.setattr(client, "read_json_raw", lambda name: envelope)
    with pytest.raises(drive_crypto.SyncKeyMissingError):
        client.read_json("settings.json")


def test_upsert_json_creates_when_absent():
    service = MagicMock()
    service.files.return_value.list.return_value.execute.return_value = {"files": []}
    service.files.return_value.create.return_value.execute.return_value = {"id": "new123"}

    client = DriveAppDataClient(service=service)
    file_id = client.upsert_json("settings.json", {"schemaVersion": 1})

    assert file_id == "new123"
    service.files.return_value.create.assert_called_once()


def test_upsert_json_updates_when_present():
    service = MagicMock()
    service.files.return_value.list.return_value.execute.return_value = {
        "files": [{"id": "existing", "name": "settings.json"}]
    }
    service.files.return_value.update.return_value.execute.return_value = {"id": "existing"}

    client = DriveAppDataClient(service=service)
    file_id = client.upsert_json("settings.json", {"schemaVersion": 1})

    assert file_id == "existing"
    service.files.return_value.update.assert_called_once()
    service.files.return_value.create.assert_not_called()
