import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Root from "./Root";
import { clearDriveCache, loadDriveCache, saveDriveCache } from "./lib/localCache";
import type { LoadedDriveData } from "./lib/driveData";

vi.mock("./lib/auth", () => ({
  usesServerAuth: false,
  restoreSession: vi.fn().mockRejectedValue(Object.assign(new Error("auth"), {name: "AuthRequiredError"})),
  AUTH_CHANGED: "checkon-auth-changed",
  hasValidAccessToken: vi.fn().mockReturnValue(false),
  initAuth: vi.fn().mockResolvedValue(undefined),
  isConfigured: vi.fn().mockReturnValue(true),
  requestAccessToken: vi.fn().mockResolvedValue("token"),
  revoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/driveData", () => ({
  loadAll: vi.fn().mockResolvedValue({
    settings: null,
    attendance: null,
    students: null,
    timetable: null,
  }),
  loadMonthlyAttendance: vi.fn().mockResolvedValue(null),
  saveSlotAttendance: vi.fn().mockResolvedValue(undefined),
}));

// Stub App so these tests exercise Root's entry/SWR logic in isolation and
// surface the props Root passes (stale / onRefresh / onSignOut).
vi.mock("./App", () => ({
  default: (props: {
    stale?: boolean;
    canSync?: boolean;
    onRefresh?: () => void;
    onSignOut?: () => void;
  }) => (
    <div>
      <p data-testid="app">app · stale={String(props.stale)} connected={String(props.canSync)}</p>
      <button type="button" onClick={props.onRefresh}>refresh</button>
      <button type="button" onClick={props.onSignOut}>signout</button>
    </div>
  ),
}));

import { hasValidAccessToken, initAuth, requestAccessToken } from "./lib/auth";
import { loadAll } from "./lib/driveData";

const EMPTY: LoadedDriveData = {
  settings: null,
  attendance: null,
  students: null,
  timetable: null,
};

describe("Root sign-in", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearDriveCache();
  });

  it("never requests a token on page load (no surprise Google window)", async () => {
    render(<Root />);
    expect(await screen.findByRole("button", { name: /Google 계정으로 시작하기/ })).toBeInTheDocument();
    expect(initAuth).toHaveBeenCalled();
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it("initializes auth and requests a token exactly once when the login button is tapped", async () => {
    render(<Root />);
    await userEvent.click(await screen.findByRole("button", { name: /Google 계정으로 시작하기/ }));
    await waitFor(() => expect(requestAccessToken).toHaveBeenCalledTimes(1));
    expect(initAuth).toHaveBeenCalledTimes(2);
  });
});

describe("Root stale-while-revalidate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearDriveCache();
  });

  it("renders cached data immediately without requesting a token", async () => {
    await saveDriveCache(EMPTY, "2026-07");
    render(<Root />);

    const app = await screen.findByTestId("app");
    expect(app).toHaveTextContent("stale=true");
    // No login screen, and crucially no Google window on load.
    expect(screen.queryByRole("button", { name: /Google 계정으로 시작하기/ })).not.toBeInTheDocument();
    expect(requestAccessToken).not.toHaveBeenCalled();
    expect(initAuth).toHaveBeenCalled();
  });

  it("shows the login screen when no cache exists", async () => {
    render(<Root />);
    expect(await screen.findByRole("button", { name: /Google 계정으로 시작하기/ })).toBeInTheDocument();
    expect(screen.queryByTestId("app")).not.toBeInTheDocument();
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it("detects expired permission when returning to the app without opening Google", async () => {
    vi.mocked(hasValidAccessToken).mockReturnValue(true);
    await saveDriveCache(EMPTY, "2026-07");
    render(<Root />);
    expect(await screen.findByTestId("app")).toHaveTextContent("connected=true");
    vi.mocked(hasValidAccessToken).mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(screen.getByTestId("app")).toHaveTextContent("connected=false");
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes from Drive under a gesture and clears the stale flag", async () => {
    await saveDriveCache(EMPTY, "2026-07");
    render(<Root />);
    const app = await screen.findByTestId("app");
    expect(app).toHaveTextContent("stale=true");

    await userEvent.click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => expect(requestAccessToken).toHaveBeenCalledTimes(1));
    expect(initAuth).toHaveBeenCalledTimes(2);
    expect(loadAll).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("app")).toHaveTextContent("stale=false"),
    );
  });

  it("clears the cache on sign-out and returns to the login screen", async () => {
    await saveDriveCache(EMPTY, "2026-07");
    render(<Root />);
    await screen.findByTestId("app");

    await userEvent.click(screen.getByRole("button", { name: "signout" }));

    expect(await screen.findByRole("button", { name: /Google 계정으로 시작하기/ })).toBeInTheDocument();
    expect(await loadDriveCache()).toBeNull();
  });
});
