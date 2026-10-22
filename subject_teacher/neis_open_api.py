"""NEIS public Open API helpers for class timetable previews."""
from __future__ import annotations

import json
import re
import threading
import unicodedata
from datetime import date as date_type, timedelta
from difflib import SequenceMatcher
from typing import Any, Callable
from urllib.request import Request, urlopen

# NEIS is usually fast (<1s) when healthy; a long timeout only lets a degraded
# endpoint block the caller. Kept modest so retries/parallel fan-out stay bounded.
_REQUEST_TIMEOUT = 8.0

# Guards first-time school resolution when a shared school_cache is populated
# from several worker threads (see query_class_timetable).
_SCHOOL_CACHE_LOCK = threading.Lock()


class NeisOpenApiError(RuntimeError):
    """Raised when the NEIS public API cannot provide a usable preview."""


REGION_TO_ATPT_CODE = {
    "서울": "B10",
    "부산": "C10",
    "대구": "D10",
    "인천": "E10",
    "광주": "F10",
    "대전": "G10",
    "울산": "H10",
    "세종": "I10",
    "경기": "J10",
    "강원": "K10",
    "충북": "M10",
    "충남": "N10",
    "전북": "P10",
    "전남": "Q10",
    "경북": "R10",
    "경남": "S10",
    "제주": "T10",
}

SCHOOL_KIND_TO_TIMETABLE_ENDPOINT = {
    "초등학교": "elsTimetable",
    "중학교": "misTimetable",
    "고등학교": "hisTimetable",
    "특수학교": "spsTimetable",
}

WEEKDAY_TO_KO = ["월", "화", "수", "목", "금", "토", "일"]
ROMAN_TO_ARABIC = str.maketrans({
    "Ⅰ": "1",
    "Ⅱ": "2",
    "Ⅲ": "3",
    "Ⅳ": "4",
    "Ⅴ": "5",
    "Ⅵ": "6",
    "Ⅶ": "7",
    "Ⅷ": "8",
    "Ⅸ": "9",
    "Ⅹ": "10",
})


