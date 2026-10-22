from copy import deepcopy
from unittest.mock import MagicMock
import pytest
from subject_teacher.drive.homeroom import DiaryDay
from subject_teacher.homeroom_plan import build_plan
from subject_teacher.neis.homeroom_commands import execute_plan, HomeroomScreenError


def event(**changes):
    return {**dict(id='a',number=1,kind='late',category='unexcused',reason='등교 지연',startPeriod=3,endPeriod=3),**changes}


def plan(events,**fields):
    return build_plan('2026-09-16','2-1',DiaryDay(events=events,curriculum='2022',**fields))


def test_excused_all_day_is_reason_only_2022():
    p=plan([event(kind='absent',category='excused',reason='학교장 허가 교외체험학습',startPeriod=None,endPeriod=None)])
    assert not p['errors']
    row=p['rows'][0]
    assert row['classification']==''
    assert row['kind'] is None and not row['morningAbsent'] and not row['afternoonAbsent']
    assert row['periodsReadOnly']
    assert '교외체험학습' in row['reason']


def test_manual_example_unexcused_late_with_excused_partial():
    p=plan([event(),event(id='b',kind='partial',category='excused',reason='위클래스 상담',startPeriod=5,endPeriod=5)])
    row=p['rows'][0]
    assert row['classification']=='미인정지각'
    assert row['morningAbsent'] and not row['afternoonAbsent']
    assert '위클래스 상담' in row['reason']


def test_manual_example_illness_partial_with_excused_early():
    p=plan([event(kind='partial',category='illness',startPeriod=3,endPeriod=4),event(id='b',kind='early',category='excused',startPeriod=6,endPeriod=6)])
    row=p['rows'][0]
    assert row['classification']=='질병결과'
    assert not row['morningAbsent'] and not row['afternoonAbsent']


def test_overlapping_types_require_teacher_decision_and_keep_both_reasons():
    events=[event(),event(id='b',kind='early',reason='가정 사정',startPeriod=6,endPeriod=6)]
    assert plan(events)['errors']
    p=plan(events,decisions={'1':'b'})
    assert not p['errors'] and p['rows'][0]['classification']=='미인정조퇴'
    assert p['rows'][0]['morningAbsent'] and p['rows'][0]['afternoonAbsent']
    assert '등교 지연' in p['rows'][0]['reason'] and '가정 사정' in p['rows'][0]['reason']


def test_missing_data_is_not_attendance_confirmation():
    assert plan([])['errors']
    assert not plan([],noChangesConfirmed=True)['errors']
    assert build_plan('2026-09-16','3-1',DiaryDay(curriculum='2022'))['errors']


def test_practice_is_explicit_exception_not_ordinary_excused():
    p=plan([event(kind='absent',category='excused',startPeriod=None,endPeriod=None,practice={'start':'2026-09-01','end':'2026-09-30','organization':'합성기관'})])
    assert p['errors']
    assert p['rows'][0]['classification']==''
    assert p['rows'][0]['practice']['organization']=='합성기관'


def screen_for(p):
    screen=MagicMock(unsafe=True)
    screen.preflight.return_value={'조회':'','종례':'','사유':''}
    screen.snapshot.return_value={'조회':'','종례':'','사유':''}
    return screen


def test_all_rows_preflight_before_any_mutation():
    p=plan([event(),event(id='b',number=2)])
    screen=screen_for(p)
    screen.preflight.side_effect=[{},HomeroomScreenError('mismatch')]
    with pytest.raises(HomeroomScreenError):execute_plan(screen,p)
    screen.apply.assert_not_called();screen.save.assert_not_called()


def test_inspection_never_applies_or_saves():
    p=plan([event()]);screen=screen_for(p)
    result=execute_plan(screen,p,inspect_only=True)
    assert result['status']=='inspected' and not result['saved']
    screen.apply.assert_not_called();screen.save.assert_not_called()


def test_saved_requires_refresh_verification_and_never_closes():
    p=plan([event()]);screen=screen_for(p)
    result=execute_plan(screen,p)
    assert result=={'status':'saved','saved':True,'closed':False}
    assert screen.verify.call_count==2
    screen.refresh.assert_called_once();screen.close.assert_not_called()
    screen.verify.side_effect=HomeroomScreenError('different')
    screen.reset_mock()
    with pytest.raises(HomeroomScreenError):execute_plan(screen,p)
    screen.save.assert_not_called()


def test_stale_drive_snapshot_stops_before_input():
    p=plan([event()]);screen=screen_for(p)
    def changed():raise HomeroomScreenError('changed')
    with pytest.raises(HomeroomScreenError):execute_plan(screen,p,still_current=changed)
    screen.apply.assert_not_called()


def test_migration_preserves_events_and_stale_decisions_fail():
    from subject_teacher.drive.migrations import migrate_homeroom
    from subject_teacher.drive.homeroom import DiaryMonth
    original={'schemaVersion':1,'month':'2026-09','records':{'2026-09-16':{'2-1':{'revision':2,'events':[event()]}}}}
    updated=DiaryMonth.model_validate(migrate_homeroom(original))
    assert updated.schema_version==3
    assert updated.records['2026-09-16']['2-1'].curriculum is None
    assert original['schemaVersion']==1
    with pytest.raises(ValueError):DiaryDay(events=[event()],decisions={'1':'missing'})


def test_2022_default_and_assembly_sessions():
    p = build_plan('2026-09-16', '2-1', DiaryDay(events=[event(kind='partial', startPeriod=None, endPeriod=None, startSession=0, endSession=8)]))
    assert p['curriculum'] == '2022' and not p['errors']
    row = p['rows'][0]
    assert row['morningAbsent'] and row['afternoonAbsent']
    assert '조회' in row['reason'] and '종례' in row['reason']
    assert row['periodsReadOnly']


def test_session_validation_preserves_legacy_eighth_period():
    from subject_teacher.drive.homeroom import Event
    old = Event(**event(startPeriod=8, endPeriod=8))
    assert old.start_period == 8 and old.start_session is None
    current = event(startPeriod=None, endPeriod=None, startSession=2, endSession=2)
    with pytest.raises(ValueError):
        DiaryDay(events=[event(startPeriod=2, endPeriod=2), {**current, 'id':'b'}])
    for start, end in [(-1, 2), (0, 9), (3, 2)]:
        with pytest.raises(ValueError):
            Event(**event(kind='partial', startPeriod=None, endPeriod=None, startSession=start, endSession=end))
