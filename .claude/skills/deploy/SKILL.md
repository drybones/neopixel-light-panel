---
name: deploy
description: Resync and deploy the light panel to the Raspberry Pi (blinky) — builds and rsyncs the UI, pulls server changes, restarts the service, verifies, then offers to clean up stale branches. Use when the user asks to "deploy", "resync and deploy", "push to the pi/panel", or similar.
---

Deploy both the UI and server to the Pi (`blinky`). Run the steps below directly instead of re-deriving the process — this sequence has been rehearsed and verified end-to-end.

## 0. Bail out if not running from the CLI

Check `echo $CLAUDE_CODE_ENTRYPOINT`. If it is `claude-desktop` (or `$OPERON_SANDBOXED_NETWORK` is set), **stop immediately** and tell the user:

> Deploy needs LAN access to `blinky.local`, which is blocked from the Desktop app's sandboxed network (known Claude Code issue — Bash gets `EHOSTUNREACH` even though the Pi is reachable from a normal terminal). Please run this from the Claude Code CLI in a terminal instead.

Do not attempt any of the steps below if this check fails — they will silently fail or hang against an unreachable host.

If `CLAUDE_CODE_ENTRYPOINT=cli`, proceed.

## 1. Check local branch status

`npm run deploy` builds the UI from whatever's on disk locally, but the server is updated separately via `git pull` on the Pi against `origin/master` — the two are not guaranteed to match. Check before building:

```
git status --short
git branch --show-current
```

- **Uncommitted changes**: STOP and ask the user before proceeding. The build would bake them in, but they aren't on GitHub and can't be reproduced later.
- **On `master`**: proceed straight to the build.
- **On a feature branch**: check whether it's fully merged —

  ```
  git fetch origin
  git merge-base --is-ancestor HEAD origin/master && echo merged || echo unmerged
  ```

  - **Merged** (exit 0 / `merged`): no unique work sits on the branch, so switch and build without waiting for confirmation:
    ```
    git checkout master && git pull
    ```
  - **Unmerged** (`unmerged`): the branch has commits not yet in `master`. STOP and ask the user before proceeding — deploying would build UI from code the server's `git pull` won't have, and switching to `master` on your say-so would leave unmerged work behind silently.

## 2. Build UI and rsync to the Pi

```
npm run deploy
```

Run from the repo root. This builds `packages/ui` and rsyncs `dist/` to the Pi. **This is the only thing the deploy script covers** — it does not touch the server.

## 3. Pull server-side changes on the Pi

```
ssh blinky "cd /home/pi/github/neopixel-light-panel && git pull"
```

Passwordless via the `blinky` SSH host alias.

## 4. Restart the server

```
ssh blinky "sudo systemctl restart lightpanel"
```

This briefly interrupts whatever's live on the physical panel — restart anyway without pausing to confirm; the user has explicitly said not to ask about this step.

## 5. Verify

Don't just trust that the commands above exited cleanly — check the running state:

```
curl -s http://blinky.local:3000/api/virtual        # expect {"virtual":false} on real hardware
curl -s http://blinky.local:3000/api/active_scene
curl -s -o /dev/null -w "%{http_code}\n" http://blinky.local:3000/   # expect 200
```

Report the results (hardware mode, active scene, UI status code) to the user.

## 6. Check for stale branches and offer cleanup

After the deploy is verified, check for branches that are safe to delete:

```
git fetch --prune origin
git branch --merged master | grep -vE '^\*|^\s*master$'          # stale local branches
git branch -r --merged origin/master | grep -vE 'origin/master|origin/HEAD'  # stale remote branches
```

- These are branches already merged into `master`/`origin/master`, so deleting them loses no work — but deletion is still irreversible for anyone with a local checkout of a remote branch you remove.
- List whatever turns up (if anything) and **ask the user before deleting** — never delete branches unprompted. Local: `git branch -d <name>`. Remote: `git push origin --delete <name>`.
- If nothing is stale, say so briefly and skip the offer — don't ask a hypothetical question when the lists are empty.
