<purpose>
Update fvgsd from the local clone it was installed from. fvgsd is not published to npm, and this workflow must never run `npx` or `npm install -g`.
</purpose>

<process>

<step name="find_install">
Check `./.claude/fvgsd/.fvgsd-source` (local install) first, then `~/.claude/fvgsd/.fvgsd-source`, then the same path under the other runtime folders (`~/.codex`, `~/.gemini`, `~/.config/opencode`, …).
Read the first file that exists as JSON: `{ repo, remote, commit, runtimes, scope }`.
If none exists, or `repo` is not a directory, show the manual steps in `manual_steps` and stop.
Capture `repo` as `REPO` and `commit` as `RECORDED_COMMIT`. Each step below is a separate Bash call with its own fresh shell, so carry both values (and `NEW`, captured next) forward by substituting them into the commands in later steps rather than relying on shell state to persist.
</step>

<step name="pull">
```bash
git -C "$REPO" pull --ff-only
NEW=$(git -C "$REPO" rev-parse HEAD)
```
If `pull --ff-only` fails, show its output, tell the user the clone has local changes or diverged, and stop.
Capture `NEW`. If it equals `RECORDED_COMMIT`, report "fvgsd is up to date" and stop — compare against the commit `.fvgsd-source` recorded for *this* install, not the clone's pre-pull HEAD, so a different runtime, a different scope, or a manual update that skipped this install is still caught even when the clone itself did not move.
</step>

<step name="reinstall">
```bash
(cd "$REPO" && npm install && npm run build:hooks)
node "$REPO/bin/install.js" --<runtime> --<scope>
```
Run the install line once per runtime in `runtimes`, with `--global` or `--local` from `scope`.
</step>

<step name="report">
```bash
git -C "$REPO" log --oneline "$RECORDED_COMMIT..$NEW"
```
Show the commits and remind the user to restart their runtime session.
</step>

<step name="manual_steps">
```text
cd <your fvgsd clone>
git pull --ff-only
npm install
npm run build:hooks
node bin/install.js --claude --global   # repeat for each runtime you use
```
</step>

</process>
