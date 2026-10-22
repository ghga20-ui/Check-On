"""Homeroom automation entry, isolated from subject attendance sync flags."""
import config
import utils
from subject_teacher.state import build_store
from subject_teacher.app_service import create_driver
from subject_teacher.drive.homeroom import load_month, DiaryDay
from subject_teacher.homeroom_plan import build_plan
from subject_teacher.neis.homeroom_commands import HomeroomScreen, HomeroomScreenError, execute_plan


def load_plan(day, class_key):
    store=build_store()
    settings=store.load_settings()
    if settings is None:
        raise ValueError('기본 정보를 먼저 저장해 주세요.')
    roster=store.load_students()
    if not roster or class_key not in roster.classes:
        raise ValueError('학급 명단을 다시 확인해 주세요.')
    diary=load_month(store,day[:7]).records.get(day,{}).get(class_key,DiaryDay())
    allowed={s.number for s in roster.classes[class_key]}
    if any(e.number not in allowed for e in diary.events):
        raise ValueError('현재 명단에 없는 학생이 있습니다.')
    return build_plan(day,class_key,diary),settings.region


def run(day,class_key,expected_token,password,inspect_only=False,loader=load_plan):
    plan,region=loader(day,class_key)
    if plan['token']!=expected_token:
        raise ValueError('담임 기록이 바뀌었습니다. 다시 검토해 주세요.')
    if plan['errors'] and not inspect_only:
        raise ValueError('\n'.join(plan['errors']))
    config.selected_region=region
    driver=create_driver(keep_browser_open=True)
    screen=HomeroomScreen(driver)
    def still_current():
        fresh,_=loader(day,class_key)
        if fresh['token']!=expected_token:
            raise HomeroomScreenError('실행 중 체크온 기록이 변경됐습니다. 나이스 화면과 최신 기록을 비교해 주세요.')
    try:
        utils.open_neis_direct(driver,password)
        return execute_plan(screen,plan,inspect_only=inspect_only,still_current=still_current)
    except Exception as exc:
        try:screen.diagnose()
        except Exception:pass
        if isinstance(exc,HomeroomScreenError):raise
        # Selenium exceptions can contain DOM values. Keep them out of GUI logs.
        raise HomeroomScreenError('담임 화면 연결 또는 입력 확인에 실패했습니다. 열어 둔 나이스 화면을 확인해 주세요. 다음 학생이나 출결마감으로 진행하지 않았습니다.') from None
    finally:
        # Leave Chrome attached to the visible page for review, release the driver.
        try:driver.service.stop()
        except Exception:pass
