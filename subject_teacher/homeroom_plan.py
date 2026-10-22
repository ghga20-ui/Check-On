"""Daily homeroom decisions per the supplied 2026 manual, printed pp.362-376.

Events are evidence. A NEIS daily classification is ONE reviewed decision,
not one write per event. Course-period cells are never changed for 2022.
"""
import hashlib
import json
from datetime import date
from subject_teacher.drive.homeroom import DiaryDay

KINDS = {'absent':'결석','late':'지각','early':'조퇴','partial':'결과'}
CATEGORIES = {'illness':'질병','unexcused':'미인정','other':'기타','excused':'출석인정'}


def session_label(value):
    return '조회' if value == 0 else '종례' if value == 8 else f'{value}교시'


def build_plan(day: str, class_key: str, diary: DiaryDay):
    date.fromisoformat(day)
    grade, class_no = class_key.split('-')
    year = int(day[:4]) - (int(day[5:7]) < 3)
    errors = []
    if not diary.events and not diary.no_changes_confirmed:
        errors.append('미기록은 전원 출석이 아닙니다. 변동 없음 확인이 필요합니다.')
    rows = []
    for number in sorted({e.number for e in diary.events}):
        events = [e for e in diary.events if e.number == number]
        ordinary = [e for e in events if e.category != 'excused']
        chosen = next((e for e in ordinary if e.id == diary.decisions.get(str(number))), None)
        if chosen is None and len(ordinary) == 1:
            chosen = ordinary[0]
        if len(ordinary) > 1 and chosen is None:
            errors.append(f'{number}번: 학교 규정에 따라 최종 출결 한 건을 선택해 주세요.')
        practice = next((e.practice for e in events if e.practice), None)
        if practice:
            errors.append(f'{number}번: 이전 버전의 별도 기록은 자동 입력 대상에서 제외됩니다.')
        # A reason includes every event, even when a different final category wins.
        reason = '\n'.join(f'{CATEGORIES[e.category]} {KINDS[e.kind]}'+
                           (f' ({session_label(e.start_session)}~{session_label(e.end_session)})' if e.start_session is not None else f' ({e.start_period}~{e.end_period}교시)' if e.start_period else '')+
                           f': {e.reason}' for e in events)
        rows.append({
            'number':number,
            'classification':CATEGORIES[chosen.category]+KINDS[chosen.kind] if chosen else '',
            'kind':KINDS[chosen.kind] if chosen else None,
            'category':CATEGORIES[chosen.category] if chosen else None,
            'reason':reason,
            'morningAbsent':any((e.kind in ('absent','late') or (e.kind == 'partial' and e.start_session == 0)) and e.category != 'excused' for e in events),
            'afternoonAbsent':any((e.kind in ('absent','early') or (e.kind == 'partial' and e.end_session == 8)) and e.category != 'excused' for e in events),
            'practice':practice.model_dump() if practice else None,
            'periodsReadOnly':True,
        })
    payload = {'date':day,'classKey':class_key,'year':year,'grade':int(grade),'classNo':class_no,
               'curriculum':'2022','revision':diary.revision,'rows':rows,
               'noChangesConfirmed':diary.no_changes_confirmed,'errors':errors}
    payload['token'] = hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    return payload
