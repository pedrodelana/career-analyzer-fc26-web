# FC26 Career Analyzer

A local, read-only EA SPORTS FC 26 Manager Career analyzer. The interface supports **English, Español and Português (Brasil)**; English is the initial default. Excel workbooks use English. Built with React, TypeScript, Vite, Tailwind, Fastify, Python and SQLite.

## Start on this computer

The Node packages, project-local Python, Pillow, binary decoder and local names database have been prepared. From the project folder:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The API listens on **http://127.0.0.1:3001**. Keep the terminal running; press `Ctrl+C` to stop both servers.

Choose **Settings → Language → Interface language** to change the interface immediately. The preference is saved in this browser and synchronized across tabs on the same origin. It does not require saving local folder settings. Translations live in `apps/web/src/locales/`; the React language provider also formats dates, numbers and football positions. Original club/player names and unknown technical diagnostics retain their source text.

To run the servers separately, use two terminals in the project folder:

```powershell
# Terminal 1: backend
npm.cmd run dev:api
```

```powershell
# Terminal 2: frontend
npm.cmd run dev:web
```

Use `npm.cmd` on Windows when PowerShell blocks `npm.ps1`. Changing the machine's execution policy is unnecessary.

## Setup on another computer

1. Install [Node.js 24 LTS](https://nodejs.org/en/download) or newer and [Git](https://git-scm.com/downloads).
2. Install the locked web/backend packages:

   ```powershell
   npm.cmd ci
   ```

3. On Windows x64, prepare Python and the pinned FC26 decoder inside `.tools`:

   ```powershell
   npm.cmd run setup:python
   ```

   This downloads Python 3.13.7 from python.org, pip from bootstrap.pypa.io, Pillow from PyPI, and the pinned public decoder from GitHub. It does not register Python globally, install mods or change Windows settings. The script's execution-policy override applies only to its own PowerShell process. Internet is needed for initial dependency installation only.

   Alternatively, use your existing Python 3.11+ environment, install `parser/requirements.txt`, clone the decoder into `.tools/fc26-save-parser`, and set `PYTHON_PATH` if necessary. The API also detects `.venv/Scripts/python.exe` on Windows and `.venv/bin/python` on other systems. Actual FC26 game database extraction requires the Windows game installation and its Oodle DLL.

4. Verify the environment:

   ```powershell
   npm.cmd run doctor
   ```

5. Start both servers, open **Settings**, and check the local folders. Generate the names database from your installed game, then refresh the chosen save. The game directory is detected automatically at common installation paths or can be configured explicitly. Generation may take several minutes and stores extracted data under `data/`.

No separate SQLite server, .NET SDK, Electron, cloud account, paid API or Figma installation is required. Live Editor is optional: its existing image directories are used only as read-only sources.

## Workflow

- **Careers:** scans every regular `CmMgr*` file, case-insensitively. The library opens first, preserves individual errors, and offers a saved selection without activating it silently. Missing files are hidden from the library and save picker after scanning; their snapshots and history remain in SQLite. Entries return automatically if their files reappear.
- **Use career:** selects the latest file within that career. **Choose another save** pins an older file. Library discovery does not change the active selection.
- **Custom club names:** full names are recovered automatically from verified `mrsu` metadata, even when the team table says `Create Club Team`. **Name club & open** appears only when extraction fails; **Career settings** lets you edit that manual fallback. A recovered custom name takes priority over a previously entered label. Names, sources and team associations are persisted under the internal career identity.
- **Automatic age reference:** every import/refresh extracts the last completed match from the validated BNRY/LTLE result summary, falling back to played match history. Ages refer to that match, not necessarily the current career day. No manual date is required. Overview shows Last match, Next match, Age reference date and source; unavailable dates/ages stay explicit. Date of birth is shown as `DD/MM/YYYY` in both squads.
- **Refresh save:** validates membership, hashes the input, parses changed data, saves a snapshot and checks for new/changed minifaces even when the save is unchanged.
- **First team / Youth academy:** separate filters and sorting, including age/OVR/POT ranges, football position order, and academy cards. Click a player to see its details, history and manual portrait upload.
- **Integrity:** shows expected and resolved squad counts and every ambiguous/unresolved record. Ambiguous candidates are retained for inspection, never silently selected or dropped.
- **Export Excel:** writes `Summary`, `First Team`, and `Youth Academy` sheets for the selected career/save, including available portraits, numeric cells, filters, provenance and integrity warnings. A local copy is also retained under `exports/`.
- **Development:** preserves snapshot history. Reliable comparisons between files require confirmed career and player identities.

Internal position order: `GOL, LE, ZAG, LD, VOL, MC, MEI, ME, MD, PE, PD, ATA`. English labels are `GK, LB, CB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST`. Missing values sort last in either direction.

## Current parsing limits

The application runs against real local saves, but the FC26 format is reverse engineered. The implementation deliberately exposes these limits:

- **Persistent career identity is not validated by the current decoder.** Real saves appear as separate, unconfirmed entries, including saves of the same club. Confirmed-identity grouping, latest/pinned selection and isolation are implemented and covered by synthetic contract tests; no heuristic merges real careers.
- **Changed unconfirmed saves receive a new player context.** This protects portraits and history when a file is overwritten by another career. Portraits cannot safely carry across such changes automatically.
- **Age reference differs from the current career day.** Ages use the last completed match, never file/upload/computer dates. The next-fixture mapping is not yet validated, so Next match displays Unavailable. Saves with no reliable completed-match date still import normally, with unknown ages.
- **Unrecognized custom metadata still requires manual entry.** `lyxL.AUsv` supplies official team names; `mPrV.zvSh` contained person names in inspected saves. For generic team labels, the parser decodes length-prefixed `mrsu` text and validates its association with the controlled club. Unsupported, malformed or ambiguous records retain the manual fallback. The save-slot title and global teams database are never custom-name sources. Separate unconfirmed files are not merged by Team ID, name or metadata token.
- **Ambiguous player IDs stay unresolved.** All candidates remain visible in the integrity panel. The newest audited created-club saves have 26 resolved senior players and 16 academy players; other snapshots may contain ambiguities, which remain explicit.
- **Match statistics cover stored match-history rows only.** No full-season completeness is asserted. Goals and assists are omitted. Academy professional-contract semantics are not assumed.
- Some name IDs can remain unresolved even with the current local global-names file. They display `Unknown Player <id>`.
- The default Live Editor image folders were unavailable on this computer. Configure your existing folders in Settings or upload portraits. Conversion for DDS/PNG/JPEG/WEBP, hash caching, manual precedence and Excel embedding are tested.

See [implementation and validation notes](docs/IMPLEMENTATION.md) for sources, domain boundaries and acceptance coverage. These limits must be resolved with verified mappings; fabricated data is not a substitute.

OVR, POT and the verified player attributes are converted from raw save values using `+1` once in Python. All screens, sorting, filters, histories and Excel consume those normalized values. For example, Woolley's raw OVR 68 displays as 69. `POT - OVR` uses the same normalized inputs. Squad tables show separate secondary positions and date of birth. First Team excludes Apps, Minutes and Avg. rating; Youth Academy excludes Agreement. Excel follows those exclusions.

SQLite migrations run automatically when the backend starts. Existing snapshots are preserved and upgraded to normalization version 2, with original raw ratings retained separately. Before converting legacy snapshots, a complete SQLite backup is created under `data/backups/`. No save file is edited. Automatic match-date metadata is stored in snapshot JSON without a schema change. Refresh older saves to extract it; old snapshots and legacy manual-date rows are preserved, but manual dates no longer calculate age.

## Build and validation

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:parser
npm.cmd run build
npm.cmd audit --omit=dev
```

For a local production build:

```powershell
npm.cmd run build
# Terminal 1
npm.cmd run start:api
# Terminal 2
npm.cmd run preview:web
```

The preview uses the same frontend address, `http://127.0.0.1:5173`, and proxies `/api` to port 3001.

Optional browser smoke test, while both servers are running:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.tools\browsers'
node node_modules/playwright/cli.js install chromium
npm.cmd run test:e2e
npm.cmd run test:e2e:regression
```

The smoke test uses your configured saves, imports local snapshots, changes the local active selection and saves screenshots/workbooks under `.tools/screenshots`. It never changes the saves or sends their contents to a remote service. Unit/integration tests use synthetic fixtures under `.tools/test-data` and an in-memory SQLite database.

The regression browser test uses the running frontend with an isolated synthetic API/SQLite catalog to test club naming, editing, automatic ages, dates of birth, corrected ratings, filtering, sorting, squad column layouts and Excel downloads. It does not assign test names or dates to your real careers. Persistence/migration tests also use temporary SQLite files, with backups under `data/backups/`.

An additional optional read-only audit hashes each real save before and after parsing:

```powershell
node scripts/python.mjs scripts/validate-real-saves.py
```

## Duplicate player records

When a duplicate player ID appears in the integrity panel, click **Use [player name]** beside the record you recognize. The choice is saved in local SQLite for that snapshot, survives reopening the app and refreshing unchanged save content, and can be changed or undone in the same panel. Both candidates remain visible for review. Refresh older snapshots once to load selectable candidates. Conflicting squad memberships still require verification and cannot be resolved by choosing a player record alone.

Selections are not carried into changed save content or other careers. The selected player's record attributes become available in the squad, profile and Excel export; match statistics, wages and automatic images linked only by the duplicated ID remain unassigned. The original game save is never edited.

## Project layout

```text
apps/web/          React UI and local Vite proxy
apps/api/          Fastify routes, catalog, images, SQLite, Excel export
packages/shared/   Domain types, position labels and sorting
parser/src/        Read-only decoder bridge and normalization
parser/tests/      Duplicate identity, integrity and image conversion tests
tests/             API, catalog, isolation, export and image cache tests
scripts/           Development runner, setup, diagnostics and local smoke test
data/              Private SQLite database, names and extracted game data
storage/players/   Imported originals, WEBP cache and PNG Excel derivatives
exports/           Generated workbooks
docs/              Implementation, dependencies and validation notes
```

Private data, save files, images, downloaded tools, exports and `.env` are ignored by Git. Back up `data/` and `storage/` together if you want to preserve your local catalog and portraits. Closing the servers before copying the database avoids an inconsistent WAL backup.

Optional environment overrides are listed in `.env.example`. If changing the API port, also update the target in `apps/web/vite.config.ts`; if changing the frontend origin, update the Vite port and `WEB_ORIGIN` together.

Unofficial fan project; not affiliated with Electronic Arts.
