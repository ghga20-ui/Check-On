"""Encrypted homeroom diary; day revisions protect edits across devices."""
from datetime import date
from typing import Literal
from pydantic import Field, ConfigDict, model_validator
from subject_teacher.drive.schemas import _Base
from subject_teacher.drive.concurrency import DriveConflictError
from subject_teacher.drive.client import PreconditionFailed


class Practice(_Base):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    start: str
    end: str
    organization: str = Field(min_length=1, max_length=200)

    @model_validator(mode='after')
    def valid(self):
        if date.fromisoformat(self.start).isoformat() != self.start or date.fromisoformat(self.end).isoformat() != self.end or self.start > self.end:
            raise ValueError('현장실습 기간을 확인해 주세요.')
        self.organization = self.organization.strip()
        if not self.organization:
            raise ValueError('현장실습 기관명을 입력해 주세요.')
        return self


class Event(_Base):
    model_config = ConfigDict(alias_generator=lambda s: ''.join([s.split('_')[0], *[p.title() for p in s.split('_')[1:]]]), populate_by_name=True, extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    number: int = Field(ge=1, le=99, strict=True)
    kind: Literal['absent', 'late', 'early', 'partial']
    category: Literal['illness', 'unexcused', 'other', 'excused']
    reason: str = Field(min_length=1, max_length=1000)
    practice: Practice | None = None
    start_session: int | None = Field(default=None, ge=0, le=8, strict=True)
    end_session: int | None = Field(default=None, ge=0, le=8, strict=True)
    start_period: int | None = Field(default=None, ge=1, le=9, strict=True)
    end_period: int | None = Field(default=None, ge=1, le=9, strict=True)

    @model_validator(mode='after')
    def valid(self):
        if self.practice and (self.kind != 'absent' or self.category != 'excused'):
            raise ValueError('현장실습은 출석인정 결석으로 기록합니다.')
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError('사유를 입력해 주세요.')
        if self.start_session is not None or self.end_session is not None:
            if self.start_session is None or self.end_session is None or self.start_session > self.end_session:
                raise ValueError('조회~종례의 시간 범위를 확인해 주세요.')
            if self.start_period is not None or self.end_period is not None or self.kind == 'absent':
                raise ValueError('시간 선택과 기존 교시를 함께 저장할 수 없습니다.')
            if self.kind != 'partial' and self.start_session != self.end_session:
                raise ValueError('등교·조퇴 시점은 하나를 선택해 주세요.')
            return self
        if self.kind == 'absent':
            if self.start_period is not None or self.end_period is not None:
                raise ValueError('결석은 하루 전체로 기록합니다.')
        elif self.start_period is None or self.end_period is None or self.start_period > self.end_period:
            raise ValueError('교시를 확인해 주세요.')
        elif self.kind != 'partial' and self.start_period != self.end_period:
            raise ValueError('등교·조퇴 교시는 하나를 선택해 주세요.')
        return self


class DiaryDay(_Base):
    revision: int = Field(default=0, ge=0, strict=True)
    events: list[Event] = Field(default_factory=list, max_length=500)
    curriculum: Literal['2022', '2015'] | None = None
    decisions: dict[str, str] = Field(default_factory=dict)
    no_changes_confirmed: bool = Field(default=False, strict=True)

    @model_validator(mode='after')
    def unique(self):
        ids, identities, absent, changed = set(), set(), set(), set()
        for event in self.events:
            def slot(session, period):
                return session if session is not None else (f"legacy-{period}" if period and period > 7 else period)
            identity = (event.number, event.kind, slot(event.start_session, event.start_period), slot(event.end_session, event.end_period))
            if event.id in ids or identity in identities:
                raise ValueError('같은 기록이 중복되었습니다.')
            ids.add(event.id); identities.add(identity)
            (absent if event.kind == 'absent' else changed).add(event.number)
        if absent & changed:
            raise ValueError('하루 결석과 지각·조퇴·결과를 함께 기록할 수 없습니다.')
        for number, event_id in self.decisions.items():
            if not any(str(e.number) == number and e.id == event_id for e in self.events):
                raise ValueError('최종 출결로 선택한 기록을 확인해 주세요.')
        if self.no_changes_confirmed and self.events:
            raise ValueError('변동 기록이 있으면 변동 없음으로 확인할 수 없습니다.')
        return self


class DiaryMonth(_Base):
    schema_version: Literal[3] = 3
    month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    records: dict[str, dict[str, DiaryDay]] = Field(default_factory=dict)

    @model_validator(mode='after')
    def dates(self):
        import re
        for day, classes in self.records.items():
            if date.fromisoformat(day).isoformat() != day or day[:7] != self.month:
                raise ValueError('기록 날짜가 일치하지 않습니다.')
            if any(not re.fullmatch(r'[1-3]-[1-9]\d*', key) for key in classes):
                raise ValueError('일반 학급을 선택해 주세요.')
        return self


def filename(month):
    date.fromisoformat(month + '-01')
    return f'homeroom-{month}.json'


def load_month(store, month):
    from subject_teacher.drive.migrations import migrate_homeroom
    raw = store.client.read_snapshot(filename(month)).data
    document = DiaryMonth.model_validate(migrate_homeroom(raw)) if raw is not None else DiaryMonth(month=month)
    if document.month != month:
        raise ValueError('담임 기록의 월과 파일이 일치하지 않습니다.')
    return document


def save_day(store, day, class_key, expected_revision, events, *, curriculum=None, decisions=None, no_changes_confirmed=False):
    from subject_teacher.drive.migrations import migrate_homeroom
    if not store.client.encryption_enabled:
        raise ValueError('담임 출결은 암호화 연결을 완료한 뒤 저장해 주세요.')
    if type(expected_revision) is not int or expected_revision < 0:
        raise ValueError('기록 버전을 확인해 주세요.')
    date.fromisoformat(day)
    incoming = DiaryDay(revision=expected_revision + 1, events=events, curriculum='2022', decisions=decisions or {}, no_changes_confirmed=no_changes_confirmed)
    if any(e.practice and not (e.practice.start <= day <= e.practice.end) for e in incoming.events):
        raise ValueError("기록 날짜가 현장실습 기간에 포함되지 않습니다.")
    proposed = DiaryMonth(month=day[:7], records={day:{class_key:incoming}})
    roster = store.load_students()
    if not roster or class_key not in roster.classes:
        raise ValueError('학급이 삭제되었거나 명단이 없습니다. 명단을 다시 불러와 주세요.')
    allowed = {s.number for s in roster.classes.get(class_key, [])} if roster else set()
    if any(e.number not in allowed for e in incoming.events):
        raise ValueError('현재 학급 명단에 없는 학생이 있습니다. 명단을 확인해 주세요.')
    for _ in range(4):
        snapshot = store.client.read_snapshot(filename(proposed.month))
        document = DiaryMonth.model_validate(migrate_homeroom(snapshot.data)) if snapshot.data is not None else DiaryMonth(month=proposed.month)
        if document.month != proposed.month:
            raise ValueError('담임 기록의 월과 파일이 일치하지 않습니다.')
        current = document.records.get(day, {}).get(class_key, DiaryDay())
        if current == incoming:
            return current
        if current.revision != expected_revision:
            raise DriveConflictError('다른 기기에서 이 날짜의 담임 기록을 수정했습니다. 입력 내용을 보관한 뒤 최신 기록을 확인해 주세요.')
        document.records.setdefault(day, {})[class_key] = incoming
        try:
            store.client.write_snapshot(filename(proposed.month), document.model_dump(by_alias=True, mode='json'), snapshot)
            return incoming
        except PreconditionFailed:
            continue
    raise DriveConflictError('다른 기기에서 저장 중입니다. 다시 시도해 주세요.')


def purge_class_month(store, month, class_key):
    """CAS removal; retain concurrent changes belonging to other classes."""
    from subject_teacher.drive.migrations import migrate_homeroom
    for _ in range(4):
        snapshot = store.client.read_snapshot(filename(month))
        if snapshot.data is None:
            return
        document = DiaryMonth.model_validate(migrate_homeroom(snapshot.data))
        changed = False
        for day, classes in list(document.records.items()):
            if class_key in classes:
                del classes[class_key]
                changed = True
                if not classes:
                    del document.records[day]
        if not changed:
            return
        try:
            store.client.write_snapshot(filename(month), document.model_dump(by_alias=True, mode='json'), snapshot)
            return
        except PreconditionFailed:
            continue
    raise DriveConflictError('담임 기록 삭제 중 다른 기기에서 저장했습니다. 다시 시도해 주세요.')
