# Runners for Herdr

See what waits for your self-hosted runners and build machines, what runs on them now, and how hard
each machine works, in the [Herdr](https://herdr.dev) desktop app. Made for a couple of Mac minis
that run CI and test jobs for several coding agents at once, but it works for any self-hosted
GitHub Actions runners and any machine you can reach over ssh.

![Runners panel](preview.png)

- **Status-bar chip:** a square per runner slot, grouped per machine (accent = running, grey = free,
  red = offline), and what the slots do in words with their nouns: "2 jobs waiting", "3 jobs
  running", "1 runner offline", so a count never reads as agents waiting on you. Click it to open or
  close the Runners panel; right-click it for a quick-look popup. On a narrow status bar it drops the
  title, then the squares, so the words always show.
- **Panel** beside Files and Changes: a line that names what needs a look (a slot offline, a
  machine ssh can't read), only when something does; totals (waiting, failed in the last hour, busy
  slots, today's wait); the waiting jobs (oldest first, only when some wait); the running jobs, each
  with how long it has run against its usual length and a bar for its progress (amber past 1.2x, once three
  finished runs of that job say what is usual);
  each machine with its load and a bar per slot naming its job; and the finished jobs. Passed jobs
  of one run share a row (`CI · 3 jobs`); failures stay listed for the hour, one row each; passed
  jobs drop off after 10 minutes (`Show N older` brings them back). A machine's dot is green only
  when a slot or ssh answered; a grey ring means no status yet. The header turns amber when a read
  fails or no read came for 3 minutes, and says how old the data is.
- **Timeline**, a window you open from the panel or the popup: a lane per slot over the last 30
  minutes and the next 10. Waiting jobs sit where the first free slot of their pool should take them,
  from how long each job usually takes.
- **Toasts** when a job waits longer than `waitAlertMinutes`, and when a slot stays offline for a
  minute: one toast per machine, not per slot, and a short one when they are all back. A slot that
  drops and comes back within the minute says nothing. Click an offline toast to open the panel
  (the `runners.panel` command).
- Click a GitHub job to open it on GitHub; click a lanes job to open its log folder.
- **Keyboard:** `pane.go` moves onto the panel like onto a pane. `↑` `↓` walk everything you can
  click (the buttons, waiting jobs, running jobs, finished jobs, `Show N older`) with a 2px ring,
  `Enter` or `Space` opens it, `R` refreshes, `T` opens the timeline, and `Esc` goes back toward the
  terminals. On the status-bar chip, `Enter` shows the panel and `Space` the quick look.

![Timeline](preview-timeline.png)

![Status bar](preview-bar.png)

## Sources

- **GitHub Actions self-hosted runners**, through `gh api`: the recent runs of each repo you list
  and the jobs of every run that is active or finished in the last two hours. A job is watched when
  it asks for `self-hosted` or one of your `labels`, or runs on a runner you list. Online and busy
  come from `actions/runners`; that endpoint needs repo admin, so without it a slot shows an empty
  dashed bar, and its machine says `needs repo admin`, until a job runs on it.
- **Machine load** over ssh: `sysctl -n vm.loadavg hw.ncpu` (macOS), the 1-minute load per core.
- **A lock-based job runner of your own (optional):** a script that runs jobs on your machines
  with a lock per lane, read through its `status` command and a history file. See
  [Lanes](#lanes).

All views share one snapshot. The first view that finds it due reads it: every 20 s while a job
waits or runs, every 60 s when idle, load every 60 s.

## Requirements

- The Herdr desktop app (`herdr-app`).
- [`gh`](https://cli.github.com), logged in (`gh auth login`), for GitHub runners.
- ssh keys that log in without a prompt (`BatchMode`), for machine load.

## Install

Ask the agent running in Herdr: "add the Herdr mod at github.com/Lakris2407/herdr-mods/tree/main/runners". Or by hand,
after the [one-time setup](../README.md#one-time-setup):

1. Copy `mods/runners` to `~/.config/herdr-app/mods/runners` and run
   `herdr-app check ~/.config/herdr-app/mods/runners`.
2. In `~/.config/herdr-app/layouts/main-plus.json`, add the panel to the side-panel stack
   (`panel-body`) and the chip to the status row:

   ```json
   { "id": "runners", "type": "block", "content": { "mod": "runners" } }
   ```

   ```json
   { "id": "status-runners", "type": "block", "content": { "mod": "runners", "props": { "view": "chip" } },
     "size": { "weight": 2.8 }, "min": 120 }
   ```

3. Give the panel a tab-bar button, as in the [one-time setup](../README.md#one-time-setup):
   `panelButton("runners", "Runners", "mods/runners/runners.svg")`.
4. Create `~/.config/herdr-app/runners.json` (below). To try the mod first, write
   `{ "demo": true }`: the panel then shows made-up machines and jobs.

## Configure: `~/.config/herdr-app/runners.json`

Nothing is built in; the mod reads only what this file lists.

```json
{
  "repos": [
    { "repo": "acme/web", "short": "WEB", "color": "ansi6" },
    { "repo": "acme/game", "short": "GAME", "color": "ansi5" }
  ],
  "machines": [
    { "name": "Build mini 1", "ssh": "me@build-mini-1.local", "lanes": "mini1", "runners": ["web-mini-1"] },
    { "name": "Build mini 2", "ssh": "me@build-mini-2.local", "lanes": "mini2", "runners": ["web-mini-2"] }
  ],
  "labels": ["web-ci"],
  "waitAlertMinutes": 5
}
```

| Key | What it does |
|---|---|
| `repos` | GitHub repos whose Actions jobs to watch. `short` is the tag on each job; `color` a theme color name (`ansi0`..`ansi15`, `accent`, ...). |
| `machines` | One card each. `ssh` (optional) reads the load. `runners` are GitHub runner names on that machine. `lanes` is the machine's name in the lanes `status` output. Runners no machine lists go under "Other runners". |
| `labels` | Extra job labels that mean "runs on my runners", for jobs that do not ask for `self-hosted`. |
| `lanes` | Optional lock-based runner, below. |
| `waitAlertMinutes` | Toast when a job waits this long (default 5). |
| `demo` | `true` shows made-up data and runs nothing. |

Keys: bind `runners.refresh` and `runners.timeline` in `keys.json`.

## Lanes

If you run jobs on your machines with a script of your own (for example one lock per machine for
Unity jobs and one for headless tests), Runners can show its lanes beside the GitHub runners:

```json
"lanes": {
  "name": "my-game", "short": "GAME", "color": "ansi5",
  "command": ["bash", "scripts/run-on-mini.sh", "status"],
  "cwd": "/path/to/repo",
  "history": "/path/to/repo/.git/runner-history.jsonl",
  "hosts": { "build-mini-1.local": "mini1" }
}
```

The `status` command prints one line per lane, then the waiting callers:

```text
mini1 unity: free
mini1 core: core tests args: -filter Fast branch: feat/x commit: 1a2b3c4 worktree: x 42s logs: /tmp/run-42
mini1 warm: idle 3 min
mini2 unity: unreachable
Waiting callers:
  waiting: unity build args:  branch: feat/y commit: 5d6e7f8 worktree: y 84s logs: /tmp/run-43
```

A lane is `free`, `busy (no details)`, `unreachable`, or runs a job: lane, job, then `args:`,
`branch:`, `commit:`, `worktree:`, the seconds it has run (`42s`) and `logs:`. A `<machine> warm:`
line shows as free text under the machine. `joined:` lines (callers waiting for an identical job)
are read but not counted as waiting. The optional history file has one JSON record per finished job:
`{ token, job, lane, host, branch, worktree, commit, args, outcome: "pass" | "fail" | ..., logs,
times: { request, lock, end } }` with times in epoch seconds; `hosts` maps `host` to a machine's
`lanes` name. History gives the Finished list, the timeline's past, and the usual length of each job.

## Turn parts off

Use [Controls](../controls/) to hide the chip or the panel button.

## What it runs

`gh api` (read-only GET requests), `ssh <host> sysctl -n vm.loadavg hw.ncpu`, your lanes `status`
command, and `open` for the links you click (https only, or a lanes job's local log folder). It
reads `runners.json` and your lanes history file. It makes no other network requests and stores no
tokens; `gh` and ssh keep their own credentials.

## Tests

```sh
npm test   # from the repo root
```

The tests run the data code under Node with an in-memory `herdr` stub: no config, demo data, a full
read with GitHub, ssh and lanes faked, the lanes parsers, and the queue plan.
