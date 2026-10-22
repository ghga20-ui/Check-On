# Desktop UI Vite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop subject-teacher UI's runtime-CDN + in-browser-Babel + global-script setup with a Vite + React 19 + TypeScript build so the app renders fully offline, starts faster, and shares the PWA's toolchain — while keeping the pywebview/Python shell and `window.pywebview.api` bridge unchanged.

**Architecture:** The frontend lives at `subject_teacher/neis_attendance/` and is converted in place into a Vite project. The existing global-namespace `.jsx` files become ESM `.tsx` modules under `src/`. A typed `bridge.ts` wraps the 17 `window.pywebview.api.*` methods and provides a browser mock for `vite dev`. Python→JS push globals (`window.__pushLog` etc.) are preserved verbatim so `webview_app.py`/`api.py` keep working. pywebview loads the built `dist/index.html` via `file://`; Vite is configured with `base: "./"` so relative asset URLs resolve under `file://`.

**Tech Stack:** Vite 7, React 19, TypeScript 5.8, @vitejs/plugin-react, Vitest + @testing-library/react + jsdom (mirrors `subject_teacher_pwa`).

---

## Background The Engineer Needs

You are migrating an existing, working UI. **Do not redesign it.** The React component bodies stay byte-for-byte identical; you are only changing the module boundary (adding `import`/`export`), the type annotations, and the build/bridge plumbing.

### Current state (before)
- `subject_teacher/neis_attendance/index.html` loads React 18 (dev UMD), `@babel/standalone`, then 7 `<script type="text/babel">` `.jsx` files **from unpkg CDN** — so it breaks offline.
- The `.jsx` files share a **global namespace** (no `import`/`export`). Each declares its dependencies in a top `/* global ... */` comment.
- `bridge.js` defines `window.__pushLog`, `window.__pushProgress`, `window.__registerBridge`, `window.__onPywebviewReady`, `window.__isPywebview`, and listens for the `pywebviewready` event. Python calls these via `evaluate_js`.
- `webview_app.py` opens `neis_attendance/index.html` via `file://` with `js_api=Api()` (the Python `Api` class is exposed as `window.pywebview.api`).

### Files actually loaded today (index.html order — THIS is the dependency order)
1. `bridge.js`
2. `tweaks-panel.jsx` → exports `useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton`
3. `components.jsx` → exports `Icon, Chip, StatusChip, Checkbox, Ring, Bar, Banner, EmptyState, Toggle, Segmented, PillTabs`
4. `data.jsx` → exports `TODAY_SLOTS, TIMETABLE, ROSTERS` (and internal `NAMES_A, NAMES_B, roster`)
5. `log-panel.jsx` → exports `LogDock` (consumes `Icon`)
6. `run-view.jsx` → exports `RunView` (and internal `ClassSheet`, date helpers) (consumes `Icon, Chip, StatusChip, Checkbox, Ring, Bar, Banner, EmptyState, Toggle, Segmented, TODAY_SLOTS, ROSTERS`)
7. `setup-view.jsx` → exports `BasicsView, TimetableView, RosterView, DriveView, AuthView, PlaceholderView` (and internal `DAYS`, helpers) (consumes `Icon, Toggle, Segmented, PillTabs, Banner, EmptyState, Chip, Checkbox, TIMETABLE, ROSTERS`)
8. `app.jsx` → defines `App`, mounts to `#root` (consumes everything above + `ReactDOM`, the `Tweak*` family, plus its own many pure helpers)

