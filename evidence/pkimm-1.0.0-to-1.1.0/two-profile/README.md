# PKIMM 1.0.0 → 1.1.0: Two-Profile Holdout Verification

- **Tested commit:** [`c752cc7`](https://github.com/fexx301/returner/commit/c752cc7f2fecc644b28cf1633320d1ea9afac87b)
- **App & model:** [pkic/self-assessment](https://github.com/pkic/self-assessment) widget v1.0.3 (MIT) + [pkic/pkimm @060be60](https://github.com/pkic/pkimm/tree/060be60bf6ad16a0d6fcb967ef6d06e29771bf3f/tools/self-assessment) models `1.0.0 → 1.1.0` (`examples/pkimm/prepare.sh`).
- **App default verified from source:** `src/components/Assessment/Assessment.tsx` initializes every category to `level: 1` (`"1 - Initial"`, `applicability: true`, matching level 1 in `data-1.0.0.yaml`).

## Two Saved v1.0.0 Profiles

Each profile is seeded on model 1.0.0 in its own Chrome user-data directory, reloaded, and verified by Kane before Returner snapshots it:

| Profile | Assessment / Assessor names | Strategy and Vision (`G.1 → G.1`) | Infrastructure management (`M.8 → M.8`) | Sourcing (`R.10 → R.14`, renumbered) | Snapshot isolation |
| --- | --- | --- | --- | --- | --- |
| **Profile A** | Fresh random marker per run | `3 - Advanced` | `4 - Managed` | `2 - Basic` | Repair workspace (marker redacted from agent prompts) |
| **Profile B (holdout)** | Separate random marker per run | `5 - Optimized` | `1 - Initial` *(left untouched at app default)* | `4 - Managed` | Separate OS temp directory outside the repair workspace; expected values excluded from agent prompts |

Both read-only replay checks start with a page reload, verify both names on Report, verify all three saved answers, and confirm the new `Cryptography` (`G.5`) category appears on Governance.

## 1. Deliberate Test Case — Negative Control (`negative-control/`)

- **Label:** **DELIBERATE TEST CASE** (not a real agent repair).
- **Command:** `examples/pkimm/negative-control.sh`
- **Patch:** [`examples/pkimm/incomplete-342.patch`](../../../examples/pkimm/incomplete-342.patch) (copied into [`negative-control/incomplete-342.patch`](negative-control/incomplete-342.patch)). When loading an unversioned v1.0.0 save (`!progress["G.5"]`), it hard-codes `G.1 = 3`, `M.8 = 4`, `R.14 = 2` for every returning user while leaving new v1.1.0 saves functional.
- **Actual live verdicts (Returner exit `1` — rejected overall):**
  - Profile A v1 baseline + broken v1.1.0 ([`before/report.html`](negative-control/before/report.html)): `old baseline: pass`, `new user: pass`, `returning user: fail` (blank page, `Cannot read properties of undefined (reading 'result')`).
  - Profile B v1 baseline ([`profile-b-baseline/report.html`](negative-control/profile-b-baseline/report.html)): `old baseline: pass` (`5 - Optimized`, `1 - Initial` default, `4 - Managed` verified after reload).
  - Profile A replay on incomplete patch ([`after/report.html`](negative-control/after/report.html)): `new user: pass`, `returning user: pass` (`3 / 4 / 2` + `Cryptography`).
  - Profile B holdout replay on the same build ([`profile-b-after/report.html`](negative-control/profile-b-after/report.html)): `new user: pass`, `returning user: fail` — Kane failed specifically on `Sourcing` (`Final verification failed: ""Sourcing" is at level "4 - Managed"."`; screenshot shows `R.14 Sourcing` selected at `2 - Basic` and the radar chart shows `G.1 = 3`, `M.8 = 4`, `R.14 = 2`).
  - Overall Returner verdict ([`negative-control/repair-report.html`](negative-control/repair-report.html)): **rejected (`exit 1`)**.

## 2. Genuine Agent Repair — Codex (`codex-repair/`)

- **Command:** `examples/pkimm/run.sh codex` (separate live run; `--attempts 3`; Profile B expected answers and snapshot kept outside Codex's workspace and prompts — see [`prompt-1.txt`](codex-repair/prompt-1.txt) and [`prompt-2.txt`](codex-repair/prompt-2.txt)).
- **Attempts taken:** **2 attempts** (exit `0`).
  - **Before** ([`before/report.html`](codex-repair/before/report.html)): Profile A `old baseline: pass`, broken v1.1.0 `new user: pass`, `returning user: fail` (blank page, `Cannot read properties of undefined (reading 'result')`).
  - **Profile B baseline** ([`profile-b-baseline/report.html`](codex-repair/profile-b-baseline/report.html)): `old baseline: pass` (`5 / 1 (default) / 4` verified after reload).
  - **Attempt 1** ([`attempt-1/report.html`](codex-repair/attempt-1/report.html), [`attempt-1.json`](codex-repair/attempt-1.json)): Codex added the 1.0.0 → 1.1.0 key migration in `src/utils/assessmentProgress.ts`, and `new user` passed, but Kane's combined Governance checkpoint assertion failed on Profile A (`"Strategy and Vision" is at level "3 - Advanced" and a category named "Cryptography" is listed.`) even though Kane observed both on the page. Returner rejected attempt 1 and sent Kane's redacted finding back as [`prompt-2.txt`](codex-repair/prompt-2.txt).
  - **Attempt 2** ([`repair.diff`](codex-repair/repair.diff), [`attempt-2.json`](codex-repair/attempt-2.json)): Codex kept `src/utils/assessmentProgress.ts` (mapping all 9 renumbered categories from the original 1.0.0 save, detecting 1.0.0 saves via `"M.5" in saved` or `savedVersion === "1.0.0"`, and preserving each user's actual levels) and upgraded `Category.tsx` / `Module.tsx` with semantic `<input type="radio">` controls and a module maturity summary table.
    - **Profile A replay** ([`after/report.html`](codex-repair/after/report.html)): `new user: pass`, `returning user: pass` (`3 - Advanced`, `4 - Managed`, `2 - Basic`, `Cryptography` listed; verified after reload).
    - **Holdout Profile B replay** ([`profile-b-after/report.html`](codex-repair/profile-b-after/report.html)): `new user: pass`, `returning user: pass` (`5 - Optimized`, `1 - Initial` default preserved, `4 - Managed`, `Cryptography` listed; verified after reload).
    - **Fresh rehearsal with brand-new marker** ([`fresh/report.html`](codex-repair/fresh/report.html)): `old baseline: pass`, `new user: pass`, `returning user: pass`.
  - Overall Returner verdict ([`codex-repair/repair-report.html`](codex-repair/repair-report.html)): **pass (`exit 0`)**.

## Privacy & Disclosures

- **Negative-control step log detail:** In [`negative-control/profile-b-after/report.json`](negative-control/profile-b-after/report.json), the deliberate `3 / 4 / 2` patch overwrote all three checked answers (visible on the radar chart in [`shots/returning-user.jpg`](negative-control/profile-b-after/shots/returning-user.jpg): `G.1 = 3`, `M.8 = 4`, `R.14 = 2`). Because PKIMM's original non-semantic level cards render all five level labels as page text, Kane passed the first two tabs before catching and failing on `Sourcing` (`2 - Basic` instead of `4 - Managed`), which rejected the patch overall (`exit 1`).
- **Genuine Codex attempt-2 UI additions:** Attempt 1 wrote the category migration in `src/utils/assessmentProgress.ts` but failed Kane's Governance checkpoint on PKIMM's non-semantic `<div>` level cards. On attempt 2, Codex kept the migration and also upgraded `Category.tsx` to semantic radio inputs (`role="radiogroup"`) and added a visible maturity summary table in `Module.tsx` — real unedited agent output; an upstream maintainer would likely merge the migration and review the UI changes separately.
- Raw Chrome user-data profiles (`old-profile/`, `fresh-profile/`, `returning-profile/`), credentials, and sealed `.evidence` archives remain local and are never committed.
- Absolute local workspace paths in `attempt-*.json`, `holdout-attempts.json`, `prompt-*.txt`, and `report.json` were shortened to `…/returner` / `…/returner-holdout` before publishing; verdicts, step logs, summaries, diffs, and screenshots are unmodified.
