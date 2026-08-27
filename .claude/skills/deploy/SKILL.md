---
name: deploy
description: Deploy the light panel to the Raspberry Pi (blinky) — pulls, builds the UI on the Pi, restarts the service, verifies, then offers to clean up stale branches. Use when the user asks to "deploy", "resync and deploy", "push to the pi/panel", or similar.
---

Deploy the light panel to the Pi (`blinky`). Run the steps below directly instead of re-deriving the process — this sequence has been rehearsed and verified end-to-end.

The UI and server deploy the same way now: the Pi does `git pull` against `origin/master` and builds the UI itself (blinky moved off Node 14/Buster to Node 24/Trixie in 2026-08 — see `CLAUDE.md`). There's no Mac-side build or rsync step anymore, so nothing here can drift from what's on GitHub.

## 0. Bail out if not running from the CLI

Check `echo $CLAUDE_CODE_ENTRYPOINT`. If it is `claude-desktop` (or `$OPERON_SANDBOXED_NETWORK` is set), **stop immediately** and tell the user:

> Deploy needs LAN access to `blinky.local`, which is blocked from the Desktop app's sandboxed network (known Claude Code issue — Bash gets `EHOSTUNREACH` even though the Pi is reachable from a normal terminal). Please run this from the Claude Code CLI in a terminal instead.

Do not attempt any of the steps below if this check fails — they will silently fail or hang against an unreachable host.

If `CLAUDE_CODE_ENTRYPOINT=cli`, proceed.

## 1. Check local branch status

The Pi builds only from `origin/master`, so anything not pushed and merged there simply won't deploy. Check before running:

```
git status --short
git branch --show-current
```

- **Uncommitted changes**: STOP and tell the user — deploying now won't include them; they'd need to commit and push (and merge, per this repo's PR workflow) first.
- **On `master`**: make sure it's up to date before deploying:
  ```
  git fetch origin && git pull
  ```
- **On a feature branch**: check whether it's fully merged —

  ```
  git fetch origin
  git merge-base --is-ancestor HEAD origin/master && echo merged || echo unmerged
  ```

  - **Merged** (exit 0 / `merged`): no unique work sits on the branch — deploying `origin/master` is equivalent, proceed.
  - **Unmerged** (`unmerged`): the branch has commits not yet in `origin/master`. STOP and ask the user before proceeding — deploying right now would build whatever's currently on `origin/master`, not this branch.

## 2. Deploy

```
npm run deploy
```

Run from the repo root. This runs `scripts/deploy-pi.sh`, which SSHes to the Pi (passwordless via the `blinky` SSH host alias) and does the whole thing: `git pull`, `npm install`, `npm run build --workspace=packages/ui`, then `sudo systemctl restart lightpanel`. The restart briefly interrupts whatever's live on the physical panel — it runs anyway without pausing to confirm; the user has explicitly said not to ask about that step.

## 3. Verify

Don't just trust that the commands above exited cleanly — check the running state:

```
curl -s http://blinky.local:3000/api/virtual        # expect {"virtual":false} on real hardware
curl -s http://blinky.local:3000/api/active_scene
curl -s -o /dev/null -w "%{http_code}\n" http://blinky.local:3000/   # expect 200
```

Report the results (hardware mode, active scene, UI status code) to the user.

## 4. Check for stale branches and offer cleanup

After the deploy is verified, check for branches that are safe to delete:

```
git fetch --prune origin
git branch --merged master | grep -vE '^\*|^\s*master$'          # stale local branches
git branch -r --merged origin/master | grep -vE 'origin/master|origin/HEAD'  # stale remote branches
```

- These are branches already merged into `master`/`origin/master`, so deleting them loses no work — but deletion is still irreversible for anyone with a local checkout of a remote branch you remove.
- List whatever turns up (if anything) and **ask the user before deleting** — never delete branches unprompted. Local: `git branch -d <name>`. Remote: `git push origin --delete <name>`.
- If nothing is stale, say so briefly and skip the offer — don't ask a hypothetical question when the lists are empty.