### Files NOT loaded today (dead in the current app — DO NOT port unless told)
- `icons.jsx` (duplicate `Icon`; `components.jsx`'s `Icon` is the live one)
- `sidebar.jsx` (`Sidebar` is unused; `App` builds nav inline from its `NAV` const)

Confirm with `grep -n 'src=' subject_teacher/neis_attendance/index.html` before deleting; if either is referenced, treat it as live.

### The bridge surface (all 17 methods — `window.pywebview.api.*`)
Each returns a `Promise<string>` (the Python `Api` methods return `json.dumps(...)` or a plain string):
```
get_settings, save_settings,
get_timetable_tsv, save_timetable_tsv,
get_students_tsv, save_students_tsv,
get_today_slots, save_slot_attendance,
get_drive_user,
get_neis_api_key, save_neis_api_key,
get_password, get_password (read), import_students_file,
preview_neis_public_timetable, publish_neis_timetable_for_week,
find_neis_subject_candidates,
start_run
```
(Authoritative list — verify against `grep -rhoE 'pywebview\.api\.[a-zA-Z_]+' subject_teacher/neis_attendance/*.jsx | sort -u`.)

### Decisions already made
- **Language: TypeScript** (`.tsx`). Type the bridge + the extracted pure helpers strictly; presentational component props may use explicit `interface`s or, where the original is highly dynamic, `any` (leave a `// TODO: tighten types` and move on — full strictness is a follow-up, not this migration).
- **Dev mock: yes.** `vite dev` in a plain browser must render the UI against sample data via a mock that implements the bridge interface.

---

## File Structure (after)

```
subject_teacher/neis_attendance/
├─ package.json              (NEW)
├─ vite.config.ts            (NEW — base:"./", react, vitest jsdom)
├─ tsconfig.json             (NEW)
├─ tsconfig.node.json        (NEW)
├─ .gitignore               (NEW — node_modules/, dist/)
├─ index.html               (REWRITE — module entry, no CDN, keep styles.css link)
├─ styles.css               (KEEP as-is)
├─ src/                      (NEW)
│  ├─ main.tsx              (entry: render <App/>)
│  ├─ app.tsx              (from app.jsx — App component; imports views/bridge/lib)
│  ├─ bridge.ts            (typed DesktopApi + push globals + getApi())
│  ├─ mock-api.ts          (browser dev mock implementing DesktopApi)
│  ├─ components.tsx        (from components.jsx)
│  ├─ tweaks-panel.tsx      (from tweaks-panel.jsx)
│  ├─ log-panel.tsx         (from log-panel.jsx)
│  ├─ run-view.tsx          (from run-view.jsx)
│  ├─ setup-view.tsx        (from setup-view.jsx)
│  ├─ data.ts              (from data.jsx)
│  ├─ vite-env.d.ts
│  └─ lib/
│     ├─ transforms.ts      (pure helpers lifted out of app.jsx)
│     └─ transforms.test.ts
└─ dist/                    (build output; gitignored; pywebview loads dist/index.html)
```

Old top-level `.jsx` + `bridge.js` are removed once their content has moved into `src/`. `app.css` is not linked by `index.html` today — confirm it is unused (`grep -rn 'app.css' subject_teacher/neis_attendance`) and leave it untouched if so.

---

## Conventions for every ported module

- First line of each component module: `import React from "react";` (and `import { useState, useEffect, useMemo, useRef } from "react";` where used — match what the file uses). Remove the old `/* global ... */` line.
- Replace each name the old `/* global */` header listed with a real `import` from the module that exports it (see per-file maps below).
- Add `export` to every top-level name another module consumes (the export lists above).
- **Do not change component logic, JSX, or CSS class names.** Diff should be: removed `/* global */`, added imports/exports, added types.
- Commit after each task. Run `npm run build` (and `npm test` where tests exist) before committing.

---

### Task 1: Scaffold the Vite + TS project

**Files:**
- Create: `subject_teacher/neis_attendance/package.json`
- Create: `subject_teacher/neis_attendance/vite.config.ts`
- Create: `subject_teacher/neis_attendance/tsconfig.json`
- Create: `subject_teacher/neis_attendance/tsconfig.node.json`
- Create: `subject_teacher/neis_attendance/.gitignore`
- Create: `subject_teacher/neis_attendance/src/vite-env.d.ts`

- [ ] **Step 1: Create a feature branch**

```bash
cd /c/Users/admin/Desktop/2026_project/neis-attendance
git checkout -b feature/desktop-ui-vite
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "neis-subject-teacher-desktop-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^27.0.0",
    "typescript": "^5.8.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Write `vite.config.ts`** — `base: "./"` is critical so built asset URLs are relative and work under `file://`.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", globals: true },
});
```

- [ ] **Step 4: Write `tsconfig.json` and `tsconfig.node.json`** (mirror `subject_teacher_pwa`)

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noUnusedLocals": false,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "vite.config.ts"]
}
```
`tsconfig.node.json`:
```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Bundler", "skipLibCheck": true } }
```

- [ ] **Step 5: Write `.gitignore` and `src/vite-env.d.ts`**

