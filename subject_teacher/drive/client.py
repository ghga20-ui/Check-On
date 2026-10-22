"""Google Drive appDataFolder JSON CRUD helpers."""
from __future__ import annotations

import io
import json
import ssl
from dataclasses import dataclass
from collections.abc import Callable
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

from subject_teacher.drive import crypto
from subject_teacher.drive.concurrency import DriveConflictError


@dataclass(frozen=True)
class JsonSnapshot:
    file_id: str | None
    etag: str | None
    data: dict[str, Any] | None


class PreconditionFailed(DriveConflictError):
    pass


def _is_transient_error(exc: Exception) -> bool:
    # A long-lived httplib2 keep-alive connection can go bad two ways:
    #  - the OS aborts a stale/idle socket  -> WinError 10053/10054
    #    (ConnectionAbortedError / ConnectionResetError, both ConnectionError),
    #  - a half-read response corrupts SSL record framing
    #    -> ssl.SSLError "wrong version number" / "bad record mac".
    # Both are recoverable by dropping the poisoned connection and retrying.
    if isinstance(exc, ConnectionError):
        return True
    if isinstance(exc, OSError) and getattr(exc, "winerror", None) in (10053, 10054):
        return True
    if isinstance(exc, ssl.SSLError):
        message = str(exc).lower()
        return (
            "wrong_version_number" in message
            or "wrong version number" in message
            or "decryption_failed_or_bad_record_mac" in message
            or "bad record mac" in message
            or "internal error" in message
        )
    return False


# Back-compat alias; older call sites / tests referenced the SSL-only name.
_is_transient_ssl_error = _is_transient_error


def _with_transient_retry(
    operation: Callable[[], Any],
    on_retry: Callable[[], None] | None = None,
    attempts: int = 3,
) -> Any:
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            return operation()
        except Exception as exc:
            if not _is_transient_error(exc):
                raise
            last_error = exc
            # Evict the poisoned connection so the next attempt dials a fresh
            # socket instead of reusing the dead one.
            if on_retry is not None:
                try:
                    on_retry()
                except Exception:
                    pass
    if last_error is not None:
        raise last_error
    return operation()


