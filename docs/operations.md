# Operations Guide

> [!IMPORTANT]
> **This page has two halves, and most people only need the first.**
> [Part 1](#part-1-operating-an-installed-looptroop) is operating an **installed**
> LoopTroop: the service, its state, backups, worktree cleanup.
> [Part 2](#part-2-the-development-stack) is the **development stack** — running
> from a checkout with `npm run dev` to work on LoopTroop itself. The preflight,
> maintenance, dependency and script material in Part 2 does not apply to an
> installed copy, and several of its commands are not even present in one.

---

# Part 1: Operating An Installed LoopTroop

An installed LoopTroop runs as a background service:

```bash
looptroop open       # starts it if it is not running, then opens a browser
looptroop status     # --json for a script
looptroop logs -f
looptroop restart
looptroop stop
```

Every command and option is in the [CLI Reference](cli.md); installing, upgrading
and uninstalling are in [Installation](installation.md).

## Where an installed LoopTroop keeps its state

Everything lives in one [configuration directory](configuration.md#where-looptroop-keeps-its-state),
outside the installation — so upgrading, or switching channels entirely, never
loses it. The directory is `0700` and the files in it `0600`.

| File | What it is |
| --- | --- |
| `config.json` | Settings you have changed from the defaults |
| `app.sqlite` | App settings, profiles, and the attached-project registry |
| `daemon.json` | The running daemon's record: pid, port, instance id, and the API token it minted at startup. Also records *why* the last start was refused |
| `daemon.lock` | Held by the running daemon, so a second one cannot start against the same directory |
| `logs/daemon.log` | What `looptroop logs` reads. Rotated when oversized, at startup or while the daemon runs |
| `logs/daemon.log.rotation` (current behavior) | Private pending/completed rotation marker used by log followers |

**Backing up** is copying that directory with the daemon stopped. Your projects
are not in it: LoopTroop works in git worktrees under `<project>/.looptroop/`,
described in [Part 2's storage table](#_2-runtime-storage), which applies to both
stacks.

## Routine tasks

| Task | Command |
| --- | --- |
| Check the machine can run it | `looptroop doctor` — see [Runtime Diagnostics](diagnostics.md) |
| Find out whether an update exists and how to apply it | `looptroop doctor` shows current/latest versions, names the channel, and prints its ordered upgrade and restart steps |
| Remove worktrees left by cancelled tickets | `looptroop clean`, then `looptroop clean --apply` |

`looptroop clean` is worktree housekeeping: it removes git worktrees left behind
by cancelled or interrupted tickets, inside your project, and never touches
configuration, tickets or the database. It refuses to run while the daemon is up,
because those worktrees may be in use.

> [!NOTE]
> **Current behavior.** The cleanup and process-control guarantees below
> describe the current implementation. These guarantees are live.
> The child-process credential filtering and request-boundary changes described
> below are also current.

With `--apply`, it repeats containment, ownership, activity, registration, and
Git checks immediately before each removal and keeps a candidate that changed
after the plan. A failed Git registration listing or ignored files outside
LoopTroop's `.ticket` and `.looptroop` roots keep the worktree in place. This
includes `.env`, dependency directories, and build output; move or remove them
yourself before retrying.

One daemon runs per configuration directory, held by a lock that records which
process took it rather than only when it last checked in. To run two, give each
its own `LOOPTROOP_CONFIG_DIR` and port. Stale-state cleanup re-reads the
instance under that same lock, and a concurrent start cannot claim another
invocation's ready daemon.

Now, log following recognizes a completed live rotation even
when the same file has already grown beyond the previous read offset. It waits
while copying and truncation are in progress, then reads the new generation
from its beginning. A read window interrupted by rotation is not treated as
verified output; earlier lines remain in the rotated log files. Copying and
truncating still has its existing writer race: bytes written between the copy
and truncation can be lost.

Now, a start command can also recognize its own still-live
child through the process handle it holds when Windows' start-time lookup is
temporarily unavailable. This readiness fallback does not apply to exited
children or tokenless records found by a later command, and does not authorize
signalling a process by PID alone.

Signals require a captured process start identity. LoopTroop refuses to signal a
missing, recycled, or unverifiable process. Windows termination uses forceful
`taskkill /T /F`; platforms without retained descendant enumeration do not
promise that unknown descendants have exited.

Now, a daemon that cannot confirm its owned OpenCode process
stopped stays alive, keeps its ownership records, and accepts another stop
request. The stop command reports incomplete cleanup instead of forcing an
exit after an accepted shutdown request. A new daemon cannot take its place
while that ownership remains unresolved.
If HTTP has already closed, the daemon retries runtime cleanup internally;
a later CLI stop does not force-kill that pending generation. Stale-state
cleanup also leaves its pending ownership record intact.
Shutdown closes live browser event streams before waiting for HTTP requests
to finish, so an open LoopTroop tab does not hold the daemon open.

If startup itself fails after launching OpenCode, a retained cleanup record
also blocks a later start. Cleanup must confirm that the owned process tree is
gone before removing that record; an unknown process identity is not permission
to signal a PID or discard ownership.

## OpenCode is managed for you

An installed daemon does not need you to run `opencode serve`. At startup it
either **adopts** an OpenCode already listening at the configured base URL, or
**starts and supervises one itself**, restarting it if it crashes and stopping it
when the daemon stops. With no OpenCode to reach and no CLI to launch, the daemon
refuses to start rather than serving an interface that cannot run a single coding
operation — `LOOPTROOP_OPENCODE_MODE=mock` looks around without one.

`looptroop doctor` reports which of those happened.

> [!NOTE]
> **Current behavior.** The following notes describe confirmed
> remote-stop cancellation, retryable ownership, the two-storage restart
> limit, guarded approval-save/flush behavior, and actual-value form snapshots.

Cancellation and cleanup use confirmed remote-stop results. A local abort call
that returns false, throws, or cannot be verified does not prove that OpenCode
stopped. LoopTroop keeps the session ownership visible and the ticket
retryable. Startup can replay the ticket marker when the project database has no
row, but it cannot claim restart recovery when both the database and marker
storage are unavailable.

A pending cancellation also writes `.ticket/runtime/cancellation-pending.json`.
After a restart, that marker blocks automatic phase startup until cleanup
confirms the stop. An unreadable or malformed marker keeps the block in place.
If writing the marker fails, the current process still blocks startup, but the
marker cannot provide that protection after a restart. Council cleanup waits
only a bounded time for a session still being created; a late session is stopped
when its identity becomes available, and an unconfirmed stop retains ownership.
Startup recovery recognizes interrupted atomic writes of both the cancellation
marker and `opencode-pending-sessions.json`, which stores session ownership.
Pending cancellation blocks every workflow phase. Cleanup retries use bounded
backoff, including when a failed Cancel left the ticket in its previous phase.
The ticket becomes Canceled only after cleanup confirms the stop. Coding Retry
clears a pending cancellation only after the previous session stop and bead
recovery succeed. A partial failure while
polling OpenCode questions preserves the existing local question windows.
If Retry supersedes an older cancellation attempt, that cleanup leaves the new
run and its question windows alone.

Approval editing has the same conservative handoff. Interview and PRD panes
keep the loaded content hash with a dirty draft; missing baselines fail with
HTTP `428`, stale baselines with typed HTTP `409`, and failed saves stay
retryable. Leaving a ticket can flush UI state with keepalive or beacon, but
browser unload delivery is best-effort and an optimistic retained draft is not
proof of a durable save.

Configuration, project, ticket, and prompt dialogs use the same actual-value
rule for their close warning, including custom model/profile controls. A
successful write advances the submitted snapshot; failed writes, background
refetches, and edits made while a request is completing leave the newer draft
visible. Model loading/errors are announced, a failed folder Git check can be
retried without being mistaken for a non-Git directory, and prompt preview
responses are ignored when they belong to an older prompt or draft. Unsaved
modal state is not promised across a reload.

## Child-process credentials

Project commands, Git and hook commands, doctor tool probes, and managed or development OpenCode
launches receive a copied environment after their explicit overrides are
merged. LoopTroop removes only `LOOPTROOP_API_TOKEN` and
`LOOPTROOP_DEV_EVENT_TOKEN` from those child environments. On Windows the two
names are matched case-insensitively; other names are not removed by a
secret-shaped wildcard.

Provider credentials and intentional Git controls such as `GH_TOKEN`,
`GITHUB_TOKEN`, `GIT_SSH_COMMAND`, `GIT_SSH`, `GIT_TERMINAL_PROMPT`, and
`GIT_ASKPASS` remain available to the tools that need them. The trusted CLI
daemon startup handoff retains its configured daemon environment. Filtering
credential propagation is not a process sandbox; commands still run with the
same user's filesystem access.

LoopTroop also preserves a repository's `core.sshCommand`. This supports custom
SSH setups, but Git can execute the configured wrapper with your account's
permissions during remote operations and connection checks. Only select
repositories whose code and Git configuration you trust; worktrees do not
sandbox these commands.

Now, asynchronous Git operations read that setting without
blocking the server's event loop. The value is checked for each operation, so
editing the repository's SSH configuration does not require a daemon restart.

The request boundary keeps local-mode Host validation loopback-only. Now, remote
browser access requires one explicit HTTPS
`LOOPTROOP_PUBLIC_ORIGIN` alongside remote API opt-in. The proxy may forward over
HTTP but must preserve the public Host for cookie-bearing requests without an
Origin, including SSE. Forwarded host and scheme headers do not grant trust.
Plain-HTTP remote access remains bearer-token only; a bearer header cannot
bypass checks on an accompanying cookie. Origin parsing uses strict hostname
spelling and rejects explicit port `0`. The setting does not change the bind
address or provide TLS itself.

---

# Part 2: The development stack

Everything from here on is about running LoopTroop from a checkout, to work on
LoopTroop itself. See
[Working on LoopTroop itself](installation.md#working-on-looptroop-itself) to set
it up.

## 1. Quick Reference

| Task | Start here |
| --- | --- |
| Start the full local stack | `npm run dev` |
| Start once with dependency/audit maintenance | `LOOPTROOP_DEV_MAINTENANCE=1 npm run dev` |
| Skip only the local OpenCode CLI upgrade | `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev` |
| Inherit your external OpenCode permission mode | `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit npm run dev` |
| Share the dashboard on a trusted local network | `npm run dev --lan` |
| Print full managed OpenCode DEBUG logs in the terminal | `npm run dev --opencode-logs=all` |
| Force all startup maintenance now | `LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev` |
| Diagnose slow UI or ticket refresh stalls | `npm run diagnose:stall` |
| Clean tracked LoopTroop runtime paths from a project | `git rm --cached -r .looptroop` inside the attached project |

## 2. Runtime Storage

> [!NOTE]
> **Current behavior.** The ownership marker and unresolved fallback-sidecar
> behavior in the runtime-storage table describe the current implementation. The
> cancellation-pending marker, OpenCode step-cap restore sidecar, and protected Git-hook recovery marker below
> are part of the same current behavior.

LoopTroop deliberately separates app-level state from project-level runtime state.

| Location | Contents | Notes |
| --- | --- | --- |
| `~/.config/looptroop/app.sqlite` | App settings, profiles, and attached-project registry | Override with `LOOPTROOP_CONFIG_DIR` or `LOOPTROOP_APP_DB_PATH` |
| `<app-config>/hook-validation/<worktree-hash>.json` | Interrupted Git-hook validation snapshot | Stored outside the project so a hook cannot remove it by cleaning project files; bound to the canonical worktree and Git directory |
| `<app-config>/opencode-steps/<ticket-directory-hash>.json` | OpenCode step-cap recovery record | Owner-only original config bytes and applied-content hash, stored outside the worktree |
| `<project>/.looptroop/db.sqlite` | Project tickets, phase artifacts, attempts, sessions, status history, and error occurrences | Project-local operational database |
| `<project>/.looptroop/worktrees/<ticket>/` | Ticket-owned Git worktree and `.ticket/**` runtime artifacts | One worktree per ticket |
| `<ticket-worktree>/.ticket/runtime/` | Execution logs, stream state, session records, pending OpenCode ownership marker, temporary files, and state projection | Logs and selected runtime data are preserved or cleaned according to ticket outcome and cleanup scope; startup may leave an unresolved in-progress fallback sidecar at a blocking point, while explicit worktree deletion removes the containing worktree; `opencode-pending-sessions.json` can recover ownership when the project database is unavailable; if both storage layers fail, only the current process guard remains and restart recovery is not promised |
| `<ticket-worktree>/.ticket/manual-qa/vN/evidence/index.json.lock` | Persistent SQLite transaction database for evidence-index locking | The database is not unlinked; SQLite may create adjacent `-journal`, `-wal`, or `-shm` files |
| `<repo>/tmp/dev-preflight-report.json` | Last `npm run dev` preflight result: dependency sync, audit remediation, OpenCode upgrade, and install checks | Rebuilt on successful dev preflight; safe to delete |
| `<repo>/tmp/dev-maintenance-state.json` | Daily maintenance timestamps and invalidation bookkeeping for dependency sync, audit remediation, and OpenCode upgrade | Lets normal startup defer already-run daily maintenance until relevant inputs change |
| `~/.local/share/opencode/log/` | Default local OpenCode log directory | Used for managed OpenCode DEBUG logs and generic provider-error enrichment unless `LOOPTROOP_OPENCODE_LOG_DIR` points elsewhere |

When a coding run applies an OpenCode step cap, its application-owned record
under `<app-config>/opencode-steps/` stores the exact root `opencode.json` bytes
to restore. Removing files inside the worktree cannot erase this recovery
authority. A valid pending marker
keeps that temporary root config out of bead and final candidate commits without
adding an `opencode.json` rule to a common Git exclude. If the current bytes
conflict with the marker, `CODING` preserves the edited config and sidecar and
refuses a destructive reset that would overwrite them. A malformed LoopTroop-owned
sidecar also blocks reset and staging rather than treating the temporary config
as an ordinary project file. A later bead can continue
without a fresh cap when no reset is needed. If the current config is already
the exact original, or is absent when none existed before, recovery settles
the marker without rewriting user data. If the application-owned record is
missing after a restart, ownership cannot be proven and LoopTroop does not
guess from the config's shape or a worktree-local copy. Filesystem-
equivalent casing follows the actual worktree paths; native Windows/macOS
equivalent-case behavior is not claimed here.

Protected explicit Git-hook validation uses a separate marker under
`<app-config>/hook-validation/`, keyed by the canonical worktree path and bound
to the worktree and Git directory. The snapshot includes the complete Git index,
not just its staged file contents. An invalid, escaped or symbolic-link marker fails before
recovery writes. Recovery checks for changed tracked files, staged work, and
unknown untracked additions before restoring anything. Ambiguous work stays in
place and reentry waits for it to be resolved. A completed restore removes the
marker so a later retry cannot replay it over newer edits.

Now, a refused recovery reports the retained marker's location
and the worktree changes that need attention. It blocks both Check and Require;
Check treats ordinary command failures as warnings, not unresolved recovery.

When a project is attached, LoopTroop applies its saved [folder-ignore policy](configuration.md#looptroop-folder-ignore-policy) to `/.looptroop/` and `/.ticket/`. **This clone** (`local`) is the default and appends the rules to the clone's Git exclude file, normally `.git/info/exclude`, without modifying tracked files. **Repository** (`repo`) appends them to the project's tracked `.gitignore`, while **Nowhere** (`skip`) deliberately writes neither destination and leaves a visible warning. Ticket initialization reapplies the saved project policy; for non-skip projects, it uses the shared Git exclude only when a new worktree does not yet see effective rules. Existing rules are never removed automatically.

The `tmp/*.json` maintenance files are repository-local helpers, not durable source-of-truth data. Removing them only causes LoopTroop to regenerate them on the next relevant run.

## 3. Startup Maintenance

`npm run dev` starts the frontend, backend, and OpenCode watcher stack. Documentation is hosted separately at `https://www.looptroop.ovh/docs/` and is not served from the application checkout.

### Preflight responsibilities

Before those services launch, LoopTroop runs a dev preflight that:

- prints immediate progress for bootstrap checks, daily maintenance, stale-process cleanup, and port availability so startup does not appear stalled during slower checks
- restores missing local tooling with `npm ci` when dependencies need to be restored, then verifies required local dev binaries
- checks direct dependencies against npm publish metadata (only when maintenance is opted in)
- previews stale direct dependencies with npm's normal peer resolver and updates only compatible stable releases that are newer than the current installed version and at least 7 days old
- holds newer releases that are still inside that 7-day delay or conflict with the current peer dependency graph; automatic maintenance never retries with `--force` or `--legacy-peer-deps`
- previews `npm audit fix` lockfile changes with the same peer resolver, recognizes npm's expected exit code when unresolved findings remain, and runs the fix only when the proposal is compatible and every proposed npm package version has passed the same 7-day delay
- retries temporary npm audit transport or malformed-response failures once, then defers that audit without stamping it complete so an external registry outage cannot prevent the application or a boot-enabled service from starting
- upgrades the local `opencode` CLI to the latest available version when the binary is installed (only when maintenance is opted in)
- checks and reclaims only stale LoopTroop-owned processes on configured ports
- refuses to kill unrelated port occupants and reports which process still owns the conflicting port
- writes the last successful preflight snapshot to `tmp/dev-preflight-report.json`
- prints one concise startup summary by default, including package gate notes, updated package names, previous and new versions, held package names, and next eligible times

### OpenCode, auth, and service bootstrap

`npm run dev` also resolves the local OpenCode server endpoint before the dev services launch:

- **Reuse:** if the configured address is already responding to authenticated requests, `npm run dev` reuses that running instance.
- **Explicit base URL guard rail:** if an explicitly configured local `LOOPTROOP_OPENCODE_BASE_URL` is occupied by a non-OpenCode process, startup stops and asks you to choose another URL. Automatic port fallback only applies to the default local address.
- **Port fallback:** if the default OpenCode port (`4096`) is occupied by a non-OpenCode process, `npm run dev` scans for the next free port and starts OpenCode there instead.
- **Permission mode:** when `npm run dev` starts the managed OpenCode server, it sets `OPENCODE_PERMISSION='"allow"'` by default. LoopTroop also applies a complete ordered permission policy to every session before each prompt, explicitly allowing `external_directory` and `doom_loop` for trusted unattended work before applying any phase-specific restrictions. If OpenCode still emits an unexpected permission request, LoopTroop answers it automatically with `always`; a failed reply aborts the session immediately so normal retry or blocked-error handling can proceed instead of leaving the ticket idle. Set `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` to leave any existing OpenCode permission environment untouched; session-level policies still apply.
- **LAN and trusted same-origin proxies:** start with `npm run dev --lan` only when exposing the frontend directly on a trusted local network. The startup summary prints LAN URLs and a QR code for mobile testing, while backend API and OpenCode remain loopback-only behind the Vite dev proxy. A trusted same-origin proxy such as Tailscale Serve can instead front the ordinary loopback Vite server. For either route, before forwarding an API request to the loopback backend, Vite normalizes `Origin` only when the browser marks the request as same-origin and its `Origin` authority matches the incoming frontend `Host`. An unrelated site's `Origin` stays unchanged and the backend rejects it. Documentation links continue to use the hosted site. Under WSL, LoopTroop does not start a relay process; it prints a Windows Administrator PowerShell `netsh interface portproxy` + firewall one-liner, matching cleanup commands, and a Windows-side self-test instead. If the matching Windows network profile is Public, LoopTroop also prints the exact `Set-NetConnectionProfile ... -NetworkCategory Private` fix command. Router/AP client isolation still has to be checked manually if Windows-side self-tests pass but other devices cannot connect.
- **Verbose OpenCode logs:** start with `npm run dev --opencode-logs=all` to print full managed OpenCode DEBUG logs in your terminal via `--print-logs --log-level DEBUG`. Managed logs are also written to the normal OpenCode log directory. This only affects servers started by the dev launcher; reused, remote, or mock OpenCode servers keep their own logging configuration. Treat DEBUG output as sensitive local troubleshooting data because it may include request or provider details.
- **Provider error enrichment:** if OpenCode reports only `Provider returned error`, LoopTroop scans the newest local OpenCode logs for the same session and records the exact sanitized provider cause when available. By default it looks in `~/.local/share/opencode/log/`, considers ten candidate files, and reads at most 5 MiB per file; set `LOOPTROOP_OPENCODE_LOG_DIR` when reusing an external OpenCode server whose logs live elsewhere. This bounded diagnostic read is separate from complete DEBUG/history loads.

Complete DEBUG/history reads use the full available native OpenCode file set
only when a user requests history, Go to top, bead navigation, or export.
Initial views stay paginated and do not eagerly download the archive. Native
history retains four recent snapshots for cursor stability; an expired cursor
returns `LOG_CURSOR_EXPIRED` rather than a partial page. Complete metadata,
read, and index failures surface, while diagnostic enrichment remains best
effort. Native page materialization is `LIMIT`-bounded, but lineage visibility
work grows with ancestry depth; a cold or unseen session still scans its needed
prefix and upstream-deleted files cannot be recovered.

> [!NOTE]
> **Current behavior.** Same-size native file rewrites with a changed
> modification time, and larger rewrites with a changed indexed prefix, produce
> a fresh history snapshot. Retained cursors keep their old rows, while fresh
> views include the updated native logs. Prefix verification reads the indexed
> bytes when a file grows; unchanged files reuse their index.
> A scan uses the file boundary captured when it starts. Ordinary appends beyond
> that boundary do not fail the request; a later refresh reads them. Verification
> checks the complete bytes actually indexed and any reused prefix. Rewriting
> those bytes during the scan still fails rather than publishing mixed history,
> and an unfinished final line is reread on the next scan.

- **Ephemeral auth:** if `OPENCODE_SERVER_PASSWORD` is not set and a new local OpenCode server is about to start, `npm run dev` generates a random credential and sets `OPENCODE_SERVER_USERNAME` to `opencode`. This credential is propagated automatically to all child processes — backend and watcher — for the duration of the session.
- **Ephemeral API token:** if `LOOPTROOP_API_TOKEN` is not set, `npm run dev` generates one for the backend and Vite dev proxy so local same-origin `/api/*` calls are protected without embedding the token in the frontend bundle.

Normal `npm run dev` is verify-only with respect to your dependencies: it never rewrites `package.json`, the lockfile, or a globally installed CLI. Dependency sync, npm audit remediation, and the OpenCode CLI upgrade are opt-in through `LOOPTROOP_DEV_MAINTENANCE=1`, or run explicitly with `npm run deps:sync`, `npm run audit:remediate`, and `npm run opencode:upgrade`. When opted in, that expensive networked maintenance work is daily-gated through `tmp/dev-maintenance-state.json`: each task runs on the first local dev start of the day, then runs again only if its relevant inputs change later that day.

"Verify-only" is scoped to dependencies, and preflight still performs three actions on your machine:

- It runs `npm ci` when the installed tree has drifted from the lockfile. This is deterministic and lockfile-driven, so it installs exactly the pinned versions and introduces nothing new.
- It terminates stale LoopTroop-owned dev processes from a previous session in this repository, leaving unrelated processes alone.
- It reclaims the configured ports when they are held by those stale processes, and refuses to touch a port owned by anything else.

The last two exist so a crashed session does not block the next start. They apply only to processes this repository launched.

Audit failure handling distinguishes external availability from local integrity. Registry timeouts, connection errors, rate limits, service errors, and malformed audit responses are retried once and then reported as deferred without blocking normal startup. Because a deferred audit is not recorded as successful, the next eligible startup retries it. Local failures such as an unreadable lockfile, an invalid staged lockfile, or a failed dependency application remain startup-blocking. The standalone `npm run audit:remediate` command remains strict and exits unsuccessfully for either category so explicit maintenance and automation can detect incomplete work.

The 7-day release delay applies to direct npm package updates selected by dependency sync and to all npm package versions proposed by audit remediation. Before changing the live checkout, LoopTroop resolves proposed package and lock files in a temporary directory, then validates the result with `npm ci --dry-run` under npm's normal peer-dependency rules. Incompatible direct releases are held while compatible candidates can still proceed; related candidates are reconsidered together so a supporting package can unlock a previously incompatible update. If npm rejects a registry-hosted tarball as a remote URL during a direct-update preview, LoopTroop holds only the triggering direct update and retries it on the next daily check; it never loosens npm's remote-package policy. A rejected URL from any host other than the configured npm registry remains an error. Audit remediation is all-or-nothing: if npm rejects the proposed graph, or proposes any package version that is too fresh or whose publish time cannot be verified, LoopTroop holds the entire `npm audit fix` attempt. Every held-package detail states its specific cause: an incomplete 7-day release-safety period with the exact eligibility timestamp, unavailable npm metadata, a non-comparable version, an incompatible peer dependency with npm's exact constraint, or a registry-tarball policy hold. Accepted proposals are applied with `npm ci`; if that fails, the previous package files and dependency graph are restored. Automatic maintenance never bypasses npm conflicts with `--force` or `--legacy-peer-deps`. OpenCode is exempt only from the release-age delay: the local OpenCode CLI and direct `@opencode-ai/sdk` package update immediately when their normal maintenance path runs, while npm peer compatibility remains mandatory.

## 4. Maintenance Commands

Run the individual maintenance steps directly when you need tighter control:

```bash
npm run deps:sync
npm run audit:remediate
npm run opencode:upgrade
```

Use one-run startup flags when you want to change `npm run dev` behavior:

```bash
LOOPTROOP_DEV_MAINTENANCE=1 npm run dev
LOOPTROOP_DEV_MAINTENANCE=1 LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev
LOOPTROOP_DEV_MAINTENANCE=1 LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev
LOOPTROOP_DEV_MAINTENANCE=1 LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev
npm run dev --lan
npm run dev --opencode-logs=all
```

These commands update the same maintenance timestamps used by opted-in startup gating. `deps:sync` and `audit:remediate` still respect `LOOPTROOP_DEV_SKIP_DEPS=1`; `opencode:upgrade` still respects `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1`. The `LOOPTROOP_DEV_SKIP_*` and `LOOPTROOP_DEV_FORCE_MAINTENANCE` flags only affect `npm run dev` when maintenance is opted in, since it is otherwise skipped entirely.

### Scheduled Dependency Updates

Routine dependency updates are handled by Renovate rather than by local tooling, so the same policy applies whether or not any contributor happens to start the app. The configuration lives in `.github/renovate.json` and is validated in CI, because an invalid rule is ignored silently at runtime rather than reported.

| Policy | Setting |
| --- | --- |
| Schedule | Grouped pull requests, nightly between 00:00 and 06:00 |
| Release maturity | 7 days before a version is proposed |
| Security advisories | 2 days, raised outside the nightly schedule |
| Dev dependencies | Patch and minor grouped and reviewed by hand. Twelve lint, test and type-only packages auto-merge once CI is green, patch releases only, and none of them below 1.0 |
| Runtime dependencies | Grouped, always reviewed by hand |
| Major updates | One pull request each, always reviewed by hand |
| Lockfile refresh | Weekly, Monday to Wednesday. It resolves against the registry as it stood 7 days earlier |
| Dependency dashboard | One issue listing every update Renovate knows about and why it has not shipped |
| GitHub Actions | Pinned to commit SHAs and updated by Renovate |

Dependencies with additional constraints:

- **`drizzle-orm` and `drizzle-kit`** move together on the `rc` tag and stay exact-pinned. A global install re-resolves ranges on the user's machine and ignores the lockfile, so a loose range would ship an untested release candidate.
- **`@opencode-ai/sdk`** takes the ordinary 7 days and is always reviewed by hand. The SDK talks to an OpenCode CLI that users install separately and that Renovate cannot see, so the risk here is version skew rather than an immature release. No maturity window addresses that, only a person reading the pull request. Update the documented minimum version in the same pull request.
- **`@types/node`** is held below the next major so it cannot drift ahead of the supported runtime and hide use of newer APIs.
- **`tailwindcss` and `@tailwindcss/vite`** move together because the Vite integration must match the application stylesheet compiler.

`npm audit` runs in CI as a report only and never applies fixes automatically; remediation is a reviewed change.

## 5. Scripts Reference

Run any of these with `npm run <name>`. This is the subset worth knowing, not the
full list — `package.json` currently declares far more, mostly the `verify:*`,
`build:*` and `release:*` families that the release pipeline drives. `npm run`
with no arguments prints all of them.

### Development Stack

| Script | Purpose |
| --- | --- |
| `dev` | Full stack: frontend, backend, OpenCode watcher, and dev preflight. **Standard start command.** In-app documentation links point at the hosted docs site. |
| `dev:app` | Frontend and backend only — no OpenCode watcher. Use when OpenCode is already running externally. Note: this bypasses the `predev` preflight (the `predev` hook only runs for `dev`), so dependency sync, npm audit, OpenCode upgrade, port-conflict cleanup, and the auto-generated `OPENCODE_SERVER_PASSWORD` / `LOOPTROOP_API_TOKEN` are skipped — set those yourself when needed. |
| `dev:frontend` | Vite dev server only. |
| `dev:backend` | Backend Hono API server only. |
| `dev:opencode` | OpenCode watcher only. |

### Build And Preview

| Script | Purpose |
| --- | --- |
| `build` | Type-check, then build the client bundle and the server (`tsc -b && npm run build:client && npm run build:server`). The server half is what makes the daemon and the standalone executable possible. |
| `preview` | Serve the last production build locally for inspection. |

The frontend dev server pre-optimizes its complete declared browser dependency set before serving the app and disables browser storage of dev resources. This makes a process restart safe even when the browser restores a previously open LoopTroop tab: the restored document cannot retain an old React dependency graph while a lazy ticket workspace loads from the new process. The dependency policy is checked against production imports in the localized Vite configuration test.

### Operational Tools

| Script | Purpose |
| --- | --- |
| `predev` | Automatic dev preflight hook that runs before `npm run dev`. Usually invoked through `npm run dev`, not by hand. |
| `verify:published` | Install a **published** release from its real feed using the documented command, start it, check the health endpoint, and remove it again. Needs network access and a version that is actually published — `-- --channel npm --version X.Y.Z`, or `-- --plan --tier weekly` to list the legs without running any. Normally driven by the Published install smoke workflow rather than by hand. |
| `deps:sync` | Preview direct dependency updates with npm peer resolution, apply compatible releases with `npm ci`, hold conflicts, then refresh the daily-maintenance stamp. |
| `audit:remediate` | Preview the gated npm audit remediation in isolation, hold incompatible proposals, and apply accepted lockfiles with `npm ci`. |
| `opencode:upgrade` | Run only the OpenCode CLI upgrade step, then refresh the daily-maintenance stamp. |
| `diagnose:stall` | Generate a runtime diagnostics report under `tmp/diagnostics/`. |

### Tests And Code Quality

| Script | Purpose |
| --- | --- |
| `test` | Run all test projects once and exit. |
| `test:client` | Client tests only (`client-dom` and `client-node` projects). |
| `test:server` | Server tests only (`server-pure` and `server-integration` projects). |
| `test:watch` | Run all tests in watch mode. Useful during active development. |
| `typecheck` | Type-check the full project with `tsc --noEmit`. |
| `lint` | Lint the full project with ESLint. |

`vitest.config.ts` defines four test projects:

- **`client-dom`** — React component tests that require a JSDOM environment
- **`client-node`** — client-side logic tests that do not need a DOM
- **`server-pure`** — server unit tests with no I/O or database
- **`server-integration`** — server integration tests running against a real local SQLite instance

Run `test:client` and `test:server` separately when you only want to validate one layer. Run `test` to validate both together.

### Database Schema Tools

| Script | Purpose |
| --- | --- |
| `db:generate` | Generate app DB migration artifacts for external tooling review. Alias for `db:generate:app`; normal app schema changes still need `server/db/schema.ts` and runtime bootstrap updates in `server/db/init.ts`. |
| `db:generate:app` | Generate app DB migration artifacts from the configured app database target. Verify output against `server/db/schema.ts` before committing. |
| `db:generate:project` | Generate project DB migration artifacts from `LOOPTROOP_PROJECT_DB_PATH`. |
| `db:push` | App DB push command retained for ad-hoc local experiments only; do not use as the normal app schema-change workflow. |
| `db:push:app` | Same as `db:push`; avoid for normal app schema changes because runtime bootstrap owns app DB creation/evolution. |
| `db:push:project` | Push schema changes directly to the project database target from `LOOPTROOP_PROJECT_DB_PATH`. |

The app database is runtime-bootstrapped by `server/db/init.ts`. The committed migration directory is not the source of truth for live app startup. Project DB work should use the explicit project scripts.

## 6. Environment Variables

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port; also drives the default frontend origin when `LOOPTROOP_FRONTEND_ORIGIN` is unset |
| `LOOPTROOP_FRONTEND_ORIGIN` | Override full frontend origin URL, for example `http://my-server:5173`; a valid explicit origin takes precedence over `LOOPTROOP_FRONTEND_PORT`, while an invalid value falls back to the default origin |
| `LOOPTROOP_BACKEND_HOST` | Backend bind host; defaults to `127.0.0.1` |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_ALLOW_REMOTE_API=1` | Required before binding the backend to a non-loopback host; remote binds still require `LOOPTROOP_API_TOKEN` |
| `LOOPTROOP_PUBLIC_ORIGIN` | Current behavior: one browser-visible HTTPS origin for a reverse proxy; no credentials, path, query, or fragment. Use remote API opt-in and preserve the public Host. Does not change the bind address or trust forwarded headers |
| `LOOPTROOP_ALLOW_UNAUTHENTICATED=1` | Permit unauthenticated `/api/*` access only when no `LOOPTROOP_API_TOKEN` is configured; intended for local-only troubleshooting, never for use together with `LOOPTROOP_ALLOW_REMOTE_API=1` |
| `LOOPTROOP_API_TOKEN` | Optional token required by `/api/*`; `npm run dev` generates an ephemeral value when unset and the Vite dev proxy forwards it server-side |
| `LOOPTROOP_TRUST_PROXY=1` | Trust `x-forwarded-for` / `x-real-ip` for rate-limit buckets; leave unset unless a trusted proxy owns those headers |
| `LOOPTROOP_ENABLE_DEV_EVENT=1` | Enable the development-only ticket event injection route when paired with `LOOPTROOP_DEV_EVENT_TOKEN` |
| `LOOPTROOP_DEV_EVENT_TOKEN` | Required secret for the dev-event route when it is enabled |
| `LOOPTROOP_DOCS_ORIGIN` | Override the external documentation origin, for example a hosted preview deployment; defaults to `https://www.looptroop.ovh` |
| `LOOPTROOP_DEV_HOST` | Direct watcher fallback for LAN sharing; set to `1`, `true`, `0.0.0.0`, or a specific host/IP when not launching through `npm run dev --lan` |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |
| `LOOPTROOP_PROJECT_DB_PATH` | Project database target for explicit Drizzle project DB commands |
| `LOOPTROOP_DEV_MAINTENANCE=1` | Opt in to the daily dependency sync, npm audit remediation and OpenCode CLI upgrade during `npm run dev`; these are skipped by default because they rewrite `package.json`, the lockfile, or a globally installed CLI |
| `LOOPTROOP_DEV_SKIP_DEPS=1` | Skip automatic dependency sync and audit remediation during `npm run dev` |
| `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1` | Skip the automatic local OpenCode CLI upgrade during `npm run dev` |
| `LOOPTROOP_DEV_FORCE_MAINTENANCE=1` | Bypass the once-per-day maintenance gate and force all startup maintenance checks now |
| `LOOPTROOP_OPENCODE_MODE` | Set to `mock` to use the mock adapter instead of the real SDK adapter |
| `LOOPTROOP_OPENCODE_PERMISSION_MODE` | Set to `inherit` to skip setting `OPENCODE_PERMISSION='"allow"'` when `npm run dev` starts a managed OpenCode server; by default LoopTroop sets permissive mode automatically for local trusted sessions |
| `LOOPTROOP_OPENCODE_LOGS=all` | Direct watcher fallback for `npm run dev:opencode`; starts a managed OpenCode server with `--print-logs --log-level DEBUG` when the watcher actually launches OpenCode |
| `LOOPTROOP_OPENCODE_LOG_DIR` | Optional OpenCode log directory used to enrich generic provider errors from an external or nonstandard OpenCode server; default lookup is `~/.local/share/opencode/log/` |
| `CHOKIDAR_USEPOLLING` | Governs both the frontend (Vite) and backend file watchers. Leave unset for auto-detection (native watching everywhere except WSL on a Windows-mounted drive). Set to `1` to force polling or `0` to force native watching |
| `OPENCODE_SERVER_USERNAME` | Basic auth username for the local OpenCode dev server; defaults to `opencode` when `OPENCODE_SERVER_PASSWORD` is also set |
| `OPENCODE_SERVER_PASSWORD` | Basic auth password for the local OpenCode dev server; auto-generated as an ephemeral random credential by `npm run dev` if not set and a new local OpenCode server is about to start |

Default local service addresses:

| Service | Address |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend | `http://127.0.0.1:3000` |
| Docs | `https://www.looptroop.ovh/docs/` (hosted externally) |
| OpenCode | `http://127.0.0.1:4096` |

Default port resolution and origin building are implemented in `shared/appConfig.ts`, which validates environment variables and provides fallback defaults for the local application services plus the external documentation origin.

When `LOOPTROOP_FRONTEND_ORIGIN` is not explicitly set, LoopTroop derives the frontend origin from `LOOPTROOP_FRONTEND_PORT`, defaulting to `http://localhost:5173`. If `LOOPTROOP_FRONTEND_ORIGIN` is set but cannot be parsed as a URL origin, LoopTroop ignores it and falls back to that derived default.

LoopTroop accepts API tokens through either `x-looptroop-token` or `Authorization: Bearer <token>`.

> [!IMPORTANT]
> Query-string credentials are not accepted, including on `/api/stream`. In the
> development stack, the Vite proxy injects `LOOPTROOP_API_TOKEN` as a header
> server-side, so native browser `EventSource` connections do not need access to
> the token. An installed browser instead sends its same-origin session cookie.
> An installed daemon's bearer token is the one it minted into `daemon.json`,
> not `LOOPTROOP_API_TOKEN` — see the [API Reference](api-reference.md) for both
> models side by side.

### Useful Health Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Backend availability, timestamp, and uptime |
| `GET /api/health/opencode` | OpenCode availability, version, and currently visible model list |
| `GET /api/health/startup` | Startup storage/runtime snapshot used by the UI restore popup and mounted-drive warning surfaces |
| `POST /api/health/startup/restore-notice/dismiss` | Persist dismissal of the one-time startup restore popup |

## 7. API Rate Limits

The backend applies a global per-client rate limit to API routes. Read requests, normal write actions, and UI-state autosaves use separate buckets so frequent draft saves do not exhaust the workflow-action budget. Defaults are 200 reads/minute, 120 normal writes/minute, and 300 autosaves/minute per client. The lightweight `GET /api/health` liveness probe is exempt from the read bucket so the UI can distinguish rate limiting from an unreachable backend; authentication still applies. If a client exceeds another limit, the API returns `429` with a `Retry-After` response header in seconds. Wait for that interval before retrying requests or refreshing aggressively.

Forwarded client IP headers are ignored unless `LOOPTROOP_TRUST_PROXY=1` is set. This keeps local clients from bypassing limits by spoofing `x-forwarded-for`.

## 8. Project Git Hygiene

If `.looptroop` was already tracked before the project was attached, ticket startup is blocked with `INIT_LOOPTROOP_TRACKED`. This prevents nested or stale LoopTroop worktree data from being checked out into every new ticket worktree.

Clean that repository from the attached project root:

```bash
git rm --cached -r .looptroop
git commit -m "Stop tracking LoopTroop runtime data"
```

This removes LoopTroop runtime paths from the Git index without deleting the local runtime files from disk.

After cleanup, `git status --short .looptroop` should not show tracked `.looptroop` entries. Runtime files may still exist locally, but they should be ignored according to the project's saved policy unless **Nowhere** was chosen. Ticket worktree artifacts under `.ticket/**` are likewise excluded from future bead commits; they remain available to LoopTroop but are not intended for target repository branches.

Other ticket initialization errors from the Git hygiene check:

- `INIT_LOOPTROOP_EXCLUDE_FAILED` — LoopTroop could not apply the project's saved `.looptroop/` and `.ticket/` ignore policy. Check that the selected `.gitignore` or Git exclude destination is writable.
- `INIT_LOOPTROOP_TRACKED_CHECK_FAILED` — The `git ls-files` check itself failed. Verify that the attached project path is a valid, accessible Git repository.

## 9. Worktree Disk Cleanup

Over time `.looptroop/worktrees/` can grow large as completed and canceled tickets leave behind code checkouts, execution logs, and generated file artifacts.

Use the UI cleanup flow:

1. Open **Settings -> Projects** and click **Edit** on the project you want to clean up.
2. Click **Free Disk Space...** at the bottom-left, next to **Delete Project**.
3. Click **Calculate Size** to see the total size of the worktrees considered for cleanup.
4. Click **Delete Worktrees** to remove worktrees for completed and canceled tickets.

**Deleted:** temporary directories at `.looptroop/worktrees/<ticket>/` for tickets in the Completed or Canceled column, including code checkouts, execution logs, and AI-generated file artifacts.

> [!NOTE]
> **Current behavior.** Both **Free Disk Space** and CLI cleanup refuse to
> remove a worktree containing ignored files outside `.ticket` and `.looptroop`.
> This protects `.env` files and also keeps ignored dependencies and build output.
> Move or remove those files manually before retrying. An inspection failure
> also blocks removal. Explicit ticket or project deletion remains destructive.

Now, Free Disk Space continues with eligible worktrees when
another worktree is protected or cannot be removed. The dialog stays open with
the skipped ticket IDs and reasons. Its result counts only removed worktrees;
the size preview includes protected worktrees and is not a promise of freed space.

Now, a pre-start directory containing only LoopTroop's `.ticket`
skeleton is checked directly, so unrelated ignored files in the parent repository
do not block it. The same check runs immediately before removal. Any other
entry in that directory keeps it in place. A timed-out Git removal is reported
as incomplete, without recursively deleting a directory that Git may still be
using.

LoopTroop restores owner removal permissions before deleting each eligible worktree. This handles project-agnostic read-only outputs such as dependency caches, downloaded toolchains, generated directories, and language package caches without requiring ecosystem-specific cleanup settings. Symlinks are removed without changing or traversing their external targets. Files owned by another operating-system user or protected by ACLs, immutable flags, or equivalent platform controls may still require the underlying ownership or protection to be corrected.

**Preserved:**

- project source code and normal repository files
- active, queued, and draft ticket worktrees
- ticket records in the dashboard, including title, description, and status

Startup recovery and cleanup have different boundaries. An orphan YAML temp
without a matching proof or a torn whole-file JSONL temp is warned about and
left unpromoted. Only an in-progress fallback whose `.recovery` ownership or
completeness cannot be verified raises `RECOVERY_BLOCKED` and stops startup;
the affected files and diagnostic remain available at that point. `CLEANING_ENV`
then removes its selected resources under `runtime/`, including `runtime/tmp/`
and `runtime/execution-setup/`, recursively without inspecting every sidecar
for recovery ownership, and **Delete Worktrees** removes the entire eligible
worktree. The persistent Manual QA SQLite lock database is outside those
transient roots and is not unlinked by cleanup or recovery code.

> [!NOTE]
> **Current behavior.** Whole-file JSONL recovery requires a matching
> byte-length and SHA-256 proof, including for an empty collection. Unproved
> temporary files remain available for inspection. Recovery checks every path
> component before filesystem operations and reports paths in the spelling
> supplied by the caller, including platform-specific path aliases.

> [!NOTE]
> **Current behavior.** Manual QA workspace decisions serialize their Git
> mutations. A repeated quarantine copy reuses an identical backup; different
> content gets an action-specific retry destination, recorded in the receipt
> and event. Comparison uses bounded buffers so large files do not need to fit
> in memory. Existing backup content is preserved.
> The opened file identity is checked before and after comparison; replacing a
> path during the check cannot make a different file count as an identical backup.

## 10. Diagnostics

> [!NOTE]
> **Current behavior.** The Node check in the doctor's JSON report includes
> `node.version`. Automation can read the embedded runtime version from that
> field without parsing the human-readable detail. Existing check names stay
> unchanged.

> [!NOTE]
> `diagnose:stall` is a **checkout-only** tool. It lives in `scripts/`, which the
> published package does not ship, so an installed LoopTroop has no such command.
> From an installed copy, use `looptroop doctor`, `looptroop status --json` and
> `looptroop logs -f` — see [Runtime Diagnostics](diagnostics.md).

If the UI feels slow, tickets disappear after refresh, or the app appears to stall, run the diagnostic command while `npm run dev` is still running:

```bash
npm run diagnose:stall
```

The report is saved as `tmp/diagnostics/runtime-stall-<timestamp>.log` and includes endpoint latency, backend/frontend/OpenCode activity, trend-wide whole-system CPU/RSS/I/O consumers, pressure-stall metrics, SQLite/WAL state, attached project health, active sessions, Git responsiveness, and optional focused ticket runtime artifact sizing.

Useful options:

```bash
npm run diagnose:stall -- --sample-ms 5000
npm run diagnose:stall -- --timeout-ms 8000
npm run diagnose:stall -- --trend-ms 0
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
npm run diagnose:stall -- --ticket-path /path/to/worktree/.ticket
```

For the full diagnostics guide, including the runtime report plus blocked-error and structured-retry surfaces, see [Runtime Diagnostics](diagnostics.md).

> [!NOTE]
> **Current behavior.** The diagnostic command and provider-error
> enrichment remain bounded diagnostic surfaces. Complete DEBUG/history reads
> are separate, action-triggered operations and report native cursor expiry or
> complete-read failures instead of silently returning a partial or empty
> history.

## 11. OpenCode Reachability

Symptoms:

- the model list in the UI is empty
- ticket logs show connection errors
- phases that need a model block before drafting, setup, or execution

Checks:

When using `npm run dev`, port resolution and basic auth are handled automatically. The checks below apply when OpenCode is still unreachable after startup or when running the backend outside of `npm run dev`.

> [!NOTE]
> **An installed daemon does not need step 1.** It adopts a running OpenCode or
> starts and supervises one itself — see
> [OpenCode is managed for you](#opencode-is-managed-for-you). Step 2's
> `X-LoopTroop-Token` is also the wrong credential there: an installed daemon
> mints its own into `daemon.json`.

1. Ensure OpenCode is running: `opencode serve`.
2. Ping the backend health endpoint: `curl http://127.0.0.1:3000/api/health/opencode`. If you configured `LOOPTROOP_API_TOKEN`, include `-H "X-LoopTroop-Token: $LOOPTROOP_API_TOKEN"`.
3. If OpenCode is on a non-default port, set `LOOPTROOP_OPENCODE_BASE_URL`, for example `export LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:4097`.
4. If you started OpenCode outside of `npm run dev`, ensure `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` match the values LoopTroop is using. A credential mismatch causes silently failed requests.
5. If LoopTroop only records generic provider failures, inspect the newest files under `~/.local/share/opencode/log/` or point `LOOPTROOP_OPENCODE_LOG_DIR` at the external server's log directory so LoopTroop can enrich those errors.

## 12. Watcher and WSL Performance Notes

Both the frontend (Vite) and backend watchers prefer native file watching on normal local filesystems — Linux (including a remote VPS), macOS, and native Windows all use fast native OS file-system events by default. Polling is only enabled automatically when it is genuinely required: a WSL runtime whose workspace lives on a Windows-mounted drive such as `/mnt/c/...`, where native watching is unreliable.

> [!NOTE]
> Earlier versions forced polling for the frontend on every platform, which wasted CPU and added refresh latency on native Linux/macOS/Windows (most noticeable on remote hosts). Both watchers now share a single OS-agnostic decision (`resolveWatchPollingDecision()` in `shared/wslPerformance.ts`) so native watching is used everywhere unless polling is actually needed.

If your environment still misses file changes, force polling for the run (applies to both watchers):

```bash
CHOKIDAR_USEPOLLING=1 npm run dev
```

You can also force native watching off a mounted drive with `CHOKIDAR_USEPOLLING=0`; an explicit value always overrides the auto-detection in either direction.

### Windows-Mounted Drive Warning (WSL Users Only)

If you run LoopTroop inside Windows Subsystem for Linux (WSL), ensure that your attached target projects — and, if you are working from a checkout, the checkout itself — reside on the native Linux file system (e.g., under `/home/username/...` or another path in `\wsl$`). The project half of this applies to an installed LoopTroop too.

> [!WARNING]
> **Avoid Windows-mounted drives (like `/mnt/c/...` or `/mnt/d/...`) in WSL.**
>
> Keeping attached projects — or a LoopTroop checkout — on Windows-mounted drives severely degrades disk I/O performance. This slows down Git operations, codebase scanning, and test execution. It also disables native file-watching, forcing a fallback to chokidar polling (`CHOKIDAR_USEPOLLING=1`). For optimal performance, always store your workspaces and repositories inside the Linux home directory.

The path detection logic is implemented in `shared/wslPerformance.ts`, which exports `isWslWindowsMountPath()` to identify Windows-mounted paths, `resolveWatchPollingDecision()` to choose native watching vs. polling for both the frontend and backend watchers, and `buildWslAppMountedDriveWarning()` / `buildWslProjectMountedDriveWarning()` to generate targeted performance warnings.

When LoopTroop detects these mounted-drive paths, it surfaces the warning in two places: the startup UI warns when the LoopTroop app itself lives on a Windows-mounted drive, and project attachment warns when the target repository is mounted there.

## 13. Audit Warnings

`npm audit --omit=dev` should be clean. A full `npm audit` can still report dev-only findings through transitive development tooling:

- `drizzle-kit` stable still depends on deprecated `@esbuild-kit/*`, which brings an older `esbuild`. The upstream issue is tracked here: [drizzle-team/drizzle-orm#3067](https://github.com/drizzle-team/drizzle-orm/issues/3067).

Do not run `npm audit fix --force` as routine maintenance for these warnings. The current forced fix path proposes a breaking `drizzle-kit` downgrade and does not represent a safe application hardening change.

## Related Docs

- [Installation](installation.md) — every channel, upgrading, uninstalling, and the development checkout
- [CLI Reference](cli.md) — every command an installed LoopTroop has
- [Getting Started](getting-started.md)
- [System Architecture](system-architecture.md)
- [Runtime Diagnostics](diagnostics.md)
- [OpenCode Integration](opencode-integration.md)