`.gitignore`:
```
node_modules/
dist/
.vite/
```
`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: Install and verify the toolchain**

Run: `cd subject_teacher/neis_attendance && npm install`
Expected: installs without error; `node_modules/` created.

- [ ] **Step 7: Commit**

```bash
git add subject_teacher/neis_attendance/package.json subject_teacher/neis_attendance/vite.config.ts subject_teacher/neis_attendance/tsconfig.json subject_teacher/neis_attendance/tsconfig.node.json subject_teacher/neis_attendance/.gitignore subject_teacher/neis_attendance/src/vite-env.d.ts
git commit -m "build(desktop-ui): scaffold Vite + React + TS project"
```

---

### Task 2: Typed bridge + dev mock

**Files:**
- Create: `subject_teacher/neis_attendance/src/bridge.ts`
- Create: `subject_teacher/neis_attendance/src/mock-api.ts`
- Create: `subject_teacher/neis_attendance/src/bridge.test.ts`

- [ ] **Step 1: Write the failing test** (`src/bridge.test.ts`)

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { getApi } from "./bridge";

describe("bridge", () => {
  beforeEach(() => {
    // No pywebview in jsdom -> getApi() must resolve to the mock.
    delete (window as any).pywebview;
  });

  it("falls back to the mock API in a browser", async () => {
    const api = await getApi();
    const settings = JSON.parse(await api.get_settings());
    expect(settings).toHaveProperty("region");
  });

  it("returns sample today slots from the mock", async () => {
    const api = await getApi();
    const slots = JSON.parse(await api.get_today_slots("2026-04-20"));
    expect(Array.isArray(slots)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd subject_teacher/neis_attendance && npx vitest run src/bridge.test.ts`
Expected: FAIL (`Cannot find module './bridge'`).

- [ ] **Step 3: Write `src/bridge.ts`**

Port the global push functions from the old `bridge.js` verbatim (Python still calls them via `evaluate_js`), add the typed interface, and add `getApi()` that resolves the real `window.pywebview.api` when present (waiting for `pywebviewready`) or the mock otherwise.

```ts
import { createMockApi } from "./mock-api";

/** Every method maps to a Python Api method and returns its JSON/string result. */
export interface DesktopApi {
  get_settings(): Promise<string>;
  save_settings(json: string): Promise<string>;
  get_timetable_tsv(): Promise<string>;
  save_timetable_tsv(tsv: string, effectiveFrom: string): Promise<string>;
  get_students_tsv(): Promise<string>;
  save_students_tsv(tsv: string): Promise<string>;
  get_today_slots(dateStr: string): Promise<string>;
  save_slot_attendance(dateStr: string, slotId: string, marksJson: string): Promise<string>;
  get_drive_user(): Promise<string>;
  get_neis_api_key(): Promise<string>;
  save_neis_api_key(apiKey: string): Promise<string>;
  get_password(): Promise<string>;
  import_students_file(classKey: string): Promise<string>;
  preview_neis_public_timetable(payloadJson: string): Promise<string>;
  publish_neis_timetable_for_week(dateStr: string): Promise<string>;
  find_neis_subject_candidates(payloadJson: string): Promise<string>;
  start_run(dateStr: string, password: string, closeAfter: boolean): Promise<string>;
}

declare global {
  interface Window {
    pywebview?: { api: DesktopApi };
    __logCallbacks: Array<(entry: unknown) => void>;
    __progressCallbacks: Array<(progress: unknown) => void>;
    __pywebviewReadyCallbacks: Array<() => void>;
    __pushLog: (entry: unknown) => void;
    __pushProgress: (progress: unknown) => void;
    __registerBridge: (onLog: (e: unknown) => void, onProgress: (p: unknown) => void) => void;
    __isPywebview: () => boolean;
    __onPywebviewReady: (cb: () => void) => void;
  }
}

// --- Python -> JS push channel (verbatim from the old bridge.js) ---
window.__logCallbacks = [];
window.__progressCallbacks = [];
window.__pywebviewReadyCallbacks = [];
window.__pushLog = (entry) => { window.__logCallbacks.forEach((cb) => cb(entry)); };
window.__pushProgress = (progress) => { window.__progressCallbacks.forEach((cb) => cb(progress)); };
window.__registerBridge = (onLog, onProgress) => {
  window.__logCallbacks.push(onLog);
  window.__progressCallbacks.push(onProgress);
};
window.__isPywebview = () => typeof window.pywebview !== "undefined";
window.__onPywebviewReady = (cb) => {
  if (window.__isPywebview()) { cb(); return; }
  window.__pywebviewReadyCallbacks.push(cb);
};
window.addEventListener("pywebviewready", () => {
  window.__pywebviewReadyCallbacks.splice(0).forEach((cb) => cb());
});

// --- JS -> Python call channel ---
let mock: DesktopApi | null = null;

/** Resolve the real pywebview API, or a browser mock for `vite dev`/tests. */
export function getApi(): Promise<DesktopApi> {
  if (window.pywebview?.api) return Promise.resolve(window.pywebview.api);
  return new Promise((resolve) => {
    let settled = false;
    const useReal = () => { if (!settled) { settled = true; resolve(window.pywebview!.api); } };
    window.__onPywebviewReady(useReal);
    // If pywebview never appears (plain browser), fall back to the mock shortly.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      mock = mock ?? createMockApi();
      resolve(mock);
    }, 300);
  });
}
```

