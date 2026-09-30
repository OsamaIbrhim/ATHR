# ATHR POS – Electron

Offline-first cashier app built with React, Vite, Electron, and a local
`better-sqlite3` (SQLite, WAL) database. See the repository [full installation and operations guide](../README.md)
for API/database setup, deployment, recovery, and security guidance.

## Behavior

- Sales, local stock changes, and outbox commands commit in one transaction.
- Pending sales upload before a new product/price/stock snapshot is accepted.
- Automatic synchronization runs at login, every 15 seconds, and after network
  reconnection; operators can also select **Sync now**.
- Multi-page change pulls must reach a strictly advancing final cursor before
  catalog validity is restored. A partial, stalled, or excessive pull keeps
  checkout blocked instead of exposing a half-applied catalog.
- The catalog syncs by protocol 3: a paged snapshot that can resume after a
  crash (the cursor is stored only after the last page), then entity deltas.
  Scan resolves exact barcode (pack size), SKU, scale label, then text search.
  Quantities are decimal per the item's unit precision.
- The header shows real API online/offline state, last successful sync, pending
  sale count, and the last error.
- A manager-issued, one-use code enrolls the stable device ID. The resulting
  secret is encrypted with Electron `safeStorage`; Admin can display, rename,
  monitor, or revoke the terminal.
- Access, refresh, device, and offline-accounting credentials remain in the
  Electron main process. The renderer receives only non-secret user, terminal,
  and authorization metadata.
- SQLite mutations run in a single `db.transaction(...)`; a failure rolls the
  whole change back and the cashier sees an error instead of a false sale. The
  database runs in WAL mode (`synchronous=NORMAL`), so a commit is a small
  append, not a whole-file rewrite, and survives an app crash.
- An enrolled terminal and a cashier/branch-manager login from the same branch
  are both required for sales, returns, synchronization, and heartbeats.
- Every app start returns to cashier login instead of silently reopening the
  previous session. After one successful online login, the same cashier can
  unlock an unexpired open shift offline using a salted `scrypt` verifier; the
  password itself is never stored.
- Printing uses a main-process-owned window lifecycle. Print cancellation is
  reported separately and cannot undo or duplicate a saved sale.
- Held sales are stored in the durable SQLite database, scoped to the current
  branch, cashier, and shift. Resuming a draft rebuilds every line from the
  current signed price catalog and available stock; open drafts block shift
  closure until they are completed or deleted.

## Run

```bash
npm ci
npm run dev:electron
```

The development build uses `http://localhost:3000/api/v1`. Override it before
starting Electron when the backend runs elsewhere:

```bash
ATHR_API_URL=https://api.example.com/api/v1 npm run dev:electron
```

For a packaged build, enter the HTTPS API URL on the trusted device setup
screen or define `ATHR_API_URL` in the launch environment. The main process
validates and stores the non-secret deployment address; renderer content never
receives device credentials.

## Local database engine

`better-sqlite3` ships N-API prebuilt binaries inside the npm package
(`node_modules/better-sqlite3/prebuilds/<platform>-<arch>.node`). N-API is
ABI-stable, so the **same binary** loads in plain Node (vitest) and in
Electron 41: there is no `electron-rebuild` step. `npm ci` at the repo root is
all that `dev:electron`, `npm test`, `pack` and `dist` need.

Packaging notes (`package.json` -> `build`):

- `npmRebuild: false` stops electron-builder from recompiling native modules
  from source (that would require Visual Studio on the Windows runner).
- `asarUnpack` keeps the `.node` file outside `app.asar` (Windows cannot
  `dlopen` from an archive); `files` drops the other platforms' prebuilds and
  the C++ sources, so only `win32-x64.node` (~2 MB) is shipped.

Schema changes are ordered migrations in `electron/db/migrations.ts`, tracked
with `PRAGMA user_version`. Append a new entry; never edit an old one. A
failing migration rolls back and the app refuses to start on that database
instead of running on a half-migrated one.

Existing terminals: the first launch of this engine copies the old sql.js file
to `athr_pos.sqlite.pre-w4a.bak` (never overwritten or auto-deleted; a
confirmed factory reset removes it), converts it to WAL and migrates it in
place.

## Reset a test installation

The supported DevTools reset commands deliberately clear credentials inside
the main process without returning them to the renderer:

```js
await window.athr.api_clear_session()
location.reload()
```

To clear both terminal enrollment and cashier login:

```js
await window.athr.api_clear_device()
location.reload()
```

## Test and build

```bash
npm test
npm run test:soft
npm run build
npm run dist   # Windows NSIS installer
```

## Get a CI-built Windows installer

The `POS Windows Installer` workflow builds the installer on every pull request
that touches POS code, but it only keeps the ~102 MB binary when it is actually
wanted, because uploading it on every run exhausts the account-level Actions
artifact storage quota.

To download an installable build for a smoke test on the POS laptop:

1. Open **Actions → POS Windows Installer → Run workflow**.
2. Select the branch you want to build and click **Run workflow**.
3. When the run finishes, download the `athr-pos-windows-<sha>` artifact from
   that run's summary page. It is retained for 7 days.

Pushes to `pos-rc` upload the artifact automatically. Pull request runs do not —
they still build the installer and still fail if it cannot be produced, and
their run summary repeats the instructions above. Published releases are not
affected: `POS Release` attaches the installer to an immutable GitHub Release,
which does not consume the artifact quota.

ATHR uses `athr_pos.sqlite`. The first ATHR launch copies and verifies a legacy
`bold_pos.sqlite` plus secure state without deleting the source. Preserve both
files whenever pending outbox sales exist. Never re-enter a sale after a print
error until its `sync_id` is checked.
