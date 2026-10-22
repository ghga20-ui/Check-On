import {beforeEach,it,expect,vi} from 'vitest';
import {mobileHomeApi} from './homeroom';
import {readJsonSnapshot,writeJsonSnapshot,DriveConflictError,DriveError} from './drive';
import {loadStudents} from './driveData';
vi.mock('./drive',async original=>({...await original<typeof import('./drive')>(),readJsonSnapshot:vi.fn(),writeJsonSnapshot:vi.fn()}));
vi.mock('./driveData',()=>({loadStudents:vi.fn()}));
const event={id:'a',number:1,kind:'late' as const,category:'illness' as const,reason:'진료',startPeriod:2,endPeriod:2};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(loadStudents).mockResolvedValue({schemaVersion:1,classes:{'2-1':[{number:1,name:''}]}});vi.mocked(readJsonSnapshot).mockResolvedValue({id:'f',etag:'v1',data:null});});
it('saves reason and revision and preserves another class',async()=>{
 vi.mocked(readJsonSnapshot).mockResolvedValue({id:'f',etag:'v1',data:{schemaVersion:1,month:'2026-09',records:{'2026-09-14':{'2-9':{revision:1,events:[]}}}}});
 expect(await mobileHomeApi.save('2026-09-14','2-1',{revision:0,events:[event]})).toEqual({revision:1,events:[event],curriculum:'2022'});
 expect(vi.mocked(writeJsonSnapshot).mock.calls[0][1]).toMatchObject({records:{'2026-09-14':{'2-9':{revision:1},'2-1':{events:[event]}}}});
});
it('stale changes do not overwrite remote reasons',async()=>{
 vi.mocked(readJsonSnapshot).mockResolvedValue({id:'f',etag:'v1',data:{schemaVersion:1,month:'2026-09',records:{'2026-09-14':{'2-1':{revision:2,events:[event]}}}}});
 await expect(mobileHomeApi.save('2026-09-14','2-1',{revision:0,events:[event]})).rejects.toBeInstanceOf(DriveConflictError);expect(writeJsonSnapshot).not.toHaveBeenCalled();
});
it('same successful request may safely be retried after lost response',async()=>{
 vi.mocked(readJsonSnapshot).mockResolvedValue({id:'f',etag:'v1',data:{schemaVersion:1,month:'2026-09',records:{'2026-09-14':{'2-1':{revision:1,events:[event],curriculum:'2022'}}}}});
 await mobileHomeApi.save('2026-09-14','2-1',{revision:0,events:[event]});expect(writeJsonSnapshot).not.toHaveBeenCalled();
});
it('retries server precondition conflicts and rejects deleted roster',async()=>{
 vi.mocked(writeJsonSnapshot).mockRejectedValueOnce(new DriveError(412,'changed')).mockResolvedValue(undefined);
 await mobileHomeApi.save('2026-09-14','2-1',{revision:0,events:[event]});expect(writeJsonSnapshot).toHaveBeenCalledTimes(2);
 vi.mocked(loadStudents).mockResolvedValue({schemaVersion:1,classes:{}});
 await expect(mobileHomeApi.save('2026-09-14','2-1',{revision:0,events:[event]})).rejects.toThrow();
});
it('bounds history dates before any Drive request',async()=>{
 await expect(mobileHomeApi.history('2025-01-01','2026-09-14','2-1')).rejects.toThrow('366');expect(readJsonSnapshot).not.toHaveBeenCalled();
});
