# PR #71 — CI failure root-cause report

**Verdict: environment issue.** Not a Phase B defect, not a merge-state interaction.

- **PR:** [#71](https://github.com/OsamaIbrhim/ATHR/pull/71) — WP-008 Phase B: Price Books and Pricing Evaluation (supersedes auto-closed #64)
- **Branch:** `feat/wp-008b-price-books`
- **Head:** `b490315750d2bf407dde81ea949bdf4418bf0ba4`
- **Base:** `master` @ `e7980cace0140991b0e95e205ecb8407aeb8ec36` (2026-08-11T08:37:00Z, merge of #69 / WP-T1)
- **Merge state:** `MERGEABLE` / `UNSTABLE`
- **Investigated:** 2026-08-12

---

## 1. First error lines, verbatim

### `migration-gate`

Run [31619501396](https://github.com/OsamaIbrhim/ATHR/actions/runs/31619501396/job/94190468065), job `94190468065`, step **`Run npm ci`**:

```
npm ERR! code 1
npm ERR! path /home/runner/work/ATHR/ATHR/pos-electron/node_modules/electron
npm ERR! command failed
npm ERR! command sh -c node install.js
npm ERR! RequestError: socket hang up
```

### `Build Windows installer`

Run [31619501394](https://github.com/OsamaIbrhim/ATHR/actions/runs/31619501394/job/94190467513), job `94190467513`, step **`Install dependencies`**:

```
npm error code 1
npm error path D:\a\ATHR\ATHR\pos-electron\node_modules\electron
npm error command failed
npm error command C:\Windows\system32\cmd.exe /d /s /c node install.js
npm error RequestError: socket hang up
```

**Same failure, same package, two different operating systems, 61 seconds apart** (16:50:47Z and 16:51:48Z). Both died inside dependency installation — the Electron binary postinstall download. **Neither job reached a single line of project code.** `migration-gate` failed at step 4 of 12, before `Create isolated migration databases`.

### `release-gate`

Purely downstream — no independent failure. Its env block at the point of exit:

```
BACKEND_RESULT: success
WORKSPACE_RESULT: success
MIGRATION_RESULT: failure
ADMIN_RESULT: success
ADMIN_E2E_RESULT: success
POS_RESULT: success
HARD_SMOKE_RESULT: skipped
DOCKER_RUNTIME_SMOKE_RESULT: success
```

It fails on `test "$MIGRATION_RESULT" = "success"`. Every other gate reads `success`.

### Everything else in the same run passed

`workspace-foundation`, `backend`, `admin`, `admin-e2e-smoke`, `pos`, `docker-runtime-smoke` — all pass. `hard-smoke` and `hard-load` skipped.

---

## 2. The head commit is identical — and that is itself the finding

Run [31506715534](https://github.com/OsamaIbrhim/ATHR/actions/runs/31506715534) — the previously reported green run — has head SHA **`b490315750d2bf407dde81ea949bdf4418bf0ba4`**, the same commit as PR #71's head. The branch has not moved.

### The prior report was accurate at the job level

Job-level results from run 31506715534:

| job | result |
|---|---|
| workspace-foundation | success |
| backend | success |
| **migration-gate** | **success** |
| admin | success |
| admin-e2e-smoke | success |
| pos | success |
| docker-runtime-smoke | success |
| hard-smoke | success |
| **release-gate** | **success** |
| hard-load | failure |

The run's overall conclusion is `failure`, but solely from `hard-load`, which `release-gate` does not gate on — its required list is workspace / backend / migration / admin / admin-e2e / pos / hard-smoke / docker-runtime-smoke. The scheduled master run [31560547986](https://github.com/OsamaIbrhim/ATHR/actions/runs/31560547986) also fails `hard-load`, so that failure is pre-existing on master and independent of this branch.

### One real gap in the prior claim

Run 31506715534 is `workflowName: "CI"`, triggered by `workflow_dispatch`. The Windows installer lives in a **separate workflow** (`.github/workflows/pos-windows-installer.yml`), which that dispatch never invoked.

**The Windows installer job has never run on `b490315`.** The earlier "every merge-gating job passed" was based on a run that did not include it.

This confirms the differing-job-set hypothesis: the `pull_request` job set is strictly larger than what the `workflow_dispatch` exercised. The installer triggers on `workflow_dispatch`, `push` to `pos-rc`, and `pull_request` to `master` — the last filtered to paths `pos-electron/**`, `packages/**`, `package.json`, `package-lock.json`, `tsconfig.base.json`, and its own workflow file.

> **Unverified:** whether the installer is a *required* check could not be confirmed. The branch-protection API returns `403: Upgrade to GitHub Pro or make this repository public` on this private repo.

---

## 3. The merge-state hypothesis is dead

```
$ gh api repos/OsamaIbrhim/ATHR/compare/e7980ca...b490315
{"status":"ahead","ahead":11,"behind":0,"total":11}
```

Master's tip `e7980ca` is dated 2026-08-11T08:37:00Z — it **has not moved** since the rebase, and it predates the 08-11 green run.

`behind: 0` means the merge commit is a **fast-forward**: the state `pull_request` CI tested is identical to the branch tip. There is no untested merge state, and no state "neither branch has been tested in."

---

## 4. Migration count is correct — but this run did not verify it

| | |
|---|---|
| Assertion | `backend/scripts/prisma-migrate-deploy.test.cjs:16` → `assert.equal(countMigrationFolders(), 160)` |
| Actual folders on branch | **160** |
| Last seven | `202608070001` … `202608070007` (Phase B) |

Because `behind: 0`, master's #67 correction to 153 is already an ancestor of this branch. 153 + 7 = 160 is consistent, and **no competing assertion exists in the merge state**. There is no count or assertion mismatch.

### Which evidence is which

This run **proved nothing about migrations** — it died at `npm ci`, eight steps before the first database step. The proof comes from run 31506715534 on the *identical* SHA:

```
success  Run npm ci
success  Create isolated migration databases
success  Resolve exact migration baselines
success  Enforce immutable forward-only migrations
success  Apply current migrations to a clean database twice
success  Verify tenant database constraints (WP-007 Phase B)
success  Verify Price Book behaviour (WP-008 Phase B)
success  Build a populated database from the release baseline
success  Upgrade populated release data with current migrations
```

Both the **clean** and **populated** paths passed. Since the merge state is byte-identical to that SHA (`behind: 0`), that evidence transfers to the merge state.

---

## 5. Why this is transient, not systemic

- **Not version drift.** Electron is pinned `39.8.10` in `pos-electron/package.json:33`, set by `e93f794` on 2026-08-06. The installer workflow passed on this branch five times afterward — 08-07 ×2, 08-08, 08-09 ×2 — all on that exact pin.
- **Not the lockfile.** `de475ba` (2026-08-09) was the last `package-lock.json` touch and is an ancestor of `b490315` — which installed Electron successfully in `migration-gate` on 08-11.
- **Not configuration.** Every CI job runs plain `npm ci` with no `ELECTRON_SKIP_BINARY_DOWNLOAD` and no mirror override. `backend`, `admin`, `pos`, `docker-runtime-smoke`, and `workspace-foundation` ran the same command in the same run and passed — so the two failures cannot be explained by a job-level config difference.
- **Not a missing artifact.** `socket hang up` is a connection-level reset. A yanked or missing release would surface as HTTP 404.

`setup-node`'s `cache: npm` caches the npm tarball store, **not** the Electron binary cache (`~/.cache/electron`, `%LOCALAPPDATA%\electron\Cache`). Every runner therefore fetches the Electron zip from GitHub releases independently on every run. Two of ten runners hit a reset inside the same one-minute window.

---

## 6. Underlying fragility (separate from the flake)

`migration-gate` is a Postgres/DDL job with no need for Electron, yet it runs `npm ci` at the workspace root (`working-directory: ${{ github.workspace }}`, `ci.yml:93-94`) and so takes a hard dependency on a GitHub-releases binary download.

That is an unnecessary failure surface on a merge-gating job. Setting `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for the non-Electron jobs would remove it. This is a robustness improvement, **not the cause**.

---

## 7. Recommendation

Re-run the two failed workflows — as **verification, not hope**. The distinction is load-bearing in two different ways:

1. **`migration-gate`** has already passed on this exact tree (run 31506715534, full clean + populated migration sequence). A re-run confirms the network recovered.
2. **`Build Windows installer`** has **never run on `b490315`**. Its re-run is a genuine first verification of a job previously reported as covered when it was not.

Optionally, harden the non-Electron CI jobs with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so a GitHub-releases blip can no longer fail a database gate.

---

## Appendix — commands used

```bash
gh pr view 71 --json headRefOid,baseRefName,mergeable,mergeStateStatus
gh pr checks 71
gh run view 31619501396 --log-failed --job 94190468065     # migration-gate
gh run view 31619501394 --log-failed --job 94190467513     # windows installer
gh run view 31619501396 --log-failed --job 94191595326     # release-gate
gh run view 31506715534 --json headSha,event,conclusion,workflowName
gh run view 31506715534 --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"'
gh api repos/OsamaIbrhim/ATHR/commits/master --jq '.sha'
gh api repos/OsamaIbrhim/ATHR/compare/e7980ca...b490315 \
  --jq '{status,ahead:.ahead_by,behind:.behind_by}'
gh run list --workflow="POS Windows Installer" --limit 10
ls backend/prisma/migrations | grep -c '^20'                # → 160
git log --oneline -3 -- package-lock.json pos-electron/package.json
```
