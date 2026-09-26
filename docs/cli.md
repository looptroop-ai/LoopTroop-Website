# CLI Reference

`looptroop` runs LoopTroop as a background service. Installing it puts one
command on your `PATH`; everything else happens through that.

The commands people use to identify, inspect, or launch LoopTroop —
`--version`, `status`, `doctor`, `start`, and `open` — check the cached latest
published GitHub release. Human-readable output adds channel-aware update steps
only when a newer version exists. The check never installs anything.

## Commands and options

The block below is generated from the CLI's own usage text, so it cannot drift
from what the command prints.

Every command also documents itself. `looptroop <command> --help`,
`looptroop <command> help`, and `looptroop <command> "?"` print that command's
own options, what it does with them, and which commands to reach for instead —
more than fits in the summary below:

```bash
looptroop open --help
looptroop doctor "?"
```

<!-- generated from server/cli/cli.ts; run npm run sync:cli -->

```text
LoopTroop — local AI coding orchestration

Usage: looptroop <command> [options]

Commands:
  open           Open the interface, starting LoopTroop if it is not running
  start          Start the daemon in the background
  stop           Stop the running daemon
  restart        Stop and start again
  status         Show whether the daemon is running
  logs           Show the daemon log
  doctor         Check that this machine can run LoopTroop
  setup          Attach a project from the terminal, then open the interface
  clean          List, and optionally remove, abandoned worktrees

Options:
  --port <n>     Port to listen on (start, restart)
  --foreground   Run in this terminal instead of the background (start)
  --print-url    Print the sign-in link instead of opening a browser (open)
  --opencode-logs=all
                 Include managed OpenCode DEBUG output (open, start)
  --json         Machine-readable output (status, doctor)
  --follow, -f   Keep streaming (logs)
  --lines <n>    Number of log lines to show (logs)
  --apply        Actually remove what clean would delete
  --yes, -y      Accept every default without asking (setup)
  --version      Print the version
  --help         Print this message

Run `looptroop <command> --help`, `looptroop <command> help`, or
`looptroop <command> "?"` (double quotes keep `?` literal in every shell)
for what a single command does and takes.
```

## `start`, `stop`, `restart` — running as a service

```bash
looptroop start
```

`start` detaches from the terminal. The daemon keeps running after the shell
closes, after you log out, and until something stops it — it is not tied to the
window you launched it from. It binds `127.0.0.1:3000` and serves both the
interface and the API from that one address.

`--foreground` runs it in the current terminal instead, which is what you want
when you are watching it fail.

```bash
looptroop status          # is it up?
looptroop status --json   # the same, for a script
looptroop restart         # stop, then start
looptroop stop
```

`status --json` includes an `update` object with current/latest versions,
availability, install channel, ordered upgrade commands, and GitHub release
details. It remains JSON-only even when an update is available.

> [!IMPORTANT]
> **One daemon per configuration directory.** The lock records which process
> holds it rather than only when it last checked in, so a suspended laptop does
> not look like an abandoned lock. Two daemons sharing one database and one set
> of worktrees is the failure this prevents.

To run more than one, give each its own configuration directory and port — see
[Configuration](configuration.md).

## `open` — opening the interface

```bash
looptroop open
```

**starts LoopTroop if it is not already running**, then opens a **signed-in
link**: a URL carrying a single-use code in its fragment. The fragment is never
sent in a request line, so it cannot reach an access log; the browser exchanges
it for a session cookie that scripts cannot read. There is no way to sign in by
query string, and no password to set.

Against a daemon that is already running it opens that one — it will not start a
second. `looptroop start` remains for starting the service without a browser.

Sessions last 12 hours. When one ends the tab says so and names the command that
signs in again, rather than rendering an interface whose every request is
refused. Run `looptroop open` again.

Automation uses a bearer token instead — see [API Reference](api-reference.md).

## `logs` — reading the daemon log

```bash
looptroop logs             # the recent log
looptroop logs -f          # keep streaming
looptroop logs --lines 200
```

The log lives in the [configuration directory](configuration.md) and survives
restarts.

## `doctor` — checking the machine

```bash
looptroop doctor
looptroop doctor --json
```

`doctor` runs fifteen checks: the LoopTroop version; Node; npm; `git`; `gh` and
its authentication; the configuration directory, how this copy was installed and
what upgrades it, the database schema, the last start, the project's git ignores,
the OpenCode CLI and OpenCode itself, the port, and the daemon. See
[Runtime Diagnostics](diagnostics.md) for what each check means, what the `✓`,
`!` and `✗` marks distinguish, and what to do when one fails.

