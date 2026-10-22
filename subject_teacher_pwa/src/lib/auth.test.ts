import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client"); vi.stubEnv("VITE_SERVER_AUTH", "false"); });
async function setup() {
  let config: any;
  const request = vi.fn();
  const client = { callback: (_: any) => {}, requestAccessToken: request };
  window.google = { accounts: { oauth2: {
    initTokenClient: (value: any) => { config = value; return client; }, revoke: vi.fn(),
  } } };
  const auth = await import("./auth");
  await auth.initAuth();
  return { auth, client, request, getConfig: () => config };
}
it("never opens a popup from an expired background request", async () => {
  const { auth, request } = await setup();
  await expect(auth.getValidAccessToken()).rejects.toHaveProperty("name", "AuthRequiredError");
  expect(request).not.toHaveBeenCalled();
});
it("shares one token request and detects expiry before upload", async () => {
  const { auth, client, request } = await setup();
  const first = auth.requestAccessToken();
  const second = auth.requestAccessToken();
  expect(request).toHaveBeenCalledTimes(1);
  client.callback({ access_token: "test-token", expires_in: 3600 });
  await expect(first).resolves.toBe("test-token");
  await expect(second).resolves.toBe("test-token");
  expect(auth.hasValidAccessToken()).toBe(true);
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600000);
  await expect(auth.getValidAccessToken()).rejects.toHaveProperty("name", "AuthRequiredError");
  expect(request).toHaveBeenCalledTimes(1);
  now.mockRestore();
});
it("releases a closed popup request so reconnect can be retried", async () => {
  const { auth, client, request, getConfig } = await setup();
  const first = auth.requestAccessToken();
  getConfig().error_callback({ type: "popup_closed" });
  await expect(first).rejects.toThrow("다시 연결");
  const retry = auth.requestAccessToken();
  client.callback({ access_token: "test-token" });
  await expect(retry).resolves.toBe("test-token");
  expect(request).toHaveBeenCalledTimes(2);
});

it("restores and renews a server session automatically after token expiry", async () => {
  vi.stubEnv("VITE_SERVER_AUTH", "true");
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:"first", expires_in:3600})))
    .mockResolvedValueOnce(new Response(JSON.stringify({access_token:"renewed", expires_in:3600})));
  vi.stubGlobal("fetch", fetcher);
  const auth = await import("./auth");
  const [a,b] = await Promise.all([auth.getValidAccessToken(), auth.getValidAccessToken()]);
  expect(a).toBe("first"); expect(b).toBe("first"); expect(fetcher).toHaveBeenCalledTimes(1);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600001);
  await expect(auth.getValidAccessToken()).resolves.toBe("renewed");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe("/api/auth/session");
  clock.mockRestore(); vi.unstubAllGlobals();
});
it("does not repeatedly request a missing server session", async () => {
  vi.stubEnv("VITE_SERVER_AUTH", "true");
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", {status:401}));
  vi.stubGlobal("fetch", fetcher);
  const auth = await import("./auth");
  await expect(auth.restoreSession()).rejects.toHaveProperty("name", "AuthRequiredError");
  await expect(auth.restoreSession()).rejects.toHaveProperty("name", "AuthRequiredError");
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
it("backs off temporary server failure without losing the ability to restore", async () => {
  vi.stubEnv("VITE_SERVER_AUTH", "true");
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", {status:503}))
    .mockResolvedValueOnce(new Response(JSON.stringify({access_token:"recovered", expires_in:3600})));
  vi.stubGlobal("fetch", fetcher);
  const auth = await import("./auth");
  await expect(auth.restoreSession()).rejects.toThrow();
  await expect(auth.restoreSession()).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31000);
  await expect(auth.restoreSession()).resolves.toBe("recovered");
  clock.mockRestore(); vi.unstubAllGlobals();
});