- [ ] **Step 4: Write `src/mock-api.ts`**

Implement `DesktopApi` returning JSON strings shaped like the Python responses, using the sample data from `data.ts` (Task 4). Keep it small but valid; expand if a screen needs more.

```ts
import type { DesktopApi } from "./bridge";
import { TODAY_SLOTS, TIMETABLE, ROSTERS } from "./data";

const ok = (obj: unknown) => Promise.resolve(JSON.stringify(obj));

export function createMockApi(): DesktopApi {
  return {
    get_settings: () => ok({
      schemaVersion: 1, teacherName: "데모 교사", schoolName: "데모고등학교",
      region: "경기", semester: { year: 2026, term: 1 }, closeByDefault: false,
      timetableMode: "manual", assignedLessons: [], updatedAt: "2026-03-02T09:00:00+09:00",
    }),
    save_settings: () => ok({ ok: true }),
    get_timetable_tsv: () => Promise.resolve(
      "slot_id\tday\tperiod\tgrade\tclass_no\tsubject_name\tneis_subject_label\n" +
      TIMETABLE.map((r) => [r.id ?? "mon-1", "mon", r.period ?? 1, r.grade ?? 2, r.classNo ?? "1", r.subject ?? "문학", r.subject ?? "문학"].join("\t")).join("\n")
    ),
    save_timetable_tsv: () => ok({ ok: true }),
    get_students_tsv: () => Promise.resolve(""),
    save_students_tsv: () => ok({ ok: true }),
    get_today_slots: () => ok(TODAY_SLOTS),
    save_slot_attendance: () => ok({ ok: true, checkedAt: "2026-04-20T09:00:00+09:00" }),
    get_drive_user: () => ok({ displayName: "데모", emailAddress: "demo@example.com" }),
    get_neis_api_key: () => Promise.resolve(""),
    save_neis_api_key: () => ok({ ok: true }),
    get_password: () => Promise.resolve(""),
    import_students_file: () => ok({ classKey: "2-1", students: [] }),
    preview_neis_public_timetable: () => ok({ school: { name: "데모고" }, lessons: [] }),
    publish_neis_timetable_for_week: () => ok({ ok: true, count: 0, effectiveFrom: "2026-04-20" }),
    find_neis_subject_candidates: () => ok({ scope: "grade", candidates: [] }),
    start_run: () => ok({ ok: true }),
  };
}
```
> Note: `ROSTERS` is imported for parity with the real screens; if unused after wiring, drop the import.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/bridge.test.ts`
Expected: PASS (2 tests). (Depends on `data.ts` from Task 4 — if running tasks strictly in order, create a minimal `src/data.ts` first or reorder Task 4 before Task 2. Recommended: do Task 4 before Task 2.)

- [ ] **Step 6: Commit**

```bash
git add subject_teacher/neis_attendance/src/bridge.ts subject_teacher/neis_attendance/src/mock-api.ts subject_teacher/neis_attendance/src/bridge.test.ts
git commit -m "feat(desktop-ui): typed pywebview bridge with browser dev mock"
```

---

### Task 3: Extract pure helpers from app.jsx into `lib/transforms.ts` (TDD)

`app.jsx` contains many pure functions that are the best test targets and the riskiest to break: `now, todayIso, toIsoDate, weekKeyFromIsoDate, toGradeNumber, normalizeSubjectName, DAY_TO_KEY, KEY_TO_DAY, parseJsonResult, formatApiError, isTransientNetworkError, parseTextResult, settingsFromApi, settingsToApi, timetableRowsFromTsv, timetableRowsToTsv, rostersFromTsv, rostersToTsv, classKeyFromTimetableRow, rosterKeysFromTimetable, syncRostersToTimetable`.

**Files:**
- Create: `subject_teacher/neis_attendance/src/lib/transforms.ts`
- Create: `subject_teacher/neis_attendance/src/lib/transforms.test.ts`
- Modify: `subject_teacher/neis_attendance/app.jsx` (these defs will be deleted from `app.tsx` in Task 9 and imported instead)

- [ ] **Step 1: Write characterization tests first** (`src/lib/transforms.test.ts`) — capture today's behavior so the move can't change it.

```ts
import { describe, expect, it } from "vitest";
import {
  toIsoDate, weekKeyFromIsoDate, timetableRowsFromTsv, timetableRowsToTsv,
  rostersFromTsv, rostersToTsv, settingsFromApi, settingsToApi,
} from "./transforms";