def _fetch_json(endpoint: str, params: dict[str, object]) -> dict[str, Any]:
    # The operator's key stays on the server. Never transmit legacy local keys.
    body = json.dumps({"endpoint": endpoint, "params": {
        key: value for key, value in params.items() if key != "KEY" and value not in (None, "")
    }}).encode("utf-8")
    request = Request("https://subjectteacherpwa.vercel.app/api/neis", data=body,
                      headers={"Content-Type": "application/json"}, method="POST")
    for attempt in range(2):
        try:
            with urlopen(request, timeout=_REQUEST_TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if attempt == 1:
                raise NeisOpenApiError("시간표 조회에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.") from None
    raise NeisOpenApiError("시간표 조회에 연결하지 못했습니다.")


def _rows_from_payload(payload: dict[str, Any], root_key: str) -> list[dict[str, Any]]:
    container = payload.get(root_key)
    if not isinstance(container, list):
        result = payload.get("RESULT")
        if isinstance(result, dict):
            if result.get("CODE") == "INFO-200":
                return []
            message = result.get("MESSAGE") or result.get("CODE") or "NEIS Open API returned no rows"
            raise NeisOpenApiError(str(message))
        return []
    for part in container:
        rows = part.get("row") if isinstance(part, dict) else None
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def _parse_date(date_str: str) -> date_type:
    try:
        return date_type.fromisoformat(date_str)
    except ValueError as exc:
        raise NeisOpenApiError("날짜는 YYYY-MM-DD 형식이어야 합니다.") from exc


def normalize_subject_name(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.upper().translate(ROMAN_TO_ARABIC)
    for roman, arabic in (
        ("VIII", "8"),
        ("VII", "7"),
        ("VI", "6"),
        ("IV", "4"),
        ("III", "3"),
        ("II", "2"),
        ("IX", "9"),
        ("X", "10"),
        ("V", "5"),
        ("I", "1"),
    ):
        text = text.replace(roman, arabic)
    return re.sub(r"[\s\-_()·.,]", "", text)


def subject_matches(actual: str, expected: list[str], aliases: list[str] | None = None) -> bool:
    actual_norm = normalize_subject_name(actual)
    candidates = [*expected, *(aliases or [])]
    return any(actual_norm == normalize_subject_name(candidate) for candidate in candidates)


_NEIS_SLOT_ID_RE = re.compile(r"^neis-(\d+)-(.+?)-(\d+)-(.*)$")


def parse_neis_slot_id(slot_id: str) -> tuple[int, str, int] | None:
    """Parse a ``neis-{grade}-{class}-{period}-{subject}`` slot id.

    Returns ``(grade, class_no, period)`` or ``None`` if it does not match.
    Used to reconstruct ad-hoc (보강) slots that are not in the stored timetable.
    """
    match = _NEIS_SLOT_ID_RE.match(slot_id or "")
    if match is None:
        return None
    try:
        grade = int(match.group(1))
        class_no = match.group(2)
        period = int(match.group(3))
    except (TypeError, ValueError):
        return None
    return (grade, class_no, period)


def search_schools(
    *,
    region: str,
    school_name: str,
    api_key: str = "",
    fetch_json: Callable[[str, dict[str, object]], dict[str, Any]] = _fetch_json,
) -> dict[str, Any]:
    """Find schools in a region by (partial) name, for disambiguating同名 schools.

    Returns every matching school that has a timetable endpoint, each with its
    standard school code (SD_SCHUL_CODE) plus 관할청/주소 so the teacher can pick
    the right one when several share a name. The chosen code is then stored and
    used for timetable lookups, so the resolution never has to guess again.
    """

    school_name = school_name.strip()
    if not school_name:
        raise NeisOpenApiError("학교명을 입력해 주세요")
    if region not in REGION_TO_ATPT_CODE:
        raise NeisOpenApiError(f"지원하지 않는 교육청입니다: {region}")

    atpt_code = REGION_TO_ATPT_CODE[region]
    payload = fetch_json(
        "schoolInfo",
        {
            "KEY": api_key,
            "Type": "json",
            "pIndex": 1,
            "pSize": 100,
            "ATPT_OFCDC_SC_CODE": atpt_code,
            "SCHUL_NM": school_name,
        },
    )
    schools: list[dict[str, Any]] = []
    for row in _rows_from_payload(payload, "schoolInfo"):
        kind = str(row.get("SCHUL_KND_SC_NM") or "")
        if kind not in SCHOOL_KIND_TO_TIMETABLE_ENDPOINT:
            continue  # skip 유치원 등 시간표 API가 없는 학교급
        schools.append(
            {
                "name": str(row.get("SCHUL_NM") or ""),
                "code": str(row.get("SD_SCHUL_CODE") or ""),
                "kind": kind,
                "officeCode": str(row.get("ATPT_OFCDC_SC_CODE") or atpt_code),
                "district": str(row.get("JU_ORG_NM") or ""),
                "address": str(row.get("ORG_RDNMA") or ""),
            }
        )
    return {"schools": schools}


def _resolve_school_and_endpoint(
    *,
    region: str,
    school_name: str,
    api_key: str,
    fetch_json: Callable[[str, dict[str, object]], dict[str, Any]],
) -> tuple[dict[str, Any], str, dict[str, object]]:
    school_name = school_name.strip()
    if not school_name:
        raise NeisOpenApiError("학교명을 입력해 주세요")
    if region not in REGION_TO_ATPT_CODE:
        raise NeisOpenApiError(f"지원하지 않는 교육청입니다: {region}")

    atpt_code = REGION_TO_ATPT_CODE[region]
    base_params: dict[str, object] = {
        "KEY": api_key,
        "Type": "json",
        "pIndex": 1,
        "pSize": 100,
    }
    school_payload = fetch_json(
        "schoolInfo",
        {
            **base_params,
            "ATPT_OFCDC_SC_CODE": atpt_code,
            "SCHUL_NM": school_name,
        },
    )
    schools = _rows_from_payload(school_payload, "schoolInfo")
    if not schools:
        raise NeisOpenApiError(f"학교를 찾을 수 없습니다: {school_name}")

    school = schools[0]
    endpoint = SCHOOL_KIND_TO_TIMETABLE_ENDPOINT.get(str(school.get("SCHUL_KND_SC_NM") or ""))
    if endpoint is None:
        raise NeisOpenApiError("지원하지 않는 학교급입니다.")

    return school, endpoint, base_params


def _resolve_school_cached(
    *,
    region: str,
    school_name: str,
    api_key: str,
    fetch_json: Callable[[str, dict[str, object]], dict[str, Any]],
    school_cache: dict[tuple[str, str, str], tuple[dict[str, Any], str, dict[str, object]]] | None,
) -> tuple[dict[str, Any], str, dict[str, object]]:
    """Resolve school code + endpoint, reusing a shared cache when provided.

    The school code/endpoint never change for a given school, so caching them
    removes one schoolInfo request per timetable lookup. Double-checked under a
    lock so parallel callers issue at most one schoolInfo request.
    """

    if school_cache is None:
        return _resolve_school_and_endpoint(
            region=region, school_name=school_name, api_key=api_key, fetch_json=fetch_json
        )
    key = (region, school_name.strip(), api_key)
    cached = school_cache.get(key)
    if cached is not None:
        return cached
    with _SCHOOL_CACHE_LOCK:
        cached = school_cache.get(key)
        if cached is not None:
            return cached
        resolved = _resolve_school_and_endpoint(
            region=region, school_name=school_name, api_key=api_key, fetch_json=fetch_json
        )
        school_cache[key] = resolved
        return resolved


def _resolve_school(
    *,
    region: str,
    school_name: str,
    school_code: str = "",
    school_kind: str = "",
    api_key: str,
    fetch_json: Callable[[str, dict[str, object]], dict[str, Any]],
    school_cache: dict[tuple[str, str, str], tuple[dict[str, Any], str, dict[str, object]]] | None = None,
) -> tuple[dict[str, Any], str, dict[str, object]]:
    """Resolve a school + timetable endpoint, preferring an explicit code.

    When a standard school code and school kind are supplied (saved by the
    school picker), build the school directly with no ``schoolInfo`` request —
    this is both faster and immune to同名 schools. Otherwise fall back to
    resolving by name (legacy settings that predate the picker).
    """

    code = (school_code or "").strip()
    kind = (school_kind or "").strip()
    if code and kind:
        if region not in REGION_TO_ATPT_CODE:
            raise NeisOpenApiError(f"지원하지 않는 교육청입니다: {region}")
        endpoint = SCHOOL_KIND_TO_TIMETABLE_ENDPOINT.get(kind)
        if endpoint is None:
            raise NeisOpenApiError("지원하지 않는 학교급입니다.")
        school = {
            "ATPT_OFCDC_SC_CODE": REGION_TO_ATPT_CODE[region],
            "SD_SCHUL_CODE": code,
            "SCHUL_NM": school_name.strip(),
            "SCHUL_KND_SC_NM": kind,
        }
        base_params: dict[str, object] = {
            "KEY": api_key,
            "Type": "json",
            "pIndex": 1,
            "pSize": 100,
        }
        return school, endpoint, base_params
    return _resolve_school_cached(
        region=region,
        school_name=school_name,
        api_key=api_key,
        fetch_json=fetch_json,
        school_cache=school_cache,
    )


def _weekdays_for(date_str: str) -> list[date_type]:
    selected_date = _parse_date(date_str)
    monday = selected_date - timedelta(days=selected_date.weekday())
    return [monday + timedelta(days=offset) for offset in range(5)]


def _subject_candidate_score(input_subject: str, candidate: str) -> int:
    input_norm = normalize_subject_name(input_subject)
    candidate_norm = normalize_subject_name(candidate)
    if not input_norm or not candidate_norm:
        return 0
    if input_norm == candidate_norm:
        return 100
    if input_norm in candidate_norm or candidate_norm in input_norm:
        return max(75, 92 - abs(len(input_norm) - len(candidate_norm)))
    return int(SequenceMatcher(None, input_norm, candidate_norm).ratio() * 70)


def _subjects_from_rows(rows: list[dict[str, Any]]) -> list[str]:
    subjects: list[str] = []
    seen: set[str] = set()
    for row in rows:
        subject = str(row.get("ITRT_CNTNT") or "").strip()
        key = subject
        if not subject or key in seen:
            continue
        seen.add(key)
        subjects.append(subject)
    return subjects


def query_subject_candidates(
    *,
    region: str,
    school_name: str,
    date_str: str,
    grade: int,
    class_no: str = "",
    subject_name: str,
    school_code: str = "",
    school_kind: str = "",
    api_key: str = "",
    fetch_json: Callable[[str, dict[str, object]], dict[str, Any]] = _fetch_json,
) -> dict[str, Any]:
    """Find NEIS subject labels similar to a teacher-entered subject name."""

    subject_name = subject_name.strip()
    if not subject_name:
        raise NeisOpenApiError("과목명을 먼저 입력해 주세요")

    school, endpoint, base_params = _resolve_school(
        region=region,
        school_name=school_name,
        school_code=school_code,
        school_kind=school_kind,
        api_key=api_key,
        fetch_json=fetch_json,
    )

    def fetch_subjects(scope_class_no: str = "") -> list[str]:
        rows: list[dict[str, Any]] = []
        for target_date in _weekdays_for(date_str):
            params: dict[str, object] = {
                **base_params,
                "ATPT_OFCDC_SC_CODE": school.get("ATPT_OFCDC_SC_CODE") or REGION_TO_ATPT_CODE[region],
                "SD_SCHUL_CODE": school.get("SD_SCHUL_CODE"),
                "ALL_TI_YMD": target_date.strftime("%Y%m%d"),
                "GRADE": str(int(grade)),
            }
            if scope_class_no:
                params["CLASS_NM"] = str(scope_class_no).strip()
            payload = fetch_json(endpoint, params)
            rows.extend(_rows_from_payload(payload, endpoint))
        return _subjects_from_rows(rows)

    scope = "grade"
    subjects = fetch_subjects()
    if not subjects and str(class_no).strip():
        scope = "class"
        subjects = fetch_subjects(str(class_no).strip())

    scored = [
        {"subject": subject, "score": _subject_candidate_score(subject_name, subject), "_order": index}
        for index, subject in enumerate(subjects)
    ]
    candidates = [
        {"subject": item["subject"], "score": item["score"]}
        for item in sorted(scored, key=lambda value: (-value["score"], value["_order"]))
        if item["score"] >= 65
    ][:8]

    return {
        "school": {
            "name": school.get("SCHUL_NM"),
            "code": school.get("SD_SCHUL_CODE"),
            "kind": school.get("SCHUL_KND_SC_NM"),
            "officeCode": school.get("ATPT_OFCDC_SC_CODE") or REGION_TO_ATPT_CODE[region],
        },
        "date": _parse_date(date_str).isoformat(),
        "scope": scope,
        "candidates": candidates,
    }


def query_class_timetable(
    *,
    region: str,
    school_name: str,
    date_str: str,
    grade: int,
    class_no: str,
    school_code: str = "",
    school_kind: str = "",
    api_key: str = "",
    fetch_json: Callable[[str, dict[str, object]], dict[str, Any]] = _fetch_json,
    school_cache: dict[tuple[str, str, str], tuple[dict[str, Any], str, dict[str, object]]] | None = None,
) -> dict[str, Any]:
    """Return timetable preview rows for one school/class/date.

    Pass a shared ``school_cache`` dict to skip the repeated schoolInfo lookup
    when querying many classes/dates for the same school.
    """

    school_name = school_name.strip()
    class_no = str(class_no).strip()
    if not school_name:
        raise NeisOpenApiError("학교명을 입력해 주세요.")
    if not class_no:
        raise NeisOpenApiError("반을 입력해 주세요.")
    if region not in REGION_TO_ATPT_CODE:
        raise NeisOpenApiError(f"지원하지 않는 교육청입니다: {region}")

    selected_date = _parse_date(date_str)
    atpt_code = REGION_TO_ATPT_CODE[region]
    school, endpoint, base_params = _resolve_school(
        region=region,
        school_name=school_name,
        school_code=school_code,
        school_kind=school_kind,
        api_key=api_key,
        fetch_json=fetch_json,
        school_cache=school_cache,
    )

    timetable_payload = fetch_json(
        endpoint,
        {
            **base_params,
            "ATPT_OFCDC_SC_CODE": school.get("ATPT_OFCDC_SC_CODE") or atpt_code,
            "SD_SCHUL_CODE": school.get("SD_SCHUL_CODE"),
            "ALL_TI_YMD": selected_date.strftime("%Y%m%d"),
            "GRADE": str(int(grade)),
            "CLASS_NM": class_no,
        },
    )
    rows = _rows_from_payload(timetable_payload, endpoint)
    day = WEEKDAY_TO_KO[selected_date.weekday()]
    lessons = [
        {
            "day": day,
            "period": int(row.get("PERIO") or 0),
            "grade": int(row.get("GRADE") or grade),
            "classNo": str(row.get("CLASS_NM") or class_no),
            "subject": str(row.get("ITRT_CNTNT") or "").strip(),
            "neis": str(row.get("ITRT_CNTNT") or "").strip(),
        }
        for row in rows
        if str(row.get("ITRT_CNTNT") or "").strip()
    ]
    lessons.sort(key=lambda item: item["period"])
    return {
        "school": {
            "name": school.get("SCHUL_NM"),
            "code": school.get("SD_SCHUL_CODE"),
            "kind": school.get("SCHUL_KND_SC_NM"),
            "officeCode": school.get("ATPT_OFCDC_SC_CODE") or atpt_code,
        },
        "date": selected_date.isoformat(),
        "lessons": lessons,
    }
