"""Schema migration registry for Drive-backed JSON files."""
from __future__ import annotations

from typing import Callable

from subject_teacher.drive.schemas import SCHEMA_VERSION


class UnsupportedSchemaVersionError(RuntimeError):
    """Raised when a file schema version cannot be handled by this app."""


Upgrader = Callable[[dict], dict]
_UPGRADERS: dict[int, Upgrader] = {}


def register_upgrader(
    from_version: int,
    fn: Upgrader | None = None,
) -> Upgrader | Callable[[Upgrader], Upgrader]:
    """Register an upgrader from one schema version to the next."""

    def _register(func: Upgrader) -> Upgrader:
        _UPGRADERS[from_version] = func
        return func

    if fn is not None:
        return _register(fn)
    return _register


def migrate(data: dict) -> dict:
    """Migrate raw schema data up to the current schema version."""
    version = data.get("schemaVersion", SCHEMA_VERSION)
    # v2 is an explicit monthly attendance contract, not a rewrite of legacy files.
    if version == 2 and "month" in data and "records" in data:
        return dict(data)
    if version > SCHEMA_VERSION:
        raise UnsupportedSchemaVersionError(
            f"file was written by a newer app (v{version} > v{SCHEMA_VERSION})"
        )

    upgraded = dict(data)
    while version < SCHEMA_VERSION:
        upgrader = _UPGRADERS.get(version)
        if upgrader is None:
            raise UnsupportedSchemaVersionError(f"no upgrader registered for v{version}")
        upgraded = upgrader(upgraded)
        version += 1

    upgraded["schemaVersion"] = SCHEMA_VERSION
    return upgraded
