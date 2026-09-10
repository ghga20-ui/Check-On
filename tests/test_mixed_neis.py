"""Synthetic records/DOM only; no browser profile, Drive or credentials."""
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import MagicMock

import pytest

from subject_teacher.neis import mixed_commands as mixed
from subject_teacher.neis.runner import DayInput, process_day
from subject_teacher.drive.schemas import SlotAttendance, TimetableSlot
from subject_teacher.app_service import build_day_input


def fixtures():
    students = [NS(student_id='a', grade=2, home_class_no='1', number=5),
                NS(student_id='b', grade=2, home_class_no='3', number=5)]
    group = NS(id='g', grade=2, class_no='선택A', subject_name='문학', revision=2,
               students=students[:1], history={'1': students})
    slot = TimetableSlot(id='s', dayOfWeek=4, period=1, grade=2, classNo='선택A', subjectName='문학', neisSubjectLabel='문학')
    attendance = SlotAttendance(groupId='g', rosterRevision=1, absences=[
        {'studentId': 'a', 'markType': 'absent'}, {'studentId': 'b', 'markType': 'excused'}],
        checkedAt='2026-09-10T01:00:00Z', source='mobile')
    return slot, attendance, {'g': group}


def rows():
    return [dict(grade='2', homeClassNo='1', number='5', mark='', cell='a'),
            dict(grade='2', homeClassNo='3', number='5', mark='', cell='b')]


def test_history_resolves_same_number_distinct_students():
    slot, record, groups = fixtures()
    assert mixed.resolve_targets(slot, record, groups) == [(2, '1', 5, 'absent'), (2, '3', 5, 'excused')]
    slot.class_no = '다른반'
    with pytest.raises(RuntimeError, match='일치'):
        mixed.resolve_targets(slot, record, groups)


def test_build_day_input_loads_mixed_document_only_when_needed():
    slot, attendance, groups = fixtures()
    store = MagicMock()
    store.load_timetable.return_value = NS(slots=[slot])
    store.load_monthly.return_value = NS(records={'2026-09-10': {'s': attendance}})
    store.load_mixed_groups.return_value = NS(groups=groups)
    settings = NS(semester=NS(year=2026, term=2))
    day = build_day_input(store, settings, '2026-09-10')
    assert day.mixed_groups == groups
    store.load_mixed_groups.assert_called_once()
    store.reset_mock()
    store.load_monthly.return_value = NS(records={'2026-09-10': {'s': SlotAttendance(
        absences=[], checkedAt='2026-09-10T01:00:00Z', source='mobile')}})
    assert build_day_input(store, settings, '2026-09-10').mixed_groups is None
    store.load_mixed_groups.assert_not_called()


@pytest.mark.parametrize('change', ['missing', 'duplicate', 'unknown_mark'])
def test_preflight_fails_without_mutation(change):
    grid = rows()
    if change == 'missing': grid.pop()
    if change == 'duplicate': grid.append(dict(grid[0]))
    if change == 'unknown_mark': grid[0]['mark'] = '?'
    driver = MagicMock()
    driver.execute_script.return_value = [grid]
    with pytest.raises(RuntimeError):
        mixed.preflight(driver, mixed.resolve_targets(*fixtures()))
    driver.execute_cdp_cmd.assert_not_called()


def test_exact_marks_and_idempotency():
    grid = rows()
    driver, cmd = MagicMock(), MagicMock()
    mode = [False]
    def script(code, *args):
        return [grid] if code == mixed.GRID_SNAPSHOT else {'x': args[0], 'y': 0}
    driver.execute_script.side_effect = script
    cmd.ensure_excused_mode.side_effect = lambda d, on: mode.__setitem__(0, on)
    def click(method, data):
        if data['type'] == 'mouseReleased':
            row = next(r for r in grid if r['cell'] == data['x'])
            row['mark'] = '' if row['mark'] else ('Ø' if mode[0] else '/')
    driver.execute_cdp_cmd.side_effect = click
    targets = mixed.resolve_targets(*fixtures())
    mixed.apply_targets(driver, targets, cmd)
    assert [r['mark'] for r in grid] == ['/', 'Ø']
    count = driver.execute_cdp_cmd.call_count
    mixed.apply_targets(driver, targets, cmd)
    assert driver.execute_cdp_cmd.call_count == count
    grid[0]['mark'], grid[1]['mark'] = 'Ø', '/'
    with pytest.raises(RuntimeError, match='일치'):
        mixed.verify_targets(driver, targets)
    mixed.apply_targets(driver, targets, cmd)
    assert [r['mark'] for r in grid] == ['/', 'Ø']
    present = [(grade, home, number, 'present') for grade, home, number, _ in targets]
    mixed.apply_targets(driver, present, cmd)
    assert [r['mark'] for r in grid] == ['', '']


