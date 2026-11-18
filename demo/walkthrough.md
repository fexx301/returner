# Returner judge walkthrough

## Same release, two results

These are two browser runs against the same release of Fieldnotes. On the left, a new user wrote a draft, saved it, and opened it again. On the right, a returning user arrived with a draft from yesterday. Both fields are empty. This is a deliberately broken example. The question Returner asks is simple. Will yesterday's work survive today's release?

## Run the rehearsal

From the Returner repository, run npm run demo repair, with a colon between demo and repair. The command starts a local file server and gives Kane two versions of the app. Kane uses real Chrome. Each run gets an isolated test profile. You can see the browser checkpoints in this recording, taken from the actual Kane evidence packs.

## Save work before upgrading

First, Kane opens version one. It types a fresh title and body, saves them, reloads the page, and checks both values. The randomly chosen title ends in F nine three nine. Watch that same title come back later. Returner keeps a copy of this closed browser profile so the repair can be tested from exactly where this user started.

## Switch to version two

Now Returner serves version two at the same local address. Changing the port would change the browser's storage origin and spoil the test. A fresh profile can still create and reopen a draft. Then Kane opens a copy of the old profile. Its instruction is to find the existing draft, and to stop immediately if it is missing. Typing the missing text back in would hide the regression.

## Hand the failure to Codex

Here is what Kane observed. The title and body fields were empty. That observation, the unchanged objective, and the earlier release's storage code go directly to Codex. Codex works on a disposable copy of the candidate app. In this run it found that version two looked only under its new storage key. It changed the lookup so an existing version two draft takes priority, and an older draft can still be opened.

## Reopen the edited draft

The agent has finished its patch. Returner now makes the release decision. It starts again from the untouched version one profile. Kane finds the original title and body, appends the word edited, saves, and reloads. Then Returner closes Chrome and opens another process. This last check only reads. On screen is the same draft, with its edited body still present. All three checks passed.

## Try an independent application

Fieldnotes shows the repair on a defect we introduced. For a separate confirmation, we built two published releases of DeckMark, an open source Markdown editor. Kane created a note on version two point five point three. On version two point five point four, it opened that note, edited it, and confirmed the original content and the edit after reload. This result applies to those two releases and this particular editing task.

## Run it yourself

The public repository includes the command, the example, the agent patch workflow, and the recorded results. You can open the reports locally even without running Kane. To rehearse your own static app, point Returner at two build directories and describe the promise your returning user depends on. The two users can see the same release and have very different experiences. Now you can test both.
