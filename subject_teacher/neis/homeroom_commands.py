"""Conservative, semantic selectors for the manual's daily homeroom screen.

No production DOM was available. Unknown/ambiguous structures fail closed;
never borrow the subject grid's numeric cell indexes or screen coordinates.
"""
import json
import re
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoAlertPresentException
from subject_teacher.neis import subject_commands as shared
from subject_teacher.paths import get_app_data_dir


class HomeroomScreenError(RuntimeError):
    pass


def visible(elements):
    return [e for e in elements if e.is_displayed()]


def one(elements, description):
    found = visible(elements)
    if len(found) != 1:
        raise HomeroomScreenError(f'{description}을 하나로 확인할 수 없습니다. 담임 화면 구조 확인이 필요합니다.')
    return found[0]


def text(element):
    inputs = visible(element.find_elements(By.CSS_SELECTOR, 'input,textarea,select'))
    if len(inputs) == 1:
        return (inputs[0].get_attribute('value') or '').strip()
    return (element.get_attribute('value') or element.text or '').strip()


def exact_button(root, label):
    literal = shared._xpath_literal(label)
    return one(root.find_elements(By.XPATH,
        f".//*[self::button or @role='button' or @role='tab'][normalize-space(.)={literal} or @aria-label={literal}]"), label+' 버튼')