describe("timetable TSV round-trip", () => {
  it("parses and re-serializes timetable rows", () => {
    const tsv = "slot_id\tday\tperiod\tgrade\tclass_no\tsubject_name\tneis_subject_label\nmon-3\tmon\t3\t2\t1\t문학\t문학";
    const rows = timetableRowsFromTsv(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].period).toBe(3);
    expect(timetableRowsToTsv(rows)).toContain("mon-3");
  });
});

describe("settings adapter", () => {
  it("maps api settings to UI and back", () => {
    const ui = settingsFromApi({ teacherName: "홍길동", schoolName: "나이스고", region: "경기", semester: { year: 2026, term: 1 } });
    expect(ui.teacherName).toBe("홍길동");
    const api = settingsToApi(ui);
    expect(api.schoolName).toBe("나이스고");
  });
});
```
> Adjust the exact assertions to match the **current** behavior — read the existing bodies in `app.jsx` and assert what they actually produce. The point is to lock current behavior, not to invent new contracts.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/transforms.test.ts`
Expected: FAIL (`Cannot find module './transforms'`).

- [ ] **Step 3: Create `src/lib/transforms.ts`** by moving the listed pure helpers out of `app.jsx` **verbatim**, adding `export` to each and TS parameter/return types where obvious (use `any` for dynamic shapes, leave a `// TODO: tighten`). Keep `DAY_TO_KEY`/`KEY_TO_DAY` as exported consts. Do not change logic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/transforms.test.ts`
Expected: PASS. Fix the test assertions if they diverge from real behavior (the implementation is the source of truth here).

- [ ] **Step 5: Commit**

```bash
git add subject_teacher/neis_attendance/src/lib/transforms.ts subject_teacher/neis_attendance/src/lib/transforms.test.ts
git commit -m "test(desktop-ui): extract app.jsx pure helpers into lib/transforms with tests"
```

---

### Task 4: Port `data.jsx` → `src/data.ts`

**Files:**
- Create: `subject_teacher/neis_attendance/src/data.ts`
- Delete (after move): `subject_teacher/neis_attendance/data.jsx`

- [ ] **Step 1: Move the file content** into `src/data.ts`, adding `export` to `TODAY_SLOTS`, `TIMETABLE`, `ROSTERS`. Keep `NAMES_A`, `NAMES_B`, `roster` internal (no export). No logic changes. Add light types (e.g. `export const TODAY_SLOTS: any[] = [...]` is acceptable; tighten later).

- [ ] **Step 2: Type-check**

Run: `cd subject_teacher/neis_attendance && npx tsc -b`
Expected: no errors from `data.ts`.

- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/src/data.ts
git rm subject_teacher/neis_attendance/data.jsx
git commit -m "refactor(desktop-ui): port data.jsx to src/data.ts module"
```

---

### Task 5: Port `components.jsx` → `src/components.tsx`

**Files:**
- Create: `subject_teacher/neis_attendance/src/components.tsx`
- Delete (after move): `subject_teacher/neis_attendance/components.jsx`

