from copy import deepcopy
from unittest.mock import MagicMock
import pytest
from pydantic import ValidationError
from subject_teacher.drive.homeroom import save_day, load_month, DiaryDay, DiaryMonth
from subject_teacher.drive.client import JsonSnapshot, PreconditionFailed, DriveAppDataClient
from subject_teacher.drive.concurrency import DriveConflictError
from subject_teacher.drive.migrations import migrate_homeroom, UnsupportedSchemaVersionError
from subject_teacher.drive.schemas import Students

DAY = '2026-09-14'
NAME = 'homeroom-2026-09.json'

def event(**changes):
    return dict(id='a', number=1, kind='late', category='illness', reason='진료 후 등교', startPeriod=2, endPeriod=2, **changes)

def setup():
    files = {}
    store = MagicMock()
    store.client.encryption_enabled = True
    store.load_students.return_value = Students(classes={'2-1':[{'number':1},{'number':2}]})
    store.client.read_snapshot.side_effect = lambda name: JsonSnapshot('f', 'v1', deepcopy(files.get(name)))
    store.client.write_snapshot.side_effect = lambda name, data, snapshot: files.update({name:deepcopy(data)})
    return store, files

def test_reason_roundtrip_and_second_edit_from_same_device():
    store, files = setup()
    first = event()
    early = {**first, 'id':'b', 'kind':'early', 'reason':'가정 사정', 'startPeriod':6, 'endPeriod':6}
    saved = save_day(store, DAY, '2-1', 0, [first])
    save_day(store, DAY, '2-1', saved.revision, [first, early])
    day = load_month(store, '2026-09').records[DAY]['2-1']
    assert day.revision == 2
    assert [e.reason for e in day.events] == ['진료 후 등교', '가정 사정']
    assert 'name' not in str(files)

def test_stale_conflict_retains_remote_and_same_request_retry_is_idempotent():
    store, files = setup()
    save_day(store, DAY, '2-1', 0, [event()])
    save_day(store, DAY, '2-1', 0, [event()])
    assert store.client.write_snapshot.call_count == 1
    with pytest.raises(DriveConflictError):
        save_day(store, DAY, '2-1', 0, [{**event(),'reason':'다른 입력'}])
    assert files[NAME]['records'][DAY]['2-1']['events'][0]['reason']=='진료 후 등교'

def test_cas_retry_retains_concurrent_other_class():
    store, files = setup()
    calls=[]
    def write(name, data, snapshot):
        calls.append(data)
        if len(calls)==1:
            files[name]=DiaryMonth(month='2026-09',records={DAY:{'2-9':DiaryDay()}}).model_dump(by_alias=True)
            raise PreconditionFailed('changed')
        files[name]=data
    store.client.write_snapshot.side_effect=write
    save_day(store, DAY, '2-1', 0, [event()])
    assert set(files[NAME]['records'][DAY])=={'2-1','2-9'}

@pytest.mark.parametrize('events', [[{**event(),'reason':'  '}], [event(),event()], [{**event(),'name':'합성학생'}], [{**event(),'startPeriod':0}], [event(),{**event(),'id':'b','kind':'absent','startPeriod':None,'endPeriod':None}]])
def test_reject_invalid_records(events):
    with pytest.raises(ValidationError):
        DiaryDay(events=events)

def test_requires_existing_roster_and_encryption():
    store, _=setup()
    with pytest.raises(ValueError):save_day(store,DAY,'2-2',0,[])
    with pytest.raises(ValueError):save_day(store,DAY,'2-1',0,[{**event(),'number':3}])
    store.client.encryption_enabled=False
    with pytest.raises(ValueError):save_day(store,DAY,'2-1',0,[event()])

def test_client_rejects_unencrypted_homeroom_write():
    client=DriveAppDataClient(service=MagicMock())
    with pytest.raises(ValueError):client.write_snapshot(NAME,{},JsonSnapshot(None,None,None))

def test_migration_copy_and_future_version():
    original={'schemaVersion':1,'records':{}}
    result=migrate_homeroom(original);result['records']['new']={}
    assert original['records']=={}
    with pytest.raises(UnsupportedSchemaVersionError):migrate_homeroom({'schemaVersion':4})