class DriveAppDataClient:
    """Thin wrapper around Drive v3 appDataFolder operations."""

    def __init__(self, credentials=None, service=None, sync_key: bytes | None = None):
        if service is None:
            if credentials is None:
                raise ValueError("either credentials or service must be provided")
            service = build("drive", "v3", credentials=credentials, cache_discovery=False)
        self._service = service
        self._sync_key = sync_key

    @property
    def encryption_enabled(self) -> bool:
        return self._sync_key is not None

    def _require_mixed_encryption(self, name: str, payload: dict) -> None:
        if name.startswith('homeroom-') and not self.encryption_enabled:
            raise ValueError('담임 출결은 암호화 연결이 필요합니다.')
        mixed = name == "mixed-groups.json" or (
            name.startswith("attendance-") and any(
                record.get("groupId") for day in payload.get("records", {}).values()
                for record in day.values()
            )
        )
        if mixed and not self.encryption_enabled:
            raise ValueError("이동수업은 설정에서 모바일 암호화 연결을 완료한 후 저장할 수 있습니다.")

    def _version_request(self, uri: str, method="GET", body=None, headers=None):
        # Drive v2 exposes a metadata ETag. v3 version numbers are not a CAS
        # precondition. Never replace this PUT with an unconditional v3 update.
        response, content = self._service._http.request(
            uri, method=method, body=body, headers=headers or {}
        )
        status = int(response.status)
        if status == 412:
            raise PreconditionFailed("다른 기기에서 기록이 변경됐습니다.")
        if status >= 400:
            from googleapiclient.errors import HttpError
            raise HttpError(response, content, uri=uri)
        return json.loads(content.decode("utf-8")) if content else {}

    def _unique_file_id(self, name: str) -> str | None:
        escaped = name.replace("\\", "\\\\").replace("'", "\\'")
        result = self._service.files().list(
            q=f"name = '{escaped}' and trashed = false",
            spaces="appDataFolder", fields="files(id),nextPageToken", pageSize=2,
        ).execute()
        files = result.get("files", [])
        if len(files) > 1 or result.get("nextPageToken"):
            # Concurrent first creation is not atomic by name in Drive. Keep
            # both originals and stop rather than arbitrarily hiding one.
            raise DriveConflictError(
                "같은 월의 출결 파일이 여러 개 있습니다. 원본은 보존했습니다. "
                "파일을 통합하기 전에는 저장과 자동 반영을 진행할 수 없습니다."
            )
        return files[0]["id"] if files else None

    def read_snapshot(self, name: str) -> JsonSnapshot:
        for _ in range(4):
            file_id = self._unique_file_id(name)
            if file_id is None:
                return JsonSnapshot(None, None, None)
            uri = f"https://www.googleapis.com/drive/v2/files/{file_id}?fields=id,etag"
            before = self._version_request(uri).get("etag")
            if not before:
                raise DriveConflictError("Drive 기록 버전을 확인할 수 없어 저장을 중단했습니다.")
            raw = self._version_request(
                f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
            )
            after = self._version_request(uri).get("etag")
            if before != after:
                continue
            if crypto.is_envelope(raw):
                if self._sync_key is None:
                    raise crypto.SyncKeyMissingError(name)
                raw = crypto.decrypt_envelope(name, raw, self._sync_key)
            elif name == "mixed-groups.json" or name.startswith("homeroom-"):
                raise ValueError("기록 파일이 암호화되지 않았습니다. 연결 암호화를 확인해 주세요.")
            return JsonSnapshot(file_id, before, raw)
        raise DriveConflictError("다른 기기에서 저장 중입니다. 잠시 후 다시 불러와 주세요.")

    def write_snapshot(self, name: str, payload: dict, snapshot: JsonSnapshot) -> str:
        self._require_mixed_encryption(name, payload)
        if snapshot.file_id is None:
            # Recheck before creating; never update a newly discovered file.
            if self._unique_file_id(name) is not None:
                raise PreconditionFailed("다른 기기에서 이 달의 기록을 만들었습니다.")
            data = crypto.encrypt_envelope(name, payload, self._sync_key) if self._sync_key else payload
            media = MediaIoBaseUpload(io.BytesIO(json.dumps(data, ensure_ascii=False).encode()),
                                     mimetype="application/json", resumable=False)
            result = self._service.files().create(
                body={"name": name, "parents": ["appDataFolder"]},
                media_body=media, fields="id",
            ).execute()
            self._unique_file_id(name)  # Detect simultaneous first creation.
            return result["id"]
        if not snapshot.etag:
            raise DriveConflictError("기록 버전이 없어 저장하지 않았습니다.")
        data = crypto.encrypt_envelope(name, payload, self._sync_key) if self._sync_key else payload
        self._version_request(
            f"https://www.googleapis.com/upload/drive/v2/files/{snapshot.file_id}?uploadType=media",
            method="PUT", body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
            headers={"If-Match": snapshot.etag, "Content-Type": "application/json"},
        )
        return snapshot.file_id

    def _reset_connections(self) -> None:
        """Close and evict cached httplib2 keep-alive connections.

        googleapiclient holds the transport at ``service._http``; when built
        with credentials that is a ``google_auth_httplib2.AuthorizedHttp`` whose
        wrapped ``httplib2.Http`` lives at ``.http`` and caches live sockets in
        ``.connections``. Dropping them forces the next request to redial.
        Best-effort: silently no-op if the shape differs.
        """
        http = getattr(self._service, "_http", None)
        inner = getattr(http, "http", http)
        conns = getattr(inner, "connections", None)
        if not isinstance(conns, dict):
            return
        for conn in list(conns.values()):
            try:
                conn.close()
            except Exception:
                pass
        conns.clear()

    def find_file_id(self, name: str) -> str | None:
        response = _with_transient_retry(
            lambda: self._service.files()
            .list(
                    q=f"name = '{name}' and 'appDataFolder' in parents and trashed = false",
                    spaces="appDataFolder",
                    fields="files(id, name)",
                    pageSize=10,
                )
            .execute(),
            on_retry=self._reset_connections,
        )
        files = response.get("files", [])
        return files[0]["id"] if files else None

    def read_json(self, name: str) -> dict[str, Any] | None:
        """Read a JSON file, transparently decrypting E2E envelopes."""
        raw = self.read_json_raw(name)
        if raw is None or not crypto.is_envelope(raw):
            return raw
        if self._sync_key is None:
            raise crypto.SyncKeyMissingError(name)
        return crypto.decrypt_envelope(name, raw, self._sync_key)

    def read_json_raw(self, name: str) -> dict[str, Any] | None:
        """Read a JSON file as stored, without decrypting envelopes."""
        file_id = self.find_file_id(name)
        if file_id is None:
            return None

        request = self._service.files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = _with_transient_retry(
                lambda: downloader.next_chunk(),
                on_retry=self._reset_connections,
            )
        return json.loads(buffer.getvalue().decode("utf-8"))

    def upsert_json(self, name: str, payload: dict[str, Any]) -> str:
        self._require_mixed_encryption(name, payload)
        if self._sync_key is not None:
            payload = crypto.encrypt_envelope(name, payload, self._sync_key)
        media = MediaIoBaseUpload(
            io.BytesIO(json.dumps(payload, ensure_ascii=False).encode("utf-8")),
            mimetype="application/json",
            resumable=False,
        )
        file_id = self.find_file_id(name)
        if file_id is None:
            response = _with_transient_retry(
                lambda: self._service.files()
                .create(
                        body={"name": name, "parents": ["appDataFolder"]},
                        media_body=media,
                        fields="id",
                    )
                .execute(),
                on_retry=self._reset_connections,
            )
            return response["id"]

        _with_transient_retry(
            lambda: self._service.files().update(fileId=file_id, media_body=media, fields="id").execute(),
            on_retry=self._reset_connections,
        )
        return file_id

    def delete(self, name: str) -> bool:
        file_id = self.find_file_id(name)
        if file_id is None:
            return False
        _with_transient_retry(
            lambda: self._service.files().delete(fileId=file_id).execute(),
            on_retry=self._reset_connections,
        )
        return True

    def list_files(self) -> list[str]:
        names, page_token = [], None
        while True:
            response = _with_transient_retry(
                lambda: self._service.files().list(
                    spaces="appDataFolder", fields="nextPageToken,files(id,name)",
                    pageSize=100, pageToken=page_token,
                ).execute(), on_retry=self._reset_connections,
            )
            names.extend(item["name"] for item in response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                return names
