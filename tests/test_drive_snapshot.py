import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from subject_teacher.drive.client import DriveAppDataClient, JsonSnapshot, PreconditionFailed
from subject_teacher.drive.concurrency import DriveConflictError
from subject_teacher.drive import crypto


def client_with_responses(responses):
    service = MagicMock()
    service.files.return_value.list.return_value.execute.return_value = {"files": [{"id": "f"}]}
    service._http.request.side_effect = [(SimpleNamespace(status=status), json.dumps(body).encode())
                                        for status, body in responses]
    return DriveAppDataClient(service=service), service


def test_snapshot_retries_when_version_changes_during_content_read():
    client, service = client_with_responses([
        (200, {"etag": '"v1"'}), (200, {"value": "old"}), (200, {"etag": '"v2"'}),
        (200, {"etag": '"v2"'}), (200, {"value": "new"}), (200, {"etag": '"v2"'}),
    ])
    snapshot = client.read_snapshot("attendance-2026-09.json")
    assert snapshot.etag == '"v2"'
    assert snapshot.data == {"value": "new"}


def test_conditional_upload_uses_metadata_etag_and_keeps_encryption():
    client, service = client_with_responses([(200, {"id": "f"})])
    client._sync_key = bytes(range(32))
    name = "attendance-2026-09.json"
    client.write_snapshot(name, {"value": 1}, JsonSnapshot("f", '"v7"', {}))
    args, kwargs = service._http.request.call_args
    assert args[0] == "https://www.googleapis.com/upload/drive/v2/files/f?uploadType=media"
    assert kwargs["method"] == "PUT"
    assert kwargs["headers"]["If-Match"] == '"v7"'
    envelope = json.loads(kwargs["body"])
    assert crypto.decrypt_envelope(name, envelope, client._sync_key) == {"value": 1}
    service.files.return_value.update.assert_not_called()


def test_412_never_falls_back_to_unconditional_update():
    client, service = client_with_responses([(412, {})])
    with pytest.raises(PreconditionFailed):
        client.write_snapshot("attendance-2026-09.json", {}, JsonSnapshot("f", '"old"', {}))
    assert service._http.request.call_count == 1
    service.files.return_value.update.assert_not_called()


def test_duplicate_months_are_preserved_and_never_arbitrarily_selected():
    client, service = client_with_responses([])
    service.files.return_value.list.return_value.execute.return_value = {"files": [{"id": "a"}, {"id": "b"}]}
    with pytest.raises(DriveConflictError, match="여러"):
        client.read_snapshot("attendance-2026-09.json")
    service.files.return_value.delete.assert_not_called()
    service._http.request.assert_not_called()


def test_simultaneous_first_creation_is_reported_without_overwrite():
    client, service = client_with_responses([])
    with pytest.raises(PreconditionFailed):
        client.write_snapshot("attendance-2026-09.json", {}, JsonSnapshot(None, None, None))
    service.files.return_value.create.assert_not_called()
    service.files.return_value.update.assert_not_called()


def test_no_etag_means_no_write():
    client, service = client_with_responses([])
    with pytest.raises(DriveConflictError):
        client.write_snapshot("attendance-2026-09.json", {}, JsonSnapshot("f", None, {}))
    service._http.request.assert_not_called()
