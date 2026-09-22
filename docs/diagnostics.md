# Runtime Diagnostics

> [!IMPORTANT]
> **TL;DR** — LoopTroop exposes three different diagnostic surfaces: a local runtime-stall report, persisted blocked-error diagnostics on ticket failures, and structured retry diagnostics on artifacts that needed correction or re-prompting. Use the surface that matches the failure mode instead of treating everything as a generic "the ticket broke" event.

This page covers the diagnostics that help explain slow local behavior, blocked ticket runs, and recoverable structured-output failures.

## 1. Choose the Right Diagnostic Surface

| Surface | When it appears | Where to inspect it | Best for |
| --- | --- | --- | --- |
| `looptroop doctor` | Any time — before the first ticket, or after anything goes wrong | Your terminal | Whether this machine can run LoopTroop at all, and how this copy was installed |
| Runtime stall report | You run `npm run diagnose:stall` while the app is slow or behaving oddly | `tmp/diagnostics/runtime-stall-*.log` | Slow refreshes, missing tickets after reload, OpenCode reachability issues, disk / CPU / memory pressure |
| Blocked-error diagnostics | A phase ends in `BLOCKED_ERROR` | Ticket error view and persisted error occurrence data | Provider failures, timeouts, session errors, transport failures, model output truncation |
| Structured retry diagnostics | A structured-output phase rejects one or more model attempts before validating or finally failing | Artifact processing notices and artifact detail views | Why a response was retried, what validation failed, and what excerpt caused the retry |

### Complete DEBUG history and bounded diagnostics

> [!NOTE]
> **Current behavior.** Complete DEBUG/history reads use the full
> available native OpenCode file set. Provider-error diagnostics retain their
> bounded defaults: the ten newest candidate files and at most 5 MiB per file.
> Diagnostic reads remain best effort; complete metadata, read, and index
> failures are surfaced instead of being turned into an empty history.

The DEBUG/history path is an action-triggered complete read for Go to top,
bead navigation, and export. Initial log views stay paginated and do not
eagerly download the archive. Native history uses incremental index ranges for
appends and retains four recent snapshots for cursor stability. A cold or
unseen session still scans the needed prefix, and files removed upstream cannot
be recovered. Native page rows are `LIMIT`-bounded, while lineage visibility
checks grow with ancestry depth.

## 1a. `looptroop doctor`

The first thing to run, and the cheapest.

```bash
looptroop doctor
looptroop doctor --json
```

It checks the machine rather than a ticket. In a normal CLI run that means a
leading `version` update check plus machine checks named `node`, `npm`, `git`,
`gh`, `gh auth`, `config dir`, `install`, `schema`, `last start`,
`project ignores`, `opencode cli`, `opencode`, `port`, and `daemon`. Each
failing check prints what to do about it. The floor is **Node 24.15.0 or
newer**. The `npm` check reports the version it finds and does not hold it to
a floor.

**Versions are shown against the newest published one** — `v26.7.0 (latest
v27.1.0)` — for LoopTroop, Node, npm and the OpenCode CLI. When the latest
lookup is unavailable, the report says `latest unknown` instead of stalling the
rest of Doctor. The LoopTroop version is emphasized when it is behind, because
it is the one this machine can act on directly. These lookups are cached for
fifteen minutes, failures included, and never delay the local checks.

**Three marks, and the detail line matters.** `✓` is fine. `!` is a warning.
`✗` is a failing check. For tool probes, the message underneath tells you which
kind of problem it is:

- **missing** — `not found on PATH`
- **refused** — the tool exists, but LoopTroop will not trust that directory or
  real path
- **timed out** — ``<tool> --version`` or a similar probe did not answer within
  its deadline
- **degraded** — the tool answered, but something around it is still wrong, such
  as `gh auth` not being signed in

A refused tool is not the same as a missing one. If the directory is genuinely
operator-controlled, add that **absolute** directory to
`LOOPTROOP_TRUSTED_EXECUTABLE_DIRS`; otherwise move or reinstall the tool into a
location owned by you, root, or the Node runtime owner.

