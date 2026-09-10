import { createMockApi } from "./mock-api";

export interface DesktopApi {
  get_settings(): Promise<string>;
  save_settings(json: string): Promise<string>;
  get_timetable_tsv(): Promise<string>;
  save_timetable_tsv(tsv: string, effectiveFrom: string): Promise<string>;
  get_students_tsv(): Promise<string>;
  save_students_tsv(tsv: string): Promise<string>;
  get_today_slots(dateStr: string, force?: boolean): Promise<string>;
  save_slot_attendance(dateStr: string, slotId: string, marksJson: string, expectedCheckedAt?: string, groupId?: string | null, rosterRevision?: number | null): Promise<string>;
  get_mixed_groups(): Promise<string>;
  save_mixed_group(payloadJson: string): Promise<string>;
  import_mixed_students_file(grade: number): Promise<string>;
  delete_slot_attendance(dateStr: string, slotId: string): Promise<string>;
  get_drive_user(): Promise<string>;
  get_neis_api_key(): Promise<string>;
  save_neis_api_key(apiKey: string): Promise<string>;
  get_password(): Promise<string>;
  save_password(pw: string): Promise<void>;
  import_students_file(classKey: string): Promise<string>;
  search_schools(payloadJson: string): Promise<string>;
  preview_neis_public_timetable(payloadJson: string): Promise<string>;
  publish_neis_timetable_for_week(dateStr: string): Promise<string>;
  find_neis_subject_candidates(payloadJson: string): Promise<string>;
  start_run(dateStr: string, password: string, closeAfter: boolean): Promise<string>;
  reconnect(): Promise<string>;
  get_sync_encryption_status(): Promise<string>;
  enable_sync_encryption(): Promise<string>;
  get_pairing_payload(): Promise<string>;
  get_recovery_code(): Promise<string>;
  restore_from_recovery_code(code: string): Promise<string>;
  reissue_sync_key(): Promise<string>;
}

/** A log line pushed from Python via evaluate_js("window.__pushLog(...)"). */
export interface BridgeLogEntry {
  lv: string;
  msg: string;
}

/** A progress update pushed from Python during a NEIS run. */
export interface BridgeProgress {
  done: number;
  total: number;
  current: string;
  state: string;
}

declare global {
  interface Window {
    pywebview?: { api: DesktopApi };
    __logCallbacks: Array<(entry: BridgeLogEntry) => void>;
    __progressCallbacks: Array<(progress: BridgeProgress) => void>;
    __pywebviewReadyCallbacks: Array<() => void>;
    __pushLog: (entry: BridgeLogEntry) => void;
    __pushProgress: (progress: BridgeProgress) => void;
    __registerBridge: (onLog: (entry: BridgeLogEntry) => void, onProgress: (progress: BridgeProgress) => void) => void;
    __isPywebview: () => boolean;
    __onPywebviewReady: (callback: () => void) => void;
  }
}

window.__logCallbacks = [];
window.__progressCallbacks = [];
window.__pywebviewReadyCallbacks = [];

window.__pushLog = (entry) => {
  window.__logCallbacks.forEach((callback) => callback(entry));
};

window.__pushProgress = (progress) => {
  window.__progressCallbacks.forEach((callback) => callback(progress));
};

window.__registerBridge = (onLog, onProgress) => {
  window.__logCallbacks.push(onLog);
  window.__progressCallbacks.push(onProgress);
};

window.__isPywebview = () => typeof window.pywebview !== "undefined";

window.__onPywebviewReady = (callback) => {
  if (window.__isPywebview()) {
    callback();
    return;
  }
  window.__pywebviewReadyCallbacks.push(callback);
};

window.addEventListener("pywebviewready", () => {
  window.__pywebviewReadyCallbacks.splice(0).forEach((callback) => callback());
});

let mock: DesktopApi | null = null;

export function getApi(): Promise<DesktopApi> {
  const readyApi = window.pywebview?.api;
  if (readyApi) return Promise.resolve(readyApi);

  return new Promise((resolve) => {
    let settled = false;
    const useReal = () => {
      if (settled) return;
      const api = window.pywebview?.api;
      if (!api) return;
      settled = true;
      resolve(api);
    };

    window.__onPywebviewReady(useReal);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      mock = mock ?? createMockApi();
      resolve(mock);
    }, 300);
  });
}
