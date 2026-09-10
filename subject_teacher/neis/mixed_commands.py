"""Fail-closed mixed roster automation; no number-only selector is used.

Only a fully materialized accessible grid is supported. Virtual grids without
an accurate row count require live inspection before adding a scrolling adapter.
"""
from __future__ import annotations

from selenium.webdriver.support.ui import WebDriverWait


# Derive column mapping from visible headers, never legacy fixed cell indices.
GRID_SNAPSHOT = r"""
const visible = el => {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
};
const text = el => (el.innerText || el.textContent || '').trim();
const key = el => el.hasAttribute('data-cellindex') ? 'data:' + el.getAttribute('data-cellindex') :
  el.hasAttribute('aria-colindex') ? 'aria:' + el.getAttribute('aria-colindex') : null;
const result = [];
for (const grid of document.querySelectorAll('[role="grid"]')) {
  if (!visible(grid)) continue;
  const headers = [...grid.querySelectorAll('[role="columnheader"]')].filter(visible);
  const names = ['학년', '반', '번호', '출석상태'];
  const columns = names.map(name => headers.filter(h => text(h).replace(/\s/g, '') === name));
  if (!columns.every(c => c.length === 1 && key(c[0]))) continue;
  const keys = columns.map(c => key(c[0]));
  if (new Set(keys).size !== 4) continue;
  const rows = [...grid.querySelectorAll('[role="row"]')].filter(r => r.closest('[role="grid"]') === grid && visible(r));
  const headerRows = rows.filter(r => r.querySelector('[role="columnheader"]')).length;
  const dataRows = rows.filter(r => r.querySelector('[role="gridcell"]'));
  const count = Number(grid.getAttribute('aria-rowcount'));
  // ARIA rowcount includes header rows. Unknown or partially rendered => stop.
  if (!grid.hasAttribute('aria-rowcount') || count !== dataRows.length + headerRows) continue;
  const values = dataRows.map(row => {
    const cells = [...row.querySelectorAll('[role="gridcell"]')];
    const selected = keys.map(k => cells.filter(c => key(c) === k));
    if (!selected.every(c => c.length === 1 && visible(c[0]))) return null;
    const [grade, home, number, status] = selected.map(c => c[0]);
    const input = status.querySelector('input');
    const mark = input ? input.value : text(status);
    return {grade: text(grade), homeClassNo: text(home), number: text(number), mark, cell: status};
  });
  if (values.every(Boolean)) result.push(values);
}
return result;
"""


def resolve_targets(slot, attendance, groups):
    group = groups.get(attendance.group_id)
    if group is None:
        raise RuntimeError("혼합수업 명부를 찾을 수 없습니다.")
    if (slot.grade, str(slot.class_no)) != (group.grade, str(group.class_no)) or slot.subject_name not in {
        group.subject_name, getattr(group, "neis_subject_label", "")
    } - {""}:
        raise RuntimeError("출결의 혼합수업과 선택한 수업이 일치하지 않습니다.")
    if getattr(slot, "group_id", None) not in {None, group.id}:
        raise RuntimeError("시간표의 혼합수업 연결이 일치하지 않습니다.")
    revision = attendance.roster_revision
    roster = group.students if revision == group.revision else group.history.get(str(revision))
    if not roster:
        raise RuntimeError("출결 당시 명부 이력을 찾을 수 없습니다.")
    marks = {item.student_id: item.mark_type.value for item in attendance.absences}
    if len(marks) != len(attendance.absences) or not set(marks).issubset({s.student_id for s in roster}):
        raise RuntimeError("출결 학생이 명부 이력과 일치하지 않습니다.")
    targets = [(s.grade, str(s.home_class_no), s.number, marks.get(s.student_id, "present")) for s in roster]
    if len({t[:3] for t in targets}) != len(targets):
        raise RuntimeError("명부의 학년·반·번호가 중복되었습니다.")
    return targets


def _mark(value):
    value = str(value).strip()
    if value == "":
        return "present"
    if value == "/":
        return "absent"
    if value in {"Ø", "∅", "ø"}:
        return "excused"
    raise RuntimeError("학생 출석상태 표시를 정확히 해석할 수 없습니다.")


def preflight(driver, targets):
    grids = driver.execute_script(GRID_SNAPSHOT)
    if not isinstance(grids, list) or len(grids) != 1:
        raise RuntimeError("학년·반·번호·출석상태 열과 전체 학생 행을 확인할 수 없습니다. 화면을 직접 확인해 주세요.")
    rows = grids[0]
    resolved = []
    for grade, home, number, desired in targets:
        matches = [r for r in rows if (str(r['grade']).strip(), str(r['homeClassNo']).strip(), str(r['number']).strip()) == (str(grade), str(home), str(number))]
        if len(matches) != 1:
            raise RuntimeError(f"{grade}학년 {home}반 {number}번: 일치 행이 {len(matches)}개여서 입력을 중단했습니다.")
        row = matches[0]
        resolved.append((row['cell'], _mark(row['mark']), desired))
    return resolved


def verify_targets(driver, targets):
    if any(actual != desired for _, actual, desired in preflight(driver, targets)):
        raise RuntimeError("학생별 저장 상태가 출결 기록과 일치하지 않습니다.")


def _click(driver, cell):
    # No retry/fallback after mouse-down: an exception can mean a partial write.
    point = driver.execute_script("const r=arguments[0].getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};", cell)
    for action in ("mousePressed", "mouseReleased"):
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", dict(type=action, x=point['x'], y=point['y'], button="left", clickCount=1))


def apply_targets(driver, targets, cmd):
    for target in targets:
        cell, actual, desired = preflight(driver, [target])[0]
        if actual == desired:
            continue
        if actual != "present":
            cmd.ensure_excused_mode(driver, actual == "excused")
            _click(driver, cell)
            WebDriverWait(driver, 3).until(lambda d: preflight(d, [target])[0][1] == "present")
        if desired != "present":
            cmd.ensure_excused_mode(driver, desired == "excused")
            cell = preflight(driver, [target])[0][0]
            _click(driver, cell)
            WebDriverWait(driver, 3).until(lambda d: preflight(d, [target])[0][1] == desired)
    verify_targets(driver, targets)