Unlike the other human-readable commands, Doctor always prints both version
values. If GitHub cannot be reached and no cached answer exists, latest is shown
as `unavailable`. `doctor --json` emits `{ ok, update, checks }`; scripts do not
need to parse the human version line.

> [!NOTE]
> **`doctor` exits non-zero when any check fails**, which is what makes it usable
> in a script. On a machine with no OpenCode configured yet, that is expected
> rather than broken.

## `setup` — attaching a project

```bash
looptroop setup
looptroop setup --yes
```

`setup` attaches a project and opens the interface. Interactive setup offers the
three [LoopTroop folder-ignore modes](configuration.md#looptroop-folder-ignore-policy)
and preselects the Configuration default. `--yes` accepts that configured choice
without asking; if no saved profile choice exists, both paths fall back to **This
clone only** (`local`).

A project needs to be a git repository with a GitHub `origin`. LoopTroop works in
git worktrees under `<project>/.looptroop/worktrees/`, never in your checkout.

## `clean` — cleaning up worktrees

```bash
looptroop clean           # list what could be removed
looptroop clean --apply   # actually remove it
```

`clean` lists abandoned worktrees — left behind by cancelled or interrupted
tickets — and removes them only when asked. It is worktree housekeeping, not
application-data cleanup: it never touches your configuration, database, logs or
tickets.

> [!NOTE]
> **Current behavior.** The cleanup recheck, safety boundaries, and process
> and log-follow fixes below are part of the current implementation.

With `--apply`, it repeats the containment, ownership, activity, registration,
and Git checks immediately before removing each candidate. If a worktree changed
after the plan was made, it stays in place. A failed or empty Git registration
listing also keeps the directories in place, whether it happens during planning
or the final check. Project paths containing newlines remain distinct records.
Ignored files outside LoopTroop's `.ticket` and `.looptroop` runtime roots also
block cleanup, including `.env`, dependency folders and build output. Remove or
move those files yourself before retrying; cleanup does not decide which ignored
files are disposable. It checks again before removal, and a failed inspection
keeps the worktree.

## CLI safety boundaries

Each configuration directory has one `daemon.lock`, held by the running daemon.
Stale-state cleanup re-reads the recorded instance while holding that same lock,
so a stopped daemon cannot remove a successor's `daemon.json`. Concurrent
`start` calls report only the child that owns the ready state; a losing call does
not claim the winner's daemon.

Process termination requires the captured start identity for the target. Missing,
changed, or otherwise unverifiable identity refuses the signal. On Windows,
`taskkill /T /F` is forceful rather than graceful. On platforms without retained
descendant enumeration, an unknown descendant is not guaranteed to be gone.

Daemon URLs use bracketed IPv6 literals wherever a host and port are combined.
`logs --follow` registers its watcher before draining the tail handoff, keeping
the byte offset, partial line, and UTF-8 decoder state continuous across reads;
rotation or shrink resets the offset and decoder before reading the new file.
The directory watcher detects rename-and-create rotation, including a larger
replacement file, and changes generations after an active read finishes.
Daemon health checks require the recorded instance ID. A failed start can stop
its own live child through the retained process handle when the platform's
start-time probe is unavailable; a stored PID alone never grants that authority.
If the daemon crashes while its managed OpenCode child is still running, the
next start checks the retained owned-server record before probing or adopting
OpenCode. A verified live child must be cleaned up with `looptroop stop` before
retrying `looptroop start`; an unverifiable live identity keeps the evidence in
place. If the recorded OpenCode child is confirmed dead or its PID now belongs
to another process, startup can proceed. A stored PID alone never authorizes a
signal.
Windows command logs redact profile path prefixes and retain only the final
visible path segments.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command did what it said. |
| `1` | It did not: a failed `doctor` check, a daemon that would not start, an unknown flag, an invalid `--port`. |

Every command prints its own reason to stderr; nothing fails silently.

## Which copy is running

If two installations end up on the same machine — the usual cause is running one
package manager's upgrade command against another's installation — `PATH` order
decides which one answers.

```bash
looptroop doctor    # names the channel, and its upgrade command
which looptroop     # where the one your shell runs comes from
```

[Installation](installation.md#upgrading) covers why that happens and how to
avoid it.