Now, this refusal also applies when a Linux user namespace
hides ownership behind its overflow UID. That value cannot prove that host
root owns the tool. An explicitly trusted directory is required in that case;
the Node executable having the same unverifiable owner does not grant trust.

> [!NOTE]
> **Current behavior.** When a diagnostic prints an HTTP origin, IPv6 host
> literals are bracketed before the port, for example `http://[::1]:3000`. The
> same formatting is used by `status`, `open`, and `setup`, so the displayed
> origin is a usable URL.

`git` is required and `gh` is not: a missing `git` fails the run, a missing `gh`
only warns, because `gh` is needed for the pull-request step at the end of a
ticket and nothing before it. A missing `gh` still prints `✗` — the mark
describes what is there, the severity decides the exit code.

> [!NOTE]
> **`doctor` exits non-zero when any check fails.** That is what makes it usable
> in a script, and it means a fresh machine with no OpenCode configured yet
> reports a failure by design rather than by fault.

`--json` emits JSON on stdout and nothing else, so it can be piped into a
parser. The stable contract is:

- top-level `ok`
- optional top-level `update`
- `checks[]`, keyed by stable `name`

Script against `checks[].name` and structured fields such as
`checks[].install.channel` and `checks[].install.upgradeCommand`; treat
`detail`, `label`, `note`, `remedy`, and check ordering as human-oriented text.
The ordinary CLI attempts to include a leading `version` check and an `update`
summary, but release discovery can be unavailable without making the machine
checks disappear.

`update` contains current/latest versions, update availability, install channel,
ordered upgrade commands, and the latest release's version, name, URL, and
publication date. The release body is left out here — it is prose, often
several kilobytes of it; `GET /api/health/update` returns it in full for the
interface to render.

### The install check

The install-method check is not about whether LoopTroop runs — it is about which
copy this is:

```text
✓ install method  npm
  ↳ upgrade: npm install -g looptroop@latest
```

