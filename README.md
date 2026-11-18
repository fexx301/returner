# Returner

**Will yesterday’s draft survive today’s release?**

Returner runs one release twice in real Chrome with Kane CLI. The first browser arrives empty. The second brings a draft created on the previous release. The two checks share the same localhost origin and use separate synthetic profiles.

| Recorded run | New user | Returning user |
| --- | --- | --- |
| [Fieldnotes, deliberately broken v2](evidence/fieldnotes-before/report.json) | Passed | Failed to find the v1 draft |
| [Fieldnotes, repaired v2 replayed from the same v1 snapshot](evidence/fieldnotes-after/report.json) | Passed | Edited original draft survived another browser restart |
| [DeckMark v2.5.3 → v2.5.4](evidence/deckmark-2.5.3-to-2.5.4/report.json) | Passed | Found the original note, edited it and reloaded it |

Open either evidence folder’s `report.html` locally for the side-by-side view. The fixture has an intentional storage-key regression. The DeckMark run uses unmodified production builds from two upstream tags. These results apply to the recorded draft flows.

## Run the demo

Requires Node 22+, Chrome, and a signed-in Kane CLI. The Node CLI has zero package dependencies. Each live rehearsal uses TestMu credits. [Kane installation and sign-in](https://www.testmuai.com/docs/kane-cli-introduction)

```sh
npm run demo
```

This command runs against the broken fixture and should exit 1. Copy the evidence directory printed at startup. Replay it against the repaired release:

```sh
node src/returner.mjs --replay .returner/run-YOUR-ID --new examples/draft/v2
```

The replay uses the original port, marker, task and saved v1 profile. Each attempt gets its own working copy. The built-in draft check reopens the browser once more to confirm the edited value persisted. The expected exit code after the fix is 0.

## Test your own builds

```sh
node src/returner.mjs --old ./v1 --new ./v2 --promise "My draft survives the release"
```

Supply two static browser builds with a root `index.html`. Keep that directory limited to files intended for the browser. The local file server serves the selected build on loopback. The default task uses a title and body. For a different editor, use `--seed` to describe creating a record and `--check` to describe reopening, editing and checking it. The CLI substitutes a fresh `{title}` and `{body}` per run and retains them for replay. The additional read-only check is specific to the built-in draft task. For a custom task include the final persistence check in your objective.

Exit 0 means every required Kane check passed. Exit 1 means a release check failed its assertion. Exit 2 means evidence was insufficient, for example a failed baseline, interrupted runner, occupied replay port or missing document request. The CLI records completed stages in `report.json` and `report.html`. Keep the entire run directory locally for replay. Share the reports only. Browser profiles stay out of git.

## Repair with a coding agent

Give Codex the failed report and the candidate app directory. Ask it to repair the app and verify on a disposable profile using `kane-cli run --agent`. Keep the original objective and old-state snapshot intact. For the release decision run the independent Returner replay above. The checked-in fixture includes the broken and repaired candidates so a judge can repeat the comparison on their own generated marker.

## External confirmation

The [v2.5.3](https://github.com/ThomasCrouzet/deckmark/releases/tag/v2.5.3) and [v2.5.4](https://github.com/ThomasCrouzet/deckmark/releases/tag/v2.5.4) source archives were built separately with `npm ci --legacy-peer-deps` and `npm run build`. Their `build/` directories were served successively from the same address. The archived JSON includes each objective, marker, step log, runner summary and credits. Browser observations come from Kane. A navigation served entirely from a service worker can yield an inconclusive result because Returner also checks that its server received a document request.

Run `npm test` for the local CLI regression check. It uses a stand-in runner and requires loopback access. The evidence folders contain the separate real Chrome runs.
