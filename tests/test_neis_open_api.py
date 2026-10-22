import pytest
from urllib.error import URLError

from subject_teacher.neis_open_api import (
    NeisOpenApiError,
    _fetch_json,
    query_subject_candidates,
    query_class_timetable,
    search_schools,
    subject_matches,
)


def test_subject_matching_normalizes_arabic_and_roman_numerals():
    assert subject_matches("수학Ⅰ", ["수학1"]) is True
    assert subject_matches("수학 I", ["수학1"]) is True
    assert subject_matches("영어Ⅱ", ["영어2"]) is True
    assert subject_matches("문학", ["독서"]) is False


def test_subject_matching_uses_teacher_aliases():
    assert subject_matches("문학과 매체", ["문학"], aliases=["문학과매체"]) is True


def test_search_schools_returns_candidates_with_location_for_disambiguation():
    def fake_fetch(endpoint, params):
        assert endpoint == "schoolInfo"
        assert params["ATPT_OFCDC_SC_CODE"] == "J10"
        assert params["SCHUL_NM"] == "중앙고"
        return {
            "schoolInfo": [
                {"head": [{"list_total_count": 3}]},
                {
                    "row": [
                        {
                            "ATPT_OFCDC_SC_CODE": "J10",
                            "SD_SCHUL_CODE": "7530001",
                            "SCHUL_NM": "중앙고등학교",
                            "SCHUL_KND_SC_NM": "고등학교",
                            "JU_ORG_NM": "수원교육지원청",
                            "ORG_RDNMA": "경기도 수원시 팔달구 ...",
                        },
                        {
                            "ATPT_OFCDC_SC_CODE": "J10",
                            "SD_SCHUL_CODE": "7530002",
                            "SCHUL_NM": "중앙고등학교",
                            "SCHUL_KND_SC_NM": "고등학교",
                            "JU_ORG_NM": "고양교육지원청",
                            "ORG_RDNMA": "경기도 고양시 일산동구 ...",
                        },
                        {
                            "ATPT_OFCDC_SC_CODE": "J10",
                            "SD_SCHUL_CODE": "7530003",
                            "SCHUL_NM": "중앙유치원",
                            "SCHUL_KND_SC_NM": "유치원",
                        },
                    ]
                },
            ]
        }

    result = search_schools(region="경기", school_name="중앙고", fetch_json=fake_fetch)

    # Two same-named high schools surface separately; the unsupported 유치원 is dropped.
    assert [s["code"] for s in result["schools"]] == ["7530001", "7530002"]
    first = result["schools"][0]
    assert first["name"] == "중앙고등학교"
    assert first["kind"] == "고등학교"
    assert first["officeCode"] == "J10"
    assert first["district"] == "수원교육지원청"
    assert "수원" in first["address"]


def test_query_class_timetable_with_school_code_skips_school_info_lookup():
    calls = []

    def fake_fetch(endpoint, params):
        calls.append(endpoint)
        assert endpoint == "hisTimetable"
        assert params["ATPT_OFCDC_SC_CODE"] == "J10"
        assert params["SD_SCHUL_CODE"] == "7530174"
        return {
            "hisTimetable": [
                {"head": [{"list_total_count": 1}]},
                {"row": [{"GRADE": "2", "CLASS_NM": "1", "PERIO": "3", "ITRT_CNTNT": "문학"}]},
            ]
        }

    result = query_class_timetable(
        region="경기",
        school_name="수원고등학교",
        school_code="7530174",
        school_kind="고등학교",
        date_str="2025-03-10",
        grade=2,
        class_no="1",
        fetch_json=fake_fetch,
    )

    assert "schoolInfo" not in calls
    assert result["school"]["code"] == "7530174"
    assert result["lessons"][0]["subject"] == "문학"