- [ ] **Step 1: Move content**, prepend `import React from "react";`, remove the `/* global React */` line, and `export` each of: `Icon, Chip, StatusChip, Checkbox, Ring, Bar, Banner, EmptyState, Toggle, Segmented, PillTabs`. Component bodies unchanged. Add prop `interface`s where trivial; `any` otherwise.

- [ ] **Step 2: Type-check**: `npx tsc -b` → no errors.
- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/src/components.tsx
git rm subject_teacher/neis_attendance/components.jsx
git commit -m "refactor(desktop-ui): port components.jsx to src/components.tsx module"
```

---

### Task 6: Port `tweaks-panel.jsx` → `src/tweaks-panel.tsx`

**Files:**
- Create: `subject_teacher/neis_attendance/src/tweaks-panel.tsx`
- Delete (after move): `subject_teacher/neis_attendance/tweaks-panel.jsx`

- [ ] **Step 1: Move content**, prepend `import React from "react";` (plus the hooks it uses), `export` `useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton`. **Preserve the `/*EDITMODE-BEGIN*/` markers verbatim** — they are an external design-tooling contract, not dead code.
- [ ] **Step 2: Type-check**: `npx tsc -b` → no errors.
- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/src/tweaks-panel.tsx
git rm subject_teacher/neis_attendance/tweaks-panel.jsx
git commit -m "refactor(desktop-ui): port tweaks-panel.jsx to module"
```

---

### Task 7: Port `log-panel.jsx` → `src/log-panel.tsx`

**Files:**
- Create: `subject_teacher/neis_attendance/src/log-panel.tsx`
- Delete (after move): `subject_teacher/neis_attendance/log-panel.jsx`

- [ ] **Step 1: Move content**; `import React from "react";` and `import { Icon } from "./components";`; remove `/* global React, Icon */`; `export` `LogDock`.
- [ ] **Step 2: Type-check**: `npx tsc -b` → no errors.
- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/src/log-panel.tsx
git rm subject_teacher/neis_attendance/log-panel.jsx
git commit -m "refactor(desktop-ui): port log-panel.jsx to module"
```

---

### Task 8: Port `run-view.jsx` → `src/run-view.tsx`

**Files:**
- Create: `subject_teacher/neis_attendance/src/run-view.tsx`
- Delete (after move): `subject_teacher/neis_attendance/run-view.jsx`

- [ ] **Step 1: Move content.** Imports:
```ts
import React from "react";
import { Icon, Chip, StatusChip, Checkbox, Ring, Bar, Banner, EmptyState, Toggle, Segmented } from "./components";
import { TODAY_SLOTS, ROSTERS } from "./data";
```
Remove the `/* global ... */` line. `export` `RunView` (keep `ClassSheet` + date helpers internal). Bodies unchanged.
- [ ] **Step 2: Type-check**: `npx tsc -b` → no errors.
- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/src/run-view.tsx
git rm subject_teacher/neis_attendance/run-view.jsx
git commit -m "refactor(desktop-ui): port run-view.jsx to module"
```

---

### Task 9: Port `setup-view.jsx` → `src/setup-view.tsx`

**Files:**
- Create: `subject_teacher/neis_attendance/src/setup-view.tsx`
- Delete (after move): `subject_teacher/neis_attendance/setup-view.jsx`

