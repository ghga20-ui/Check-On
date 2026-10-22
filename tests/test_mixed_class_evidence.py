"""Read-only manual release gate. Never manufacture evidence from synthetic tests."""
import json
import os
from pathlib import Path

import pytest


@pytest.mark.skipif(os.environ.get("CHECKON_VERIFY_LIVE") != "1",
                    reason="실제 기기·NEIS 확인 후 CHECKON_VERIFY_LIVE=1로 별도 실행")
def test_manual_mixed_class_acceptance_evidence():
    path = Path(__file__).resolve().parents[1] / "subject_teacher/docs/2026-09-10-mixed-class-validation.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["status"] == "pass", "실제 연동 검증이 아직 완료되지 않았습니다."
    assert all(data.get(field) for field in ("checkedAt", "desktopVersion", "mobileVersion"))
    for name in ("distinctStudents", "reload", "filterPersistence", "neisSavedRows", "idempotency", "legacyClass"):
        assert data["checks"][name]["passed"] is True
        assert data["checks"][name]["evidence"].strip()