class HomeroomScreen:
    def __init__(self, driver):
        self.driver = driver

    def diagnose(self):
        # Only structural counts and allowlisted labels. Never save DOM/values/names.
        labels = ['번호','마감','조회','종례','사유','일일출결관리(담임용)','출결마감구분']
        info = self.driver.execute_script('''
          const visible=e=>!!(e.getClientRects().length);
          const elements=[...document.querySelectorAll('[role],input,textarea,select,table')].filter(visible);
          return {roles:elements.reduce((a,e)=>{let k=e.getAttribute('role')||e.tagName.toLowerCase();a[k]=(a[k]||0)+1;return a},{}),
            labels:arguments[0].filter(s=>elements.some(e=>(e.getAttribute('aria-label')||e.textContent||'').trim()===s))};
        ''', labels)
        (get_app_data_dir()/'tmp_homeroom_structure.json').write_text(json.dumps(info,ensure_ascii=False),encoding='utf-8')

    def prepare(self, plan):
        import utils
        utils.neis_go_menu(self.driver, '학급담임', '학적', '출결관리')
        # The menu and tab can have the same label; only an explicit tab is accepted.
        tabs = self.driver.find_elements(By.XPATH, "//*[@role='tab' and normalize-space(.)='일일출결관리(담임용)']")
        if not visible(tabs):
            tabs = self.driver.find_elements(By.XPATH, "//*[self::button or @role='button'][normalize-space(.)='일일출결관리(담임용)']")
        one(tabs, '일일출결관리(담임용)').click()
        self.assert_class(plan)
        shared.select_date(self.driver, plan['date'])
        self.refresh()
        self.assert_context(plan)

    def field(self, label):
        literal=shared._xpath_literal(label)
        return one(self.driver.find_elements(By.XPATH,
            f"//*[@aria-label={literal} and (self::input or self::select or @role='combobox')]"),label)

    def assert_class(self, plan):
        year=text(self.field('학년도'))
        grade=text(self.field('계열/학년/학과'))
        class_no=text(self.field('반'))
        if year not in (str(plan['year']),f"{plan['year']}학년도") or grade not in (str(plan['grade']),f"{plan['grade']}학년") or class_no not in (plan['classNo'],plan['classNo']+'반'):
            raise HomeroomScreenError('나이스 학년도·학년·반이 다르거나 계열/학과가 모호합니다. 해당 학급을 직접 선택한 뒤 다시 점검해 주세요.')

    def assert_context(self, plan):
        self.assert_class(plan)
        if not shared._date_value_matches(self.driver, shared.parse_neis_date_label(plan['date'])):
            raise HomeroomScreenError('나이스 조회 날짜가 일치하지 않습니다.')

    def grid(self):
        matches=[]
        for grid in visible(self.driver.find_elements(By.CSS_SELECTOR,'[role="grid"],table')):
            headers=visible(grid.find_elements(By.CSS_SELECTOR,'[role="columnheader"],th'))
            names=[h.text.strip() for h in headers]
            if all(names.count(n)==1 for n in ['번호','마감','조회','종례','사유']):
                matches.append(grid)
        return one(matches,'담임 출결 표')

    def cells(self, number):
        grid=self.grid()
        headers=visible(grid.find_elements(By.CSS_SELECTOR,'[role="columnheader"],th'))
        names=[h.text.strip() for h in headers]
        candidates=[]
        for row in visible(grid.find_elements(By.CSS_SELECTOR,'[role="row"],tr')):
            cells=visible(row.find_elements(By.CSS_SELECTOR,'[role="gridcell"],td'))
            if not cells:
                continue
            # Index attributes must be present on both header and body; otherwise
            # require a complete, flat native row. Virtualized fragments are rejected.
            mapping={}
            for attr in ('aria-colindex','data-cellindex'):
                indexes=[h.get_attribute(attr) for h in headers]
                if all(i is not None for i in indexes) and len(set(indexes))==len(indexes):
                    by_index={c.get_attribute(attr):c for c in cells}
                    if all(i in by_index for i in indexes):
                        mapping={name:by_index[i] for name,i in zip(names,indexes)}
                        break
            if not mapping and len(cells)==len(headers) and all(c.tag_name=='td' for c in cells):
                mapping=dict(zip(names,cells))
            if mapping and text(mapping['번호'])==str(number):
                candidates.append(mapping)
        if len(candidates)!=1:
            raise HomeroomScreenError(f'{number}번 학생 행을 하나로 확인하지 못했습니다. 입력하지 않았습니다.')
        return candidates[0]

    def snapshot(self, number):
        return {key:text(cell) for key,cell in self.cells(number).items() if key!='성명'}

    def preflight(self, row):
        before=self.snapshot(row['number'])
        targets={'조회':'/' if row['morningAbsent'] else '', '종례':'/' if row['afternoonAbsent'] else '',
                 '마감':row['classification'],'사유':row['reason']}
        for key,value in targets.items():
            if before.get(key) not in ('',value):
                raise HomeroomScreenError(f"{row['number']}번 기존 {key} 내용이 다릅니다. 나이스에서 비교·수정한 뒤 다시 실행해 주세요.")
        if row['practice']:
            raise HomeroomScreenError('현장실습의 학생 등록 여부·기간 팝업 구조는 실화면 확인이 필요합니다. 기간과 기관을 확인하고 나이스의 현장실습/인정결 기능으로 적용해 주세요.')
        if not row['periodsReadOnly']:
            raise HomeroomScreenError('2015 개정의 교시별 결시 입력은 실제 시간표와 화면 검증 후 연결합니다. 최종 구분·사유 검토는 사용할 수 있습니다.')
        return before

    def mark(self, number, column, desired):
        cell=self.cells(number)[column]
        if text(cell)==desired:
            return
        if text(cell) or desired!='/':
            raise HomeroomScreenError('기존 출결을 자동 삭제하지 않습니다.')
        shared._click_grid_cell(self.driver,cell)
        WebDriverWait(self.driver,5).until(lambda _:text(self.cells(number)[column])==desired)

    def fill(self, cell, value):
        inputs=visible(cell.find_elements(By.CSS_SELECTOR,'input:not([type=hidden]),textarea'))
        if not inputs:
            cell.click()
            inputs=visible(cell.find_elements(By.CSS_SELECTOR,'input:not([type=hidden]),textarea'))
        entry=one(inputs,'사유 입력란')
        limit=entry.get_attribute('maxlength')
        if limit and int(limit)>0 and len(value)>int(limit):
            raise HomeroomScreenError('사유가 나이스 입력란의 허용 길이를 넘습니다. 줄인 뒤 다시 저장해 주세요.')
        entry.send_keys(Keys.CONTROL,'a');entry.send_keys(value);entry.send_keys(Keys.TAB)
        if text(cell)!=value:
            raise HomeroomScreenError('사유 입력 결과가 일치하지 않습니다.')

    def apply(self,row):
        number=row['number']
        self.mark(number,'조회','/' if row['morningAbsent'] else '')
        self.mark(number,'종례','/' if row['afternoonAbsent'] else '')
        cells=self.cells(number)
        if row['kind'] and text(cells['마감'])!=row['classification']:
            cells['마감'].click()
            dialog=one(self.driver.find_elements(By.XPATH,"//*[@role='dialog' and (.//*[normalize-space(.)='출결마감구분'] or @aria-label='출결마감구분')]"),'출결마감구분 창')
            for label in (row['kind'],row['category']):
                literal=shared._xpath_literal(label)
                radio=one(dialog.find_elements(By.XPATH,f".//*[@role='radio' and (normalize-space(.)={literal} or @aria-label={literal})] | .//label[normalize-space(.)={literal}]/input[@type='radio']"),label)
                if radio.get_attribute('aria-checked')!='true' and not radio.is_selected():radio.click()
                if radio.get_attribute('aria-checked')!='true' and not radio.is_selected():raise HomeroomScreenError('출결 구분 선택을 확인하지 못했습니다.')
            reason=one(dialog.find_elements(By.CSS_SELECTOR,'input[aria-label="사유"],textarea[aria-label="사유"]'),'팝업 사유')
            limit=reason.get_attribute('maxlength')
            if limit and int(limit)>0 and len(row['reason'])>int(limit):raise HomeroomScreenError('사유 길이를 줄여 주세요.')
            reason.send_keys(Keys.CONTROL,'a');reason.send_keys(row['reason'])
            if reason.get_attribute('value')!=row['reason']:raise HomeroomScreenError('팝업 사유 확인 실패')
            exact_button(dialog,'적용').click()
            WebDriverWait(self.driver,5).until(EC.invisibility_of_element(dialog))
        if text(self.cells(number)['사유'])!=row['reason']:
            self.fill(self.cells(number)['사유'],row['reason'])

    def verify(self,row,before):
        after=self.snapshot(row['number'])
        expected={'마감':row['classification'],'사유':row['reason'],'조회':'/' if row['morningAbsent'] else '', '종례':'/' if row['afternoonAbsent'] else ''}
        if any(after.get(k)!=v for k,v in expected.items()):
            raise HomeroomScreenError('입력 후 출결·사유가 계획과 일치하지 않습니다. 저장 완료로 처리하지 않습니다.')
        if any(after.get(k)!=v for k,v in before.items() if re.fullmatch(r'\d+교시',k)):
            raise HomeroomScreenError('교과 교시가 변경되었습니다. 다음 학생으로 진행하지 않습니다.')

    def save(self):
        exact_button(self.driver,'저장').click()
        def notice(_):
            try:
                alert=self.driver.switch_to.alert
                message=alert.text
                if any(s in message for s in ('저장했습니다','저장되었습니다','저장하였습니다','변경된 내용이 없습니다')):
                    alert.accept()
                    return 'saved'
                if '저장하시겠습니까' in message:
                    alert.accept()
                    return False
                raise HomeroomScreenError('예상하지 못한 저장 안내가 나타났습니다. 화면을 확인해 주세요.')
            except NoAlertPresentException:
                pass
            result=shared._click_neis_save_notice_ok(self.driver)
            if result:return result
            shared._click_neis_save_confirm(self.driver)
            return False
        WebDriverWait(self.driver,12).until(notice)
        shared._wait_for_save_completion(self.driver,acknowledged=True)

    def refresh(self):
        try:
            previous = visible(self.grid().find_elements(By.CSS_SELECTOR, '[role=gridcell],td'))
        except HomeroomScreenError:
            previous = []
        exact_button(self.driver,'조회').click()
        if previous:
            # Do not mistake the pre-query table for persisted readback.
            WebDriverWait(self.driver,10).until(EC.staleness_of(previous[0]))
        WebDriverWait(self.driver,10).until(lambda _:self.grid())


def execute_plan(screen, plan, *, inspect_only=False, still_current=lambda:None):
    if plan['errors'] and not inspect_only:
        raise HomeroomScreenError('\n'.join(plan['errors']))
    screen.prepare(plan)
    screen.assert_context(plan)
    if inspect_only:
        screen.grid()
        return {'status':'inspected','saved':False,'closed':False}
    # Complete every row's preflight before the first mutation.
    baseline={row['number']:screen.preflight(row) for row in plan['rows']}
    still_current()
    for row in plan['rows']:
        screen.assert_context(plan)
        # Catch changes since the initial preflight, before touching that row.
        if screen.snapshot(row['number'])!=baseline[row['number']]:
            raise HomeroomScreenError('실행 중 화면 기록이 변경되었습니다. 저장 전에 중단했습니다.')
        screen.apply(row)
        screen.verify(row,baseline[row['number']])
    still_current()
    screen.save()
    screen.refresh()
    screen.assert_context(plan)
    for row in plan['rows']:
        screen.verify(row,baseline[row['number']])
    still_current()
    return {'status':'saved','saved':True,'closed':False}