@pytest.mark.parametrize('failure, expected_selects', [('preflight', 2), ('write', 1), ('save', 1), ('verify', 1)])
def test_runner_failure_isolation_and_dirty_stop(monkeypatch, failure, expected_selects):
    slot, attendance, groups = fixtures()
    second = slot.model_copy(update={'id': 's2', 'period': 2})
    day = DayInput('2026-09-10', 2026, 2, [(slot, attendance), (second, attendance)], groups)
    cmd, callback = MagicMock(), MagicMock()
    cmd.click_save.return_value = 'saved'
    for name in ('preflight', 'apply_targets', 'verify_targets'):
        monkeypatch.setattr(mixed, name, MagicMock())
    selected = {'preflight': mixed.preflight, 'write': mixed.apply_targets, 'save': cmd.click_save, 'verify': mixed.verify_targets}[failure]
    selected.side_effect = RuntimeError('synthetic failure')
    results = process_day(MagicMock(), day, False, cmd, callback)
    assert [r.status for r in results] == ['failed', 'failed']
    assert cmd.select_period.call_count == expected_selects
    cmd.click_reset.assert_not_called()
    callback.assert_not_called()
    if failure in {'preflight', 'write'}: cmd.click_save.assert_not_called()


def test_runner_checks_saved_rows_before_snapshot_callback(monkeypatch):
    slot, attendance, groups = fixtures()
    original = attendance.model_dump()
    events = []
    for name in ('preflight', 'apply_targets', 'verify_targets'):
        monkeypatch.setattr(mixed, name, lambda *a, n=name: events.append(n))
    cmd = MagicMock()
    cmd.click_save.side_effect = lambda *a: events.append('save') or 'saved'
    result = process_day(MagicMock(), DayInput('2026-09-10', 2026, 2, [(slot, attendance)], groups), False,
                         cmd, lambda *a, **kw: events.append('update'))
    assert result[0].status == 'ok'
    assert events == ['preflight', 'apply_targets', 'save', 'verify_targets', 'update']
    assert attendance.model_dump() == original


def test_dynamic_headers_against_synthetic_dom():
    node = shutil.which('node')
    module = Path(__file__).parents[1] / 'subject_teacher/neis_attendance/node_modules/jsdom'
    if not node or not module.exists():
        pytest.skip('DOM test requires frontend jsdom and Node')
    # Deliberately shuffled indices; no legacy indices or text-number fallback.
    html = '''<div role="grid" aria-rowcount="3"><div role="row">
    <div role="columnheader" data-cellindex="21">번호</div>
    <div role="columnheader" data-cellindex="13">반</div>
    <div role="columnheader" data-cellindex="42">출석상태</div>
    <div role="columnheader" data-cellindex="11">학년</div></div>'''
    for home, mark in [('1', '/'), ('3', 'Ø')]:
        html += f'''<div role="row"><div role="gridcell" data-cellindex="21">5</div>
        <div role="gridcell" data-cellindex="13">{home}</div>
        <div role="gridcell" data-cellindex="42">{mark}</div>
        <div role="gridcell" data-cellindex="11">2</div></div>'''
    html += '</div>'
    script = '''const {JSDOM}=require(process.argv[1]);
    const data=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const dom=new JSDOM(data.html,{runScripts:'outside-only'});
    dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:20});
    const run=()=>dom.window.eval('(function(){'+data.script+'})()');
    const first=run();
    dom.window.document.querySelector('[role=grid]').setAttribute('aria-rowcount','30');
    const virtual=run();
    console.log(JSON.stringify({first,virtual}));'''
    run = subprocess.run([node, '-e', script, str(module)], input=json.dumps({'html': html, 'script': mixed.GRID_SNAPSHOT}),
                         text=True, encoding='utf-8', capture_output=True, check=True)
    value = json.loads(run.stdout)
    assert [(r['homeClassNo'], r['number'], r['mark']) for r in value['first'][0]] == [('1', '5', '/'), ('3', '5', 'Ø')]
    assert value['virtual'] == []