def test_query_class_timetable_maps_high_school_rows_to_preview_lessons():
    calls = []

    def fake_fetch(endpoint, params):
        calls.append((endpoint, params))
        if endpoint == "schoolInfo":
            return {
                "schoolInfo": [
                    {"head": [{"list_total_count": 1}]},
                    {
                        "row": [
                            {
                                "ATPT_OFCDC_SC_CODE": "J10",
                                "SD_SCHUL_CODE": "7530174",
                                "SCHUL_NM": "수원고등학교",
                                "SCHUL_KND_SC_NM": "고등학교",
                            }
                        ]
                    },
                ]
            }
        if endpoint == "hisTimetable":
            assert params["ATPT_OFCDC_SC_CODE"] == "J10"
            assert params["SD_SCHUL_CODE"] == "7530174"
            assert params["ALL_TI_YMD"] == "20250310"
            assert params["GRADE"] == "2"
            assert params["CLASS_NM"] == "1"
            return {
                "hisTimetable": [
                    {"head": [{"list_total_count": 2}]},
                    {
                        "row": [
                            {"GRADE": "2", "CLASS_NM": "1", "PERIO": "3", "ITRT_CNTNT": "문학"},
                            {"GRADE": "2", "CLASS_NM": "1", "PERIO": "4", "ITRT_CNTNT": "수학Ⅰ"},
                        ]
                    },
                ]
            }
        raise AssertionError(endpoint)

    result = query_class_timetable(
        region="경기",
        school_name="수원고",
        date_str="2025-03-10",
        grade=2,
        class_no="1",
        fetch_json=fake_fetch,
    )

    assert calls[0][0] == "schoolInfo"
    assert calls[1][0] == "hisTimetable"
    assert result["school"]["name"] == "수원고등학교"
    assert result["lessons"] == [
        {"day": "월", "period": 3, "grade": 2, "classNo": "1", "subject": "문학", "neis": "문학"},
        {"day": "월", "period": 4, "grade": 2, "classNo": "1", "subject": "수학Ⅰ", "neis": "수학Ⅰ"},
    ]


def test_fetch_json_uses_https_proxy_without_local_key(monkeypatch):
    import json
    from io import BytesIO
    calls = []
    def fake_urlopen(request, timeout):
        calls.append(request)
        return BytesIO(b'{"ok":true}')
    monkeypatch.setattr("subject_teacher.neis_open_api.urlopen", fake_urlopen)
    assert _fetch_json("schoolInfo", {"Type":"json", "KEY":"local-secret"}) == {"ok":True}
    assert calls[0].full_url == "https://subjectteacherpwa.vercel.app/api/neis"
    assert calls[0].method == "POST"
    assert b"local-secret" not in calls[0].data
    assert json.loads(calls[0].data)["params"] == {"Type":"json"}


def test_fetch_json_does_not_fallback_to_plaintext_or_leak_errors(monkeypatch):
    calls=[]
    def fake_urlopen(request, timeout):
        calls.append(request.full_url)
        raise URLError("sensitive diagnostic")
    monkeypatch.setattr("subject_teacher.neis_open_api.urlopen",fake_urlopen)
    with pytest.raises(NeisOpenApiError) as exc:
        _fetch_json("schoolInfo", {})
    assert "sensitive" not in str(exc.value)
    assert len(calls)==2 and all(url.startswith("https://") for url in calls)


def test_query_class_timetable_reuses_school_cache_across_calls():
    schoolinfo_calls = []
    timetable_calls = []

    def fake_fetch(endpoint, params):
        if endpoint == "schoolInfo":
            schoolinfo_calls.append(params)
            return {
                "schoolInfo": [
                    {"head": [{"list_total_count": 1}]},
                    {
                        "row": [
                            {
                                "ATPT_OFCDC_SC_CODE": "J10",
                                "SD_SCHUL_CODE": "7530174",
                                "SCHUL_NM": "수원고등학교",
                                "SCHUL_KND_SC_NM": "고등학교",
                            }
                        ]
                    },
                ]
            }
        if endpoint == "hisTimetable":
            timetable_calls.append(params)
            return {"hisTimetable": [{"head": []}, {"row": []}]}
        raise AssertionError(endpoint)

    cache: dict = {}
    for date_str in ("2025-03-10", "2025-03-11", "2025-03-12"):
        query_class_timetable(
            region="경기",
            school_name="수원고",
            date_str=date_str,
            grade=2,
            class_no="1",
            fetch_json=fake_fetch,
            school_cache=cache,
        )

    # schoolInfo resolved once and reused; only the per-date timetable repeats.
    assert len(schoolinfo_calls) == 1
    assert len(timetable_calls) == 3