- [ ] **Step 1: Move content.** Imports:
```ts
import React from "react";
import { Icon, Toggle, Segmented, PillTabs, Banner, EmptyState, Chip, Checkbox } from "./components";
import { TIMETABLE, ROSTERS } from "./data";
```
Remove the `/* global ... */` line. `export` `BasicsView, TimetableView, RosterView, DriveView, AuthView, PlaceholderView` (keep `DAYS` + helpers internal). Bodies unchanged.
- [ ] **Step 2: Type-check**: `npx tsc -b` → no errors.
- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/src/setup-view.tsx
git rm subject_teacher/neis_attendance/setup-view.jsx
git commit -m "refactor(desktop-ui): port setup-view.jsx to module"
```

---

### Task 10: Port `app.jsx` → `src/app.tsx` and wire the bridge

**Files:**
- Create: `subject_teacher/neis_attendance/src/app.tsx`
- Create: `subject_teacher/neis_attendance/src/main.tsx`
- Delete (after move): `subject_teacher/neis_attendance/app.jsx`, `subject_teacher/neis_attendance/bridge.js`

- [ ] **Step 1: Move `App` into `src/app.tsx`.** Delete the pure helpers now living in `lib/transforms.ts` and import them instead. Imports:
```ts
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Icon, Chip, StatusChip, Checkbox, Ring, Bar, Banner, EmptyState, Toggle, Segmented, PillTabs } from "./components";
import { LogDock } from "./log-panel";
import { RunView } from "./run-view";
import { BasicsView, TimetableView, RosterView, DriveView, AuthView, PlaceholderView } from "./setup-view";
import { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakToggle, TweakSlider, TweakColor, TweakSelect } from "./tweaks-panel";
import { TODAY_SLOTS, TIMETABLE, ROSTERS } from "./data";
import { getApi } from "./bridge";
import {
  toIsoDate, weekKeyFromIsoDate, parseJsonResult, formatApiError, isTransientNetworkError,
  parseTextResult, settingsFromApi, settingsToApi, timetableRowsFromTsv, timetableRowsToTsv,
  rostersFromTsv, rostersToTsv, classKeyFromTimetableRow, rosterKeysFromTimetable, syncRostersToTimetable,
} from "./lib/transforms";
```
Keep `NAV`, `TWEAK_DEFAULTS` (with EDITMODE markers) and the `App` body. **Remove** the old `ReactDOM.render`/mount call at the bottom of `app.jsx` — mounting moves to `main.tsx`. `export default App;`

- [ ] **Step 2: Replace direct `window.pywebview.api.X(...)` calls** with the typed bridge. Pattern: where the old code called `window.pywebview.api.get_settings()`, call `(await getApi()).get_settings()`. Keep the existing `__onPywebviewReady`/`__registerBridge` usage for the log/progress push channel (those globals still exist via `bridge.ts`). Do not change the call arguments or the JSON parsing (`parseJsonResult` etc.).

- [ ] **Step 3: Write `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Type-check**: `npx tsc -b` → no errors.
- [ ] **Step 5: Commit**

```bash
git add subject_teacher/neis_attendance/src/app.tsx subject_teacher/neis_attendance/src/main.tsx
git rm subject_teacher/neis_attendance/app.jsx subject_teacher/neis_attendance/bridge.js
git commit -m "refactor(desktop-ui): port app.jsx to src/app.tsx + main.tsx entry, wire typed bridge"
```

---

### Task 11: Rewrite `index.html` as the Vite module entry (no CDN)

**Files:**
- Modify: `subject_teacher/neis_attendance/index.html`

- [ ] **Step 1: Replace** the CDN `<script>` tags and the seven `text/babel` scripts with a single module entry. Keep `<html ...>` attributes, the `styles.css` link is handled via the `main.tsx` import (or keep the `<link>` — either works; keep one, not both).

