// Google Identity Services (GIS) token-model auth for the PWA.
//
// Design constraints (see specs/2026-04-17-subject-teacher-design.md §5):
// - Scope is `drive.appdata` only.
// - Access tokens live in memory only. Never persist them to localStorage.
// - Token renewal requires a user gesture; background uploads never open popups.

const GIS_SRC = "https://accounts.google.com/gsi/client";
export const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

export const usesServerAuth = import.meta.env.VITE_SERVER_AUTH === "true";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (response: TokenResponse) => void;
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

// Minimal shape of the slice of GIS we use. Loaded at runtime from GIS_SRC.
interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    error_callback: (error: { type: string }) => void;
    callback: (response: TokenResponse) => void;
  }) => TokenClient;
  revoke: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let forceRefresh = false;
let sessionRequest: Promise<string> | null = null;
let authGeneration = 0;
let missingSession = false;
let retryAfter = 0;
let scriptPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0;
let pending: Promise<string> | null = null;
let rejectPending: ((error: Error) => void) | null = null;
export const AUTH_CHANGED = "checkon-auth-changed";
export class AuthRequiredError extends Error {
  constructor() { super("Google 다시 연결이 필요합니다. 입력은 기기에 보관됩니다."); this.name = "AuthRequiredError"; }
}
export function hasValidAccessToken(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - 60_000;
}
export function invalidateAccessToken(): void {
  forceRefresh = true;
  accessToken = null;
  tokenExpiresAt = 0;
  window.dispatchEvent(new Event(AUTH_CHANGED));
}

/** True when a web client ID is configured. */
export function isConfigured(): boolean {
  return usesServerAuth || (typeof CLIENT_ID === "string" && CLIENT_ID.length > 0);
}

function loadGisScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptPromise = null; script.remove(); reject(new Error("Google 연결을 준비하지 못했습니다. 인터넷 연결을 확인해 주세요.")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Load GIS and create the token client. Safe to call more than once. */
export async function initAuth(): Promise<void> {
  if (usesServerAuth) return;
  if (!isConfigured()) {
    throw new Error("VITE_GOOGLE_CLIENT_ID 가 설정되지 않았습니다. .env.local 을 확인하세요.");
  }
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("Google Identity Services 초기화에 실패했습니다.");
  }
  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: CLIENT_ID as string,
      scope: DRIVE_APPDATA_SCOPE,
      error_callback: () => rejectPending?.(new Error("Google 연결 창이 닫혔거나 차단되었습니다. 다시 연결을 눌러 주세요.")),
      callback: () => {
        // Replaced per-request inside requestAccessToken().
      },
    });
  }
}

/**
 * Request an access token. Uses `prompt: ""` so Google decides what UI is
 * needed: first-time users get the consent screen, returning users with an
 * active session sail through. (The old `prompt: "consent"` forced the full
 * consent screen on every login.)
 */
export function requestAccessToken(): Promise<string> {
  if (usesServerAuth) {
    window.location.assign("/api/auth/start");
    return new Promise(() => {}); // A full-page redirect stays compatible with installed web apps.
  }
  if (pending) return pending;
  if (!tokenClient) return Promise.reject(new Error("Google 연결 준비 중입니다. 잠시 후 다시 눌러 주세요."));
  const client = tokenClient;
  pending = new Promise<string>((resolve, reject) => {
    rejectPending = reject;
    client.callback = (response) => {
      if (response.error || !response.access_token) {
        reject(new Error("Google 연결을 완료하지 못했습니다. 다시 연결해 주세요."));
        return;
      }
      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
      window.dispatchEvent(new Event(AUTH_CHANGED));
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: "" });
  }).finally(() => { pending = null; rejectPending = null; });
  return pending;
}

/** Background callers must wait for an explicit reconnect when expired. */
export async function getValidAccessToken(): Promise<string> {
  if (hasValidAccessToken()) return accessToken!;
  if (usesServerAuth) return restoreSession();
  invalidateAccessToken();
  throw new AuthRequiredError();
}

/** Restores the protected server session with no Google window. */
export function restoreSession(): Promise<string> {
  if (hasValidAccessToken()) return Promise.resolve(accessToken!);
  if (!usesServerAuth || missingSession) return Promise.reject(new AuthRequiredError());
  if (sessionRequest) return sessionRequest;
  if (Date.now() < retryAfter) return Promise.reject(new Error("연결을 확인하는 중입니다. 잠시 후 자동으로 다시 시도합니다."));
  const generation = authGeneration;
  sessionRequest = (async () => {
    const response = await fetch("/api/auth/session", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "X-CheckOn-Request": "1", ...(forceRefresh ? { "X-CheckOn-Refresh": "1" } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (generation !== authGeneration) throw new AuthRequiredError();
    if (response.status === 401) {
      missingSession = true;
      invalidateAccessToken();
      throw new AuthRequiredError();
    }
    if (!response.ok) throw new Error("Google 연결을 확인하지 못했습니다. 입력은 기기에 보관됩니다.");
    const result = await response.json();
    if (generation !== authGeneration) throw new AuthRequiredError();
    if (typeof result.access_token !== "string" || !Number.isFinite(result.expires_in) || result.expires_in <= 60) throw new Error("Google 연결 응답을 확인하지 못했습니다.");
    accessToken = result.access_token;
    tokenExpiresAt = Date.now() + result.expires_in * 1000;
    forceRefresh = false;
    retryAfter = 0;
    window.dispatchEvent(new Event(AUTH_CHANGED));
    return accessToken!;
  })().catch(error => {
    if (!(error instanceof AuthRequiredError)) retryAfter = Date.now() + 30000;
    throw error;
  }).finally(() => { sessionRequest = null; });
  return sessionRequest;
}

/** Current cached token without triggering a refresh (may be null/expired). */
export function getCachedToken(): string | null {
  return accessToken;
}

/** Revoke the current token and clear local state ("연결 해제"). */
export async function revoke(): Promise<void> {
  if (usesServerAuth) {
    // Finish a token response before clearing its cookie, so logout wins races.
    authGeneration += 1;
    await sessionRequest?.catch(() => {});
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "X-CheckOn-Request": "1" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("연결 해제를 완료하지 못했습니다. 인터넷 연결 후 다시 눌러 주세요.");
    missingSession = true;
    invalidateAccessToken();
    return;
  }
  return new Promise((resolve) => {
    const oauth2 = window.google?.accounts?.oauth2;
    const token = accessToken;
    accessToken = null;
    tokenExpiresAt = 0;
    if (token && oauth2) {
      oauth2.revoke(token, () => resolve());
    } else {
      resolve();
    }
  });
}