def test_query_class_timetable_raises_when_school_is_not_found():
    def fake_fetch(endpoint, params):
        return {"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}}

    with pytest.raises(NeisOpenApiError, match="학교를 찾을 수 없습니다"):
        query_class_timetable(
            region="경기",
            school_name="없는학교",
            date_str="2025-03-10",
            grade=2,
            class_no="1",
            fetch_json=fake_fetch,
        )


def test_query_subject_candidates_uses_grade_scope_and_filters_similar_subjects():
    calls = []

    def fake_fetch(endpoint, params):
        calls.append((endpoint, params))
        if endpoint == "schoolInfo":
            return {
                "schoolInfo": [
                    {"head": [{"list_total_count": 1}]},
                    {
                        "row": [
                            {
                                "ATPT_OFCDC_SC_CODE": "J10",
                                "SD_SCHUL_CODE": "7530174",
                                "SCHUL_NM": "수원고등학교",
                                "SCHUL_KND_SC_NM": "고등학교",
                            }
                        ]
                    },
                ]
            }
        if endpoint == "hisTimetable":
            assert "CLASS_NM" not in params
            return {
                "hisTimetable": [
                    {"head": [{"list_total_count": 3}]},
                    {
                        "row": [
                            {"GRADE": "1", "CLASS_NM": "1", "PERIO": "1", "ITRT_CNTNT": "공통국어Ⅰ"},
                            {"GRADE": "1", "CLASS_NM": "2", "PERIO": "2", "ITRT_CNTNT": "공통 국어 1"},
                            {"GRADE": "1", "CLASS_NM": "3", "PERIO": "3", "ITRT_CNTNT": "통합사회"},
                        ]
                    },
                ]
            }
        raise AssertionError(endpoint)

    result = query_subject_candidates(
        region="경기",
        school_name="수원고",
        date_str="2026-05-06",
        grade=1,
        class_no="1",
        subject_name="공통국어1",
        fetch_json=fake_fetch,
    )

    assert result["scope"] == "grade"
    assert [candidate["subject"] for candidate in result["candidates"]] == ["공통국어Ⅰ", "공통 국어 1"]


def test_query_subject_candidates_falls_back_to_class_scope_when_grade_scope_is_empty():
    timetable_calls = []

    def fake_fetch(endpoint, params):
        if endpoint == "schoolInfo":
            return {
                "schoolInfo": [
                    {"head": [{"list_total_count": 1}]},
                    {
                        "row": [
                            {
                                "ATPT_OFCDC_SC_CODE": "J10",
                                "SD_SCHUL_CODE": "7530174",
                                "SCHUL_NM": "수원고등학교",
                                "SCHUL_KND_SC_NM": "고등학교",
                            }
                        ]
                    },
                ]
            }
        if endpoint == "hisTimetable":
            timetable_calls.append(params)
            if "CLASS_NM" not in params:
                return {"RESULT": {"CODE": "INFO-200", "MESSAGE": "데이터 없음"}}
            return {
                "hisTimetable": [
                    {"head": [{"list_total_count": 1}]},
                    {
                        "row": [
                            {"GRADE": "2", "CLASS_NM": "1", "PERIO": "3", "ITRT_CNTNT": "문학"},
                            {"GRADE": "2", "CLASS_NM": "1", "PERIO": "4", "ITRT_CNTNT": "기하"},
                        ]
                    },
                ]
            }
        raise AssertionError(endpoint)

    result = query_subject_candidates(
        region="경기",
        school_name="수원고",
        date_str="2026-05-06",
        grade=2,
        class_no="1",
        subject_name="문학",
        fetch_json=fake_fetch,
    )

    assert result["scope"] == "class"
    assert any(call.get("CLASS_NM") == "1" for call in timetable_calls)
    assert [candidate["subject"] for candidate in result["candidates"]] == ["문학"]
