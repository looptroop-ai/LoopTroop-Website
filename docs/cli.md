# CLI Reference

`looptroop` runs LoopTroop as a background service. Installing it puts one
command on your `PATH`; everything else happens through that.

## Commands and options

The block below is generated from the CLI's own usage text, so it cannot drift
from what the command prints.

<!-- generated from server/cli/cli.ts; run npm run sync:cli -->

```text
LoopTroop — local AI coding orchestration

Usage: looptroop <command> [options]

Commands:
  setup          Attach a project and open the interface
  start          Start the daemon in the background
  stop           Stop the running daemon
  restart        Stop and start again
  status         Show whether the daemon is running
  open           Open the interface in your browser
  logs           Show the daemon log
  doctor         Check that this machine can run LoopTroop
  clean          List, and optionally remove, abandoned worktrees

Options:
  --port <n>     Port to listen on (start, restart)
  --foreground   Run in this terminal instead of the background (start)
  --json         Machine-readable output (status, doctor)
  --follow, -f   Keep streaming (logs)
  --lines <n>    Number of log lines to show (logs)
  --apply        Actually remove what clean would delete
  --yes, -y      Accept every default without asking (setup)
  --version      Print the version
  --help         Print this message
```

## Running as a service

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

> [!IMPORTANT]
> **One daemon per configuration directory.** The lock records which process
> holds it rather than only when it last checked in, so a suspended laptop does
> not look like an abandoned lock. Two daemons sharing one database and one set
> of worktrees is the failure this prevents.

To run more than one, give each its own configuration directory and port — see
[Configuration](configuration.md).

## Opening the interface

```bash
looptroop open
```

prints and opens a **signed-in link**: a URL carrying a single-use code in its
fragment. The fragment is never sent in a request line, so it cannot reach an
access log; the browser exchanges it for a session cookie that scripts cannot
read. There is no way to sign in by query string, and no password to set.

Sessions last 12 hours. When one ends the tab says so and names the command that
signs in again, rather than rendering an interface whose every request is
refused. Run `looptroop open` again.

Automation uses a bearer token instead — see [API Reference](api-reference.md).

## Logs

```bash
looptroop logs             # the recent log
looptroop logs -f          # keep streaming
looptroop logs --lines 200
```

The log lives in the [configuration directory](configuration.md) and survives
restarts.

## Checking the machine

```bash
looptroop doctor
looptroop doctor --json
```

`doctor` checks Node, git, OpenCode, the port, the daemon, and how this copy was
installed. See [Runtime Diagnostics](diagnostics.md) for what each check means
and what to do when one fails.

> [!NOTE]
> **`doctor` exits non-zero when any check fails**, which is what makes it usable
> in a script. On a machine with no OpenCode configured yet, that is expected
> rather than broken.

## Attaching a project

```bash
looptroop setup
looptroop setup --yes
```

`setup` attaches a project and opens the interface. `--yes` accepts every default
without asking, for an unattended install.

A project needs to be a git repository with a GitHub `origin`. LoopTroop works in
git worktrees under `<project>/.looptroop/worktrees/`, never in your checkout.

## Cleaning up worktrees

```bash
looptroop clean           # list what could be removed
looptroop clean --apply   # actually remove it
```

`clean` lists abandoned worktrees — left behind by cancelled or interrupted
tickets — and removes them only when asked. It is worktree housekeeping, not
application-data cleanup: it never touches your configuration, database, logs or
tickets.

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
