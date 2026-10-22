"""Local synthetic DOM smoke test. Does not access NEIS or Google Drive."""
from pathlib import Path
from unittest.mock import patch
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from subject_teacher.drive.homeroom import DiaryDay
from subject_teacher.homeroom_plan import build_plan
from subject_teacher.neis.homeroom_commands import HomeroomScreen, HomeroomScreenError, execute_plan


def main():
    options=Options();options.add_argument('--headless=new');options.add_argument('--window-size=1280,900')
    driver_path=Path.home()/'.cache/selenium/chromedriver/win64/153.0.8010.36/chromedriver.exe'
    driver=webdriver.Chrome(service=Service(str(driver_path)),options=options)
    fixture=Path(__file__).resolve().parents[2]/'tests/fixtures/homeroom_daily.html'
    event=dict(id='a',number=1,kind='late',category='illness',reason='합성 진료 사유',startPeriod=2,endPeriod=2)
    plan=build_plan('2026-09-16','2-1',DiaryDay(curriculum='2022',events=[event]))
    try:
        with patch('utils.neis_go_menu'):
            driver.get(fixture.as_uri())
            result=execute_plan(HomeroomScreen(driver),plan)
            assert result['saved'] and not result['closed']
            assert driver.execute_script('return saves')==1
            # Repeat is idempotent: existing slash must not be toggled away.
            execute_plan(HomeroomScreen(driver),plan)
            assert HomeroomScreen(driver).snapshot(1)['조회']=='/'
            driver.get(fixture.as_uri());driver.execute_script('window.corrupt=true')
            try:execute_plan(HomeroomScreen(driver),plan)
            except HomeroomScreenError:pass
            else:raise AssertionError('Changed course period was not detected')
            assert driver.execute_script('return saves')==0
            driver.get(fixture.as_uri())
            event.update(kind='absent',category='excused',startPeriod=None,endPeriod=None)
            plan=build_plan('2026-09-16','2-1',DiaryDay(curriculum='2022',events=[event]))
            execute_plan(HomeroomScreen(driver),plan)
            actual=HomeroomScreen(driver).snapshot(1)
            assert actual['조회']==actual['종례']==actual['마감']==''
            assert '합성 진료 사유' in actual['사유']
        print('Synthetic DOM: save/readback, retry, protected periods, excused reason-only passed.')
    finally:
        driver.quit()


if __name__=='__main__':main()