It names the channel this copy was installed from and the exact command that
upgrades **it**. That matters because the commands are not interchangeable:
running `npm install -g looptroop@latest` against a bun or pnpm installation does
not upgrade it, it installs a second copy under npm's prefix. See
[Installation](installation.md#upgrading).

The channel is worked out from where the files landed, and recorded so the answer
is stable. Some installers state it outright by leaving a marker file; the rest
are inferred from the install path. The answer can legitimately be **unknown** —
an archive unpacked by hand has no evidence to read — and in that case the advice
is generic rather than confidently wrong.

Doctor always shows the current and latest known versions. Release discovery uses
the latest published stable GitHub release, with a 15-minute cache shared by the
CLI and interface. When GitHub cannot be reached, the last known release is kept;
with no cached answer, Doctor prints `latest unknown`. Other human-readable
commands stay silent unless a newer version is known.

### The interface says "Signed out"

This screen means the daemon refused this browser's session. It is not a broken
install, and there are four reasons it appears, with different fixes.

**You opened the origin, not the sign-in link.** `looptroop open` prints
`Opened http://127.0.0.1:3000` — the address, deliberately without the
single-use nonce that actually signs a browser in, because that nonce is a live
credential and this line ends up in scrollback and screenshots. Opening that
address by hand therefore always lands here. Use the tab `looptroop open`
itself opens, or `looptroop open --print-url` to get a link you can paste.

**No browser opened at all.** Over SSH, in WSL, in a fresh virtual machine, or on
a machine with nothing registered for `http`, there may be no browser for
`looptroop open` to launch. Since 0.5.7 it notices — it waits for the browser to
sign in, and prints the sign-in link itself when none does. To ask for that link
without an attempt:

```bash
looptroop open --print-url
```

The URL it prints ends in `#bootstrap=…`. It signs one browser in and then
expires, so treat it as a password: do not paste it into a bug report.

`looptroop start` prints the same link when it starts the daemon.

**The daemon restarted.** Session tokens live in the daemon's memory and are
regenerated on every start, so `looptroop restart`, a crash, or an upgrade ends
every browser session immediately. Sessions otherwise last 12 hours. Sign in
again with `looptroop open`.

**The page is on `localhost` rather than `127.0.0.1`.** Session cookies are
host-only: one obtained at `127.0.0.1:3000` is never sent to `localhost:3000`,
even though they are the same server on the same port. Signing in again does not
help, because `looptroop open` signs you in at `127.0.0.1` and a `localhost`
bookmark still has no cookie. Use the `127.0.0.1` address.

> [!NOTE]
> **Current behavior.** A brief SSE disconnect does not by itself sign the
> browser out. The client asks an ordinary API route with a five-second deadline
> after a failed stream connection; only an HTTP 401 response marks the session
> signed out. An unreachable daemon leaves the session state unchanged while the
> stream reconnects.

## 2. Runtime Stall Report

Run the report while `npm run dev` is still running, ideally during the slowdown:

```bash
npm run diagnose:stall
```

The command writes a timestamped local report under `tmp/diagnostics/`, for example:

```text
tmp/diagnostics/runtime-stall-YYYYMMDD-HHMMSS.log
```

The script is read-only. It does not mutate tickets, repair databases, or modify attached projects.

### 2.1 Platform Support

The diagnostic script runs on **Linux**, **WSL2**, **macOS**, and **Windows**.

| Feature | Linux/WSL | macOS | Windows |
| --- | --- | --- | --- |
| Process `/proc` inspection | ✅ | — | — |
| Pressure-stall metrics | ✅ | — | — |
| Cgroup resource snapshot | ✅ | — | — |
| TCP stats | ✅ (`ss`) | ✅ (`netstat`) | ✅ (`netstat`) |
| FD limits | ✅ | ✅ | — |
| Zombie process count | ✅ | ✅ | — |
| `vm_stat` / `top` integration | — | ✅ | — |
| Shell baseline | bash / sh | bash / sh | PowerShell |

Platform-specific sections that are unavailable simply show as unavailable or `n/a`; the report still runs.

### 2.2 What the Report Captures

The report combines several layers of evidence:

- **Environment and startup context** — resolved ports, candidate/listener PIDs, backend env snapshot, watcher context, shell startup latency, and focused ticket path resolution.
- **Endpoint probes** — frontend, backend health, startup status, projects, tickets, and OpenCode reachability.
- **Short repeated samples** — repeated backend and ticket probes to confirm whether the app was actually stalled during capture.
- **Runtime trend window** — by default a 3-minute trend that samples backend health, `/api/tickets`, watched-process CPU/RSS/I/O, Linux pressure deltas, app/project DB and log growth, and trend-wide whole-system read/write/RSS/CPU leaders.
- **Process activity** — backend, frontend, and OpenCode memory snapshots, wait state, thread count, FD count, and I/O counters.
- **System resource state** — load, memory, pressure-stall metrics, cgroup state, `vmstat`, disk stats, and top resource consumers.
- **Storage and project state** — mount type, free space, inode usage, filesystem latency, SQLite / WAL / SHM sizes, project ticket/session state, and Git responsiveness.
- **Focused ticket runtime sizing** — when `--ticket-path` is supplied, the report also tracks runtime log growth, largest runtime subdirectories, and large artifact files such as build outputs.
- **Advanced probes** — event-loop lag, localhost DNS probe, TCP states, zombie process count, swap pressure, and a diagnostic heap snapshot.

### 2.3 Useful Flags

| Flag | Default | Use it when |
| --- | --- | --- |
| `--timeout-ms <ms>` | `4000` | Probes are timing out too aggressively and you want slow endpoints or shell checks to finish |
| `--sample-ms <ms>` | `1000` | CPU or I/O spikes are brief and you want a wider one-window process sample |
| `--trend-ms <ms>` | `180000` | You want a longer or shorter observation window; use `0` to disable the trend entirely |
| `--trend-interval-ms <ms>` | `1000` | You want finer or coarser trend granularity |
| `--ticket-path <path>` | none | You want runtime sizing focused on one ticket; pass a `.ticket` dir, its `runtime` dir, or the worktree root |
| `--backend-port`, `--frontend-port`, `--opencode-url` | auto-detect when possible | You started the stack on non-default ports or against a non-default OpenCode server |
| `--no-color` | off | You are piping the report or running in CI; `NO_COLOR` is also respected |
| `--help` | off | You want the built-in usage summary of all flags without running a diagnostic pass |

Examples:

```bash
npm run diagnose:stall -- --timeout-ms 8000
npm run diagnose:stall -- --sample-ms 5000
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
npm run diagnose:stall -- --ticket-path /path/to/worktree/.ticket
npm run diagnose:stall -- --backend-port 3001 --frontend-port 5175 --opencode-url http://127.0.0.1:4097
```

### 2.4 Reading the Report

The top-level sections map directly to the report banners:

- **🔍 ENVIRONMENT & CONFIGURATION** — resolved ports, detected PIDs, backend env vars, shell latency baseline, and focused ticket path resolution.
- **🌐 NETWORK & ENDPOINT HEALTH** — current HTTP probe results for frontend, backend, ticket/project routes, startup status, and OpenCode.
- **🔁 REPEATED RUNTIME SAMPLES** — repeated backend/ticket probes plus the longer `Runtime Observation Trend` output.
- **⚙️ APPLICATION PROCESS ACTIVITY** — backend/frontend/OpenCode candidate processes, memory snapshots, open files, and per-process CPU / I/O samples.
- **💻 SYSTEM RESOURCES** — pressure, memory, uptime, and whole-system top CPU / RSS / read / write consumers.
- **💾 STORAGE, MOUNTS & FILESYSTEM** — mount details, disk and inode usage, filesystem latency, and optional focused ticket-runtime sizing.
- **🗄️ DATABASE & PROJECT STATE** — app DB pathing, project DB/WAL state, recent ticket/session state, and execution-log tailing.
- **🔀 GIT RESPONSIVENESS** — `git status`, Trace2 perf output, branch resolution, and other responsiveness checks for attached repos.
- **🧬 ADVANCED DIAGNOSTICS** — event-loop lag, DNS, TCP state counts, zombie counts, swap pressure, and diagnostic heap output.

For intermittent issues, save at least one report from a healthy moment and one from a slow moment. The diff between the two is usually more useful than either report alone.

## 3. Blocked-Error Diagnostics

When a phase fails hard enough to enter `BLOCKED_ERROR`, LoopTroop persists a normalized diagnostic payload alongside the error occurrence. The workspace summary immediately names the failed phase, shows a bounded first line of the captured error, and explains the available recovery actions. The complete message and diagnostic payload remain in the ticket error view, where the payload is rendered as **Underlying error**. Diagnostics are normalized by `shared/errorDiagnostics.ts` and typically assembled by `server/opencode/blockedErrorDiagnostics.ts`.

Use this surface when the ticket already blocked and you want the reason, not the whole-machine health picture.

Startup artifact recovery distinguishes ordinary orphan content from an
in-progress fallback. An orphan YAML temp without its matching proof, or a torn
whole-file JSONL temp, is warned about and left unpromoted; append logs alone
may receive bounded trailing-line repair. `RECOVERY_BLOCKED` is raised only
when an in-progress fallback's `.recovery` ownership or completeness cannot be
verified, before rebuilding projections, hydrating ticket actors, or starting
execution timers. The affected files and diagnostic remain available at that
blocking point. This process-level startup failure occurs before ticket actors
exist, so it does not create a `BLOCKED_ERROR` ticket occurrence or expose
ticket Retry, Continue, or Cancel actions.

#### Coding and integration recovery safeguards

> [!NOTE]
> **Current behavior.** The conditional step-cap and Git-hook recovery
> safeguards in this subsection describe the current implementation.

When `CODING` reports an OpenCode step-cap restore conflict, LoopTroop keeps the
edited root `opencode.json` and `.ticket/opencode-steps-restore.json` available
for review. It refuses a destructive reset only when the current bytes conflict
with valid marker evidence. Ordinary capped retries continue normally. A later
bead may continue without a fresh cap when no reset is needed, and the valid
marker keeps the root config out of bead and final staging. If the sidecar is
missing after a restart, ownership cannot be proved, so LoopTroop does not guess.

During `INTEGRATING_CHANGES`, protected explicit hook validation can refuse
reentry when an interrupted restore cannot safely account for unknown untracked
additions. The persisted marker binds the worktree and Git directory as well as
the index/worktree trees and initial untracked set. Invalid or escaped markers
fail before recovery writes. Unknown additions remain intact until their
attribution is resolved. Normal integration still follows the selected hook
policy; this guard does not claim that unrelated hook commands are harmless or
fully transactional.

#### Approval-save and draft diagnostics

> [!NOTE]
> **Current behavior.** The approval-save baseline checks, retained drafts,
> and best-effort leaving flush described in this subsection are current.

Approval panes retain the content hash loaded with a dirty interview or PRD
draft. A missing baseline is reported as HTTP `428`; a stale baseline is a
typed HTTP `409` conflict. The server checks that precondition for both raw and
structured saves before changing the authoritative artifact. A competing
post-approval writer can also receive `409` before restart or invalidation, so
the right recovery is to reload or retry the current draft rather than assume
both saves were accepted.

If a pane leaves or the selected ticket changes, its UI-state flush is
best-effort. A failed keepalive/beacon leaves the newest draft visibly
unsaved/error for the existing retry path. A completed GET may remember the
remote revision while retaining that unconfirmed local payload; it must not be
read as proof that the browser unload delivered the save.

#### Configuration, project, and prompt form diagnostics

> [!NOTE]
> **Current behavior.** Form dirty-state and preview handling described in
> this subsection are current client behavior.

Form close warnings compare actual current values with the saved or initial
snapshot, including custom model/profile controls; typing and then restoring a
value clears the warning. Hydration or a background refetch does not replace a
draft already being edited. Model catalog loading and errors are announced,
folder-check failures remain distinct from a genuine non-Git directory and can
be retried, and prompt preview errors belong only to the current prompt and
draft. A stale preview response is ignored rather than displayed as current.

#### Remote-stop uncertainty and ownership recovery

> [!NOTE]
> **Current behavior.** Confirmed-stop handling, marker replay, and the
> two-storage restart limit in this subsection describe the current implementation.

An abort request that returns false, throws, or cannot be verified is not proof
that OpenCode stopped. The ticket stays retryable, and the session ownership
remains visible so Retry or a later reconciliation can try again. Project
SQLite ownership normally has a ticket-contained fallback marker at
`.ticket/runtime/opencode-pending-sessions.json`, which startup can replay even
when the database row is missing. If both SQLite and marker storage are
unavailable, only the current process guard remains. A restart cannot claim
recovery in that case.

### 3.1 OpenCode Provider Error Enrichment

OpenCode sometimes streams only `Provider returned error` even though its local log contains the exact provider failure. LoopTroop best-effort correlates those generic stream errors with recent OpenCode log files by `session.id` and replaces the generic summary with a sanitized provider summary when a match exists. The diagnostic reader considers the ten newest candidate files and at most 5 MiB from each by default; complete DEBUG/history reads use a separate uncapped path.

The enrichment keeps only compact diagnostic fields such as HTTP status, retryability, provider/model identity, request model, provider error type/title/message, and a short response-body preview. It does **not** persist prompt bodies, raw request payloads, headers, cookies, authorization values, or URL query strings.

- Managed local OpenCode: LoopTroop checks the default local OpenCode log directory.
- External or nonstandard OpenCode: set `LOOPTROOP_OPENCODE_LOG_DIR` to the log directory.
- No matching log found: the ticket keeps the generic provider error and adds a troubleshooting hint instead of inventing details.

### 3.2 Diagnostic Classification

Each blocked-error diagnostic has a normalized `kind` and `source`.

**Kind** (`BlockedErrorDiagnosticKind`)

| Kind | Meaning |
| --- | --- |
| `model_output_truncated` | OpenCode reported a finish reason such as `length`, so the model response was cut off |
| `opencode_provider` | The provider returned an API-style failure such as auth, quota, rate limit, or invalid request |
| `opencode_session` | Session creation, reconnect, or session-level lifecycle failure |
| `timeout` | A prompt or execution deadline was exceeded |
| `transport` | Connection reset, DNS, socket, or other transport failure |
| `runtime` | Internal LoopTroop runtime or orchestration failure |
| `unknown` | The failure could not be classified |

**Source** (`BlockedErrorDiagnosticSource`)

| Source | Meaning |
| --- | --- |
| `opencode` | Originated from the OpenCode integration layer |
| `provider` | Originated from the underlying model provider |
| `system` | Originated from a LoopTroop system-level source |
| `runtime` | Originated from a runtime execution error |

In the main OpenCode blocked-error builder, provider-like failures are currently emitted with source `provider`; the other generated OpenCode failure kinds use source `opencode`.

### 3.3 Sensitive Data Redaction

Before persistence, `normalizeBlockedErrorDiagnostics()` sanitizes string fields:

- API keys, bearer tokens, passwords, and similar secrets are replaced with `[redacted]`.
- Query strings are stripped from error text so token-like values in URLs are not persisted.
- The redacted payload still keeps enough structure to debug the issue: status codes, provider/model identity, finish reason, and token counts survive when present.

### 3.4 Persisted Fields

The normalized blocked-error payload may include:

| Field | Meaning |
| --- | --- |
| `summary` | Required short explanation shown in the UI when it differs from the primary ticket error |
| `modelId` | LoopTroop/OpenCode model identifier used for the failed run |
| `sessionId` | OpenCode session involved in the failure |
| `providerId` | Provider identifier such as `openai` |
| `providerModelId` | Provider-native model identifier when it differs from the requested model |
| `requestModel` | Exact request model recorded by provider diagnostics |
| `statusCode` | HTTP status code when available |
| `isRetryable` | Whether provider diagnostics marked the failure as retryable |
| `providerErrorType` | Provider error type/classification |
| `providerErrorTitle` | Provider error title or headline |
| `providerErrorMessage` | Redacted provider error message |
| `responseBodyPreview` | Short redacted preview of the provider response body |
| `finishReason` | OpenCode finish reason for truncation-style failures |
| `inputTokens` / `outputTokens` / `reasoningTokens` | Token counts reported by OpenCode |
| `cacheReadTokens` / `cacheWriteTokens` | Token-cache counts when OpenCode exposes them |

The current compact blocked-error panel renders the most actionable subset of those fields. Less common fields, such as `responseBodyPreview` and cache token counts, can still exist in persisted payloads even if that panel does not show them today.

## 4. Structured Retry Diagnostics

Structured retry diagnostics explain **recoverable** structured-output failures. They are normalized by `shared/structuredRetryDiagnostics.ts`, merged into structured-output metadata by `server/structuredOutput/metadata.ts`, and rendered in artifact notices / viewers as **Retry Attempts**.

Use this surface when a phase kept going after rejecting one or more malformed outputs, or when a final failed artifact needs to show exactly why previous attempts were rejected.

### 4.1 What Gets Stored

Each retry entry captures one rejected attempt:

| Field | Meaning |
| --- | --- |
| `attempt` | 1-based retry attempt number |
| `validationError` | Why the parser or validator rejected that attempt |
| `failureClass` | Optional coarse classification such as `validation_error`, `output_truncated`, `empty_response`, `provider_error`, `connection_reset`, `session_protocol_error`, or `transport_error` |
| `target` | Optional target field or schema area that failed |
| `line` / `column` | Optional location for line-oriented parse failures |
| `excerpt` | Best-effort trimmed excerpt from the rejected output |

Malformed retry entries are dropped during normalization, and duplicate retry entries are collapsed so the UI does not show the same failure repeatedly.

### 4.2 Where It Shows Up

Structured retry diagnostics currently surface in artifact-oriented UI rather than the blocked-error panel:

- artifact processing notices
- expanded artifact viewers
- per-owner aggregate vote views when retry metadata exists on contributing artifacts

These diagnostics complement blocked-error diagnostics rather than replacing them:

- **Blocked-error diagnostics** answer "why did the ticket stop?"
- **Structured retry diagnostics** answer "why was this earlier model output rejected before we recovered or finally gave up?"

## Related Docs

- [Operations Guide](operations.md)
- [OpenCode Integration](opencode-integration.md)
- [Output Normalization](output-normalization.md)
