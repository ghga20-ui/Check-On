import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import {render, screen, waitFor, act} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
vi.mock('./lib/auth', () => ({
  usesServerAuth:true, AUTH_CHANGED:'checkon-auth-changed',
  hasValidAccessToken:vi.fn().mockReturnValue(false), initAuth:vi.fn().mockResolvedValue(undefined),
  isConfigured:vi.fn().mockReturnValue(true), requestAccessToken:vi.fn(), revoke:vi.fn(),
  restoreSession:vi.fn().mockResolvedValue('automatic-token'),
}));
vi.mock('./lib/driveData', () => ({
  loadAll:vi.fn().mockResolvedValue({settings:null,students:null,timetable:null,attendance:null}),
  loadMonthlyAttendance:vi.fn().mockResolvedValue(null),saveSlotAttendance:vi.fn(),
}));
vi.mock('./App', () => ({default:(props:{canSync?:boolean}) => <p>connected={String(props.canSync)}</p>}));
import Root from './Root';
import {restoreSession,requestAccessToken} from './lib/auth';
import {clearDriveCache} from './lib/localCache';
beforeEach(async()=>{vi.clearAllMocks();await clearDriveCache();});
it('restores an existing server login after reload with no login gesture or popup', async()=>{
  render(<Root/>);
  expect(await screen.findByText('connected=true')).toBeInTheDocument();
  expect(restoreSession).toHaveBeenCalledTimes(1);
  expect(requestAccessToken).not.toHaveBeenCalled();
});
it('automatically requests renewal when the app returns to the foreground',async()=>{
  render(<Root/>); await screen.findByText('connected=true');
  act(()=>window.dispatchEvent(new Event('pageshow')));
  await waitFor(()=>expect(restoreSession).toHaveBeenCalledTimes(2));
  expect(requestAccessToken).not.toHaveBeenCalled();
});