```html
<!doctype html>
<html lang="ko" data-theme="light" data-density="cozy" data-sidebar="expanded">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>출결 자동화 · 교과교사용</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Build and verify offline-safe output**

Run: `cd subject_teacher/neis_attendance && npm run build`
Expected: `dist/index.html` + `dist/assets/*.js|css` produced. Verify there are **no `unpkg.com`/`https://` script references** in `dist/index.html`:
Run: `grep -c "unpkg\|https://" dist/index.html` → expected `0`.
Verify asset URLs are relative (`./assets/...`): `grep -o './assets/[^"]*' dist/index.html | head`.

- [ ] **Step 3: Commit**

```bash
git add subject_teacher/neis_attendance/index.html
git commit -m "build(desktop-ui): make index.html a Vite module entry, drop CDN scripts"
```

---

### Task 12: Point pywebview at the built `dist/` (with a dev fallback)

**Files:**
- Modify: `subject_teacher/gui/webview_app.py:9-13` (`_html_url`)

- [ ] **Step 1: Update `_html_url`** to prefer the built `dist/index.html`, with a clear error if the UI hasn't been built, and an optional dev override.

```python
import os

def _html_url() -> str:
    dev_url = os.environ.get("NEIS_UI_DEV_URL")
    if dev_url:
        return dev_url  # e.g. http://localhost:5173 when running `npm run dev`
    here = Path(__file__).resolve().parent
    dist_index = here.parent / "neis_attendance" / "dist" / "index.html"
    if not dist_index.exists():
        raise FileNotFoundError(
            "Desktop UI is not built. Run: "
            "cd subject_teacher/neis_attendance && npm install && npm run build"
        )
    return dist_index.resolve().as_uri()
```

- [ ] **Step 2: Manual run (pywebview, built UI)**

Run: `cd /c/Users/admin/Desktop/2026_project/neis-attendance && py -3 -m subject_teacher.main`
Expected: window opens and renders the UI from `dist/` (works with the network OFF — verify by disabling Wi-Fi). The Run/Setup screens load via `window.pywebview.api`.

- [ ] **Step 3: Commit**

```bash
git add subject_teacher/gui/webview_app.py
git commit -m "feat(desktop-ui): load built dist UI in pywebview with dev-url override"
```

---

### Task 13: Update the PyInstaller spec to bundle the built UI

**Files:**
- Modify: `NEIS_Subject_Teacher.spec`

- [ ] **Step 1: Read the spec** and confirm how `neis_attendance` assets are currently included (`grep -n "neis_attendance\|datas" NEIS_Subject_Teacher.spec`).

- [ ] **Step 2: Ensure `datas` ships `subject_teacher/neis_attendance/dist` and `styles.css`** (not the old `.jsx`/CDN). Example addition to the `Analysis(datas=[...])` list:

```python
datas=[
    ("subject_teacher/neis_attendance/dist", "subject_teacher/neis_attendance/dist"),
    ("subject_teacher/neis_attendance/styles.css", "subject_teacher/neis_attendance"),
],
```
Adapt to the spec's existing pattern. If the spec referenced individual `.jsx` files, remove those entries.

- [ ] **Step 3: Note (do not run a full packaging build here)** — packaging verification is a separate task. Just make the spec correct and commit.

- [ ] **Step 4: Commit**

```bash
git add NEIS_Subject_Teacher.spec
git commit -m "build(desktop-ui): bundle built Vite dist in PyInstaller spec"
```

---

### Task 14: Final verification

- [ ] **Step 1: Frontend tests + build**

Run: `cd subject_teacher/neis_attendance && npm test && npm run build`
Expected: all vitest tests pass; build succeeds; `dist/index.html` has zero CDN references.

- [ ] **Step 2: Python tests still green** (no backend behavior changed)

Run: `cd /c/Users/admin/Desktop/2026_project/neis-attendance && py -3 -m pytest -q`
Expected: same pass count as before the migration (currently 116).

- [ ] **Step 3: Offline smoke test**

Disable network. Run `py -3 -m subject_teacher.main`. Expected: UI renders fully (this is the whole point of the migration). Re-enable network; confirm NEIS/Drive features work.

- [ ] **Step 4: Dev-mode smoke test**

Run: `cd subject_teacher/neis_attendance && npm run dev`, open the printed `http://localhost:5173` in a browser. Expected: UI renders against the mock API (sample data); no `pywebview` errors block rendering.

- [ ] **Step 5: Final commit / open PR**

```bash
git add -A
git commit -m "chore(desktop-ui): finish Vite migration verification"
```

---

## Self-Review Notes (carried out while writing)

- **Spec coverage:** offline (Tasks 11–12, 14), no-CDN (Task 11), no runtime Babel (Tasks 1, 11), module system (Tasks 3–10), TypeScript (all tasks), dev mock (Task 2), bridge preserved incl. push channel (Task 2/10), pywebview loader (Task 12), packaging (Task 13). PWA-stack parity via copied configs (Task 1).
- **Out of scope (call out to the user):** full strict typing of every component prop (left pragmatic), redesign of the UI, Tauri/shell change, removing the unused `icons.jsx`/`sidebar.jsx` (optional cleanup — delete only after confirming they're unreferenced).
- **Ordering caveat:** Task 2's bridge test imports `data.ts`; run **Task 4 before Task 2** (or stub `data.ts` first). Everything else is in dependency order (leaves → `app.tsx`).
- **Risk:** the only behavior-bearing code that moves is the `lib/transforms.ts` helpers — guarded by characterization tests (Task 3). Components move verbatim, so visual/behavior regressions are unlikely but should be eyeballed in the Task 14 offline run.
