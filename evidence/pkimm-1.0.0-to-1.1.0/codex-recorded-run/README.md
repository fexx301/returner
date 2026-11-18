# Recorded run with Codex (Nov 18)

`examples/pkimm/run.sh codex`. One uninterrupted run, 20 min 6 s, shown in the walkthrough video at 50× speed.

- Before: the v1 baseline passed, the new user passed, and the returning user failed ("The assessment page stayed blank…").
- Codex attempt 1 wrote `src/utils/restoreProgress.ts`, which maps the 9 renumbered 1.1.0 categories back to their 1.0.0 keys and stores `modelVersion` (`repair.diff`).
- After: the replay from the same untouched v1 profile passed the read-only check. It confirmed both names, Strategy and Vision 3, Infrastructure management 4, Sourcing 2 and the Cryptography category.
- `terminal-lines.json` holds the replayed lines as [seconds since start, text, kind]. They come from Returner's output and Codex's exec and patch events. Home-directory paths are shortened to `~`.
