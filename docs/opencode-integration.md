# OpenCode Integration

> [!IMPORTANT]
> **TL;DR** — OpenCode is LoopTroop's only interface to AI models. LoopTroop creates and owns sessions, assembles phase-specific prompt context, applies tool policy, streams and normalizes events, and decides when retries or human recovery are required. It never calls model providers directly.

LoopTroop uses OpenCode as the model-execution layer, but it wraps that layer heavily so ticket state, retries, approvals, and recovery remain durable outside any one model transcript.

LoopTroop detects the authenticated OpenCode server protocol and uses the matching live transport. v1 keeps its SDK transport; v2 uses LoopTroop's runtime HTTP transport and adds no OpenCode SDK dependency. The in-process mock adapter is available for tests and offline development.

> [!NOTE]
> **Current behavior.** The step-cap/root-configuration recovery in §6.1
> and the durable ownership, marker fallback, and restart limits described below
> are current. A conflicting marker can refuse destructive recovery; a missing
> marker after restart does not provide ownership evidence.

## 1. Core Modules

| Area | Modules | Responsibility |
| --- | --- | --- |
| Adapter bootstrap | `server/opencode/adapter.ts`, `connection.ts`, `v1Transport.ts`, `v2Transport.ts`, `factory.ts`, `mockAdapter.ts`, `runtimeConfig.ts`, `types.ts` | Detect the authenticated server protocol, resolve the base URL, apply auth headers, and expose the typed OpenCode surface |
| Session lifecycle | `server/opencode/sessionCreation.ts`, `sessionManager.ts`, `sessionContinuation.ts`, `permissions.ts` | Retry session creation, persist ownership in the project DB, manage reconnect/completion/abandonment, and decide whether Continue may reuse a preserved session |
| Prompt execution | `server/opencode/contextBuilder.ts`, `toolPolicy.ts`, `assistantMessageAnalysis.ts`, `server/workflow/runOpenCodePrompt.ts` | Build phase context, apply tool restrictions, stream prompt events, reconcile streamed output with durable assistant messages, and produce attempt metadata |
| Catalog and selection | `server/opencode/providerCatalog.ts`, `modelValidation.ts` | Discover OpenCode models, normalize provider-catalog responses, and validate saved model selections against connected providers |
| Diagnostics and recovery | `server/opencode/retryPolicy.ts`, `errorDetails.ts`, `blockedErrorDiagnostics.ts`, `logDiagnostics.ts` | Classify retryable interruptions, sanitize provider errors, enrich generic failures from local OpenCode logs, and surface blocked-error diagnostics to the UI |

> [!NOTE]
> **Current behavior.** The browser model-picker announcements described
> below are current client behavior.

The browser's `ModelPicker` keeps the committed model separate from the
keyboard-active option: `aria-selected` names the saved selection and
`aria-activedescendant` follows movement until the user commits a choice.
Loading and catalog failures are announced as status or alert content rather
than being presented as an empty provider list.

## 2. Adapter Surface

The `OpenCodeAdapter` interface currently exposes:

| Method | Purpose |
| --- | --- |
| `createSession()` | Create a new OpenCode session for a project path |
| `promptSession()` | Send prompt parts into an existing session |
| `getSession()` | Verify and read one remote session by exact id |
| `listSessions()` | Enumerate remote sessions |
| `getSessionMessages()` | Read session message history |
| `subscribeToEvents()` | Stream OpenCode events |
| `listPendingQuestions()` | Read pending human-input requests |
| `replyQuestion()` | Answer a pending request |
| `rejectQuestion()` | Reject a pending request |
| `abortSession()` | Abort a remote session |
| `assembleBeadContext()` | Build bead-context prompt parts |
| `assembleCouncilContext()` | Build council prompt parts |
| `checkHealth()` | Health and availability check |

`getOpenCodeAdapter()` returns a singleton. In live mode it detects OpenCode v1 or v2 from the authenticated server API. v2 uses LoopTroop's HTTP transport; v1 uses the retained `@opencode-ai/sdk` transport. Mock mode returns `MockOpenCodeAdapter`, which also supplies a mock health result and provider catalog for the rest of the app.

Requests use Basic auth when a nonblank password is configured. v2 fixes the username to `opencode`; it uses `OPENCODE_PASSWORD` when that variable is nonblank, otherwise `OPENCODE_SERVER_PASSWORD`, preserving the supplied v2 password exactly. v1 uses `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`, with `opencode` as the default username. Prompt dispatch passes OpenCode options such as `model`, `agent`, and `variant`. Tool access is controlled by LoopTroop's ordered session permission policy immediately before dispatch.

Session creation, exact session lookup, session listing, and message reads accept `AbortSignal`s and are wrapped with bounded transport-operation timeouts. Session creation also runs through a shared retry wrapper: after the initial failure, LoopTroop waits 1 s, 3 s, and 7 s before the three retry attempts. Each failed create attempt collects lightweight OpenCode health diagnostics, but the health probe is diagnostic-only and never replaces the actual session-create result.

LoopTroop creates sessions with a session-scoped allow-all permission rule, then refreshes the complete policy before every prompt so reused sessions cannot retain a previous phase's restrictions. If the connected OpenCode server is too old to support session-scoped permissions, session creation or policy application fails with an explicit upgrade message instead of silently degrading behavior.

## 3. Base URL And Modes

| Setting | Meaning |
| --- | --- |
| `LOOPTROOP_OPENCODE_BASE_URL` | Base URL for the OpenCode server; defaults to `http://127.0.0.1:4096` |
| `LOOPTROOP_OPENCODE_MODE=mock` | Use the mock adapter instead of a live OpenCode transport |
| `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` | Do not override the OpenCode server permission mode during `npm run dev`; by default LoopTroop starts its managed OpenCode server with `OPENCODE_PERMISSION='"allow"'` |
| `LOOPTROOP_OPENCODE_LOGS=all` | Direct watcher fallback that starts managed OpenCode with `--print-logs --log-level DEBUG` when `npm run dev:opencode` actually launches the server |
| `LOOPTROOP_OPENCODE_LOG_DIR` | Optional OpenCode log directory used to enrich generic provider errors from an external or nonstandard OpenCode server |
| `OPENCODE_PASSWORD` | v2 Basic auth password; takes precedence when nonblank and is passed exactly as provided |
| `OPENCODE_SERVER_USERNAME` | v1 Basic auth username; defaults to `opencode`. v2 always uses `opencode` |
| `OPENCODE_SERVER_PASSWORD` | v1 Basic auth password and v2 fallback when `OPENCODE_PASSWORD` is blank or unset |

The LoopTroop backend and a managed OpenCode child share credentials. When neither password variable has a nonblank value, the managed child gets an ephemeral password; a nonblank password is preserved. For an external server, configure credentials that match that server. Set `OPENCODE_PASSWORD` for v2, or `OPENCODE_SERVER_PASSWORD` and optionally `OPENCODE_SERVER_USERNAME` for v1.

LoopTroop does not require a major-version change. It detects the running v1 or v2 server automatically and uses the matching API.

Base-URL resolution depends on the mode:

- **Loopback URL:** `npm run dev` probes the configured address first. If OpenCode is already responding there, LoopTroop reuses that instance.
- **Default local URL with a conflicting process:** if another process occupies the default OpenCode port, or the server rejects the configured credentials, `npm run dev` scans for the next free port and starts managed OpenCode there instead.
- **Explicit local URL:** the configured port is treated as authoritative. If another process occupies it, startup asks you to choose another URL. If OpenCode rejects the configured credentials, startup stops with a credential-specific error instead of silently moving to another port.
- **Remote URL:** the launcher treats the server as external and never tries to start or port-shift it.
- **Mock mode:** no network probe happens at all.

### 3.1 The installed daemon supervises OpenCode itself

Everything above describes the development stack. An **installed** LoopTroop does
not rely on `npm run dev` for any of it: `server/opencode/supervisor.ts` runs
inside the daemon and resolves one of four states at startup, before the daemon
binds its port.

| State | When | What the daemon does |
| --- | --- | --- |
| **adopted** | Something is already answering at the configured base URL | Uses it, and never tries to start or stop it |
| **managed** | Nothing is answering, but the `opencode` CLI is on PATH | Starts `opencode serve` in its own process group, restarts it if it crashes, and stops it when the daemon stops |
| **mock** | `LOOPTROOP_OPENCODE_MODE=mock` | Skips OpenCode entirely — enough to look around the interface, not to run a ticket |
| **degraded** | Neither reachable nor launchable | The daemon refuses to start, rather than serving an interface that cannot run a single coding operation |

Restarts are bounded at three consecutive attempts; after that the supervisor
reports the state rather than restarting forever.
`looptroop doctor` names which of the four applies, and
`looptroop status` repeats it.

This is why an installed user is never told to run `opencode serve` by hand — see
the [Operations Guide](operations.md#opencode-is-managed-for-you).

## 4. OpenCode Configuration Pass-Through

LoopTroop sends work through your OpenCode server rather than replacing OpenCode's provider layer. Configure provider credentials, model availability and agent settings in OpenCode's native configuration; LoopTroop selects from the models the authenticated server reports.

OpenCode v2 uses its native `providers` and `agents` config sections. LoopTroop
preserves those fields and applies v2 settings there; v1 remains supported with
its v1 schema.

| Layer | Owned by | Notes |
| --- | --- | --- |
| Provider credentials, MCP tools, skills, and server configuration | OpenCode | Whatever you configured in OpenCode remains available to LoopTroop sessions |
| Session ownership, prompt assembly, timeout/retry policy, blocked-error routing, question APIs, and ticket-log projection | LoopTroop | This is the orchestration layer that makes OpenCode durable inside the ticket workflow |

For full local OpenCode DEBUG logs in your terminal, run `npm run dev --opencode-logs=all`. The launcher maps that opt-in to OpenCode's documented [`--print-logs` and `--log-level DEBUG` CLI flags](https://opencode.ai/docs/cli/) for [`opencode serve`](https://opencode.ai/docs/server/) and propagates `LOOPTROOP_OPENCODE_LOGS=all` to the watcher. This only changes logging for an OpenCode server that LoopTroop starts itself; reused, remote, or mock servers keep their own logging configuration. OpenCode's [troubleshooting docs](https://opencode.ai/docs/troubleshooting/) describe DEBUG logs as detailed diagnostic output; treat them as sensitive local data because they may contain request or provider details.

When OpenCode emits only a generic `Provider returned error` stream event, LoopTroop best-effort scans the newest local OpenCode log files for the same `session.id` and surfaces the exact provider cause in the ticket log and blocked-error diagnostics. The enrichment keeps compact fields only: HTTP status, retryability, OpenCode provider/model, request model, provider error type/title/message, and a short response-body preview. It discards prompt bodies, raw request payloads, headers, cookies, authorization values, and URL query strings before persisting anything. By default it reads OpenCode's documented local log directory; set `LOOPTROOP_OPENCODE_LOG_DIR` when LoopTroop is attached to an external server with logs stored elsewhere.

> [!NOTE]
> **Current behavior.** Complete `DEBUG` history and export use all
> available native OpenCode history, while provider-error enrichment remains a
> bounded diagnostic read of ten candidate files at 5 MiB per file. The two
> paths do not share a limit. Complete reads surface metadata, read, and index
> failures; diagnostic enrichment remains best effort.

The complete history path is loaded only for an explicit history action. It
uses incremental native index ranges, scans a needed prefix for a cold or
unseen session, and keeps stable file/line identities through JSON
serialization. Four recent native snapshots keep cursors stable across append
and rotation; an expired cursor returns `LOG_CURSOR_EXPIRED` rather than a
partial page. Native page materialization is bounded by the requested `LIMIT`,
but lineage visibility work grows with ancestry depth, and upstream-deleted
files cannot be recovered.

For trusted local LoopTroop sessions, the managed OpenCode server is permissive by default: `scripts/dev-opencode.ts` sets `OPENCODE_PERMISSION='"allow"'` when it starts `opencode serve`, unless `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` is set. LoopTroop also applies a complete ordered SDK permission policy to each session immediately before prompting. The unrestricted baseline explicitly allows all actions, `external_directory`, and `doom_loop`, including absolute-path patterns needed by system inspection and temporary tool provisioning; prompt-specific restrictions are appended afterward so read-only, tool-disabled, and web-access policies remain authoritative.

Unexpected permission requests are treated as a headless-runtime compatibility fallback rather than user input. LoopTroop answers each new permission request once, but not every answer is `always`: if the resolved session policy denies that permission, LoopTroop replies with `reject`; otherwise it uses `always` so the unattended prompt can continue. If OpenCode rejects or fails that reply, LoopTroop aborts the session immediately and returns an actionable prompt failure so the workflow's existing retry or blocked-error path can take over instead of appearing idle. These controls remove approval stalls from trusted unattended automation, but they do not bypass normal OS privileges or make passworded `sudo` a dependency of setup.

### 4.1 Tool Policy Layer

Prompt templates choose from four OpenCode tool policies:

| Policy | Effect |
| --- | --- |
| `default` | Leaves the normal OpenCode tool surface intact, but forces `webfetch` and `websearch` off |
| `disabled` | Explicitly disables all tools for prompts that should be pure reasoning/structured output |
| `read_only` | Allows only read-style tools (`codesearch`, `glob`, `grep`, `list`, `lsp`, `read`) |
| `execution_setup_online` | Re-enables `webfetch` and `websearch` for setup prompts that may need official installer or launcher lookup |

That policy layer is resolved into a complete ordered session permission ruleset and applied at the `runOpenCodePrompt()` / `runOpenCodeSessionPrompt()` boundary before each prompt. Explicit restrictions follow the permissive baseline and therefore win for read-only and tool-disabled phases. For the prompt-to-policy mapping, see [Prompt Inventory](prompts.md).

The `question` tool is the one exception to the table above: none of the four policies decides it any more. It is set from the ticket's AI-questions setting, except under `disabled`, which never asks whatever the setting says. See [Who May Ask](#_9-1-who-may-ask).

Planning prompts that can make or preserve repository-specific claims use `read_only` selectively: they review their supplied context first and inspect the repository only when they need concrete evidence. This covers Full Answers, PRD and beads drafting, refinement, and coverage, plus blueprint expansion and the non-voting interview workflow. Council voting remains tool-disabled; no planning prompt receives shell execution or mutation tools through this policy.

## 5. Session Ownership

LoopTroop does not treat OpenCode sessions as anonymous chat handles. It tracks who owns a session in the project database.

Ownership is keyed by the workflow slot that is allowed to use that session. In practice that means `phase` plus an ownership tuple that can include:

```json
{
  "ticketId": "AUTH-12",
  "phaseAttempt": 1,
  "memberId": null,
  "beadId": "api-refresh-endpoint",
  "iteration": 2,
  "step": null
}
```

This is what lets the backend distinguish:

- one council member's vote session from another
- the first execution attempt for a bead from the second
- a planning session from a coding session on the same ticket

`keepActive` and `forceFresh` are prompt-runner controls layered on top of this ownership model; they are not part of the persisted ownership key itself.

## 6. Prompt Runner

`runOpenCodePrompt()` is the main orchestration helper. It resolves session ownership, timeout budget, tool policy, and prompt dispatch in one place.

It currently does the following:

1. Resolve or create the session, retrying session-creation failures before the prompt is sent.
2. If `sessionOwnership` is present, call `SessionManager.validateAndReconnect()` first.
3. Resolve and apply the complete session permission policy for the prompt.
4. Dispatch the prompt with model, agent, variant, and timeout settings.
5. Subscribe to stream events, automatically answering unexpected permission requests once per request ID.
6. Track OpenCode `session.status` retry events against the profile retry budget and grace window.
7. Reconcile the streamed reply with assistant messages and stream status.
8. Mark the session completed, keep it active, or preserve/abandon it depending on the outcome.

`runOpenCodeSessionPrompt()` is the lower-level helper for prompting a known session.

When a prompt has already produced usable streamed text, a failed final
assistant-message read does not discard that completed reply. The runner falls
back to the accumulated stream text, while abort errors still propagate so a
cancelled prompt cannot look successful.

Retry-status handling is driven by OpenCode stream events, not only by log text. The runner watches `session.status` retry events across OpenCode-backed phases and treats matching rate-limit, usage-limit, resource-exhaustion, overload/capacity, temporary-unavailability, timeout/deadline, fetch, network, and socket-reset messages as continuable provider interruptions. The profile's `OpenCode Retry Limit` blocks after a configured number of matching retry events, and `OpenCode Retry Grace Window` blocks when a matching retry state produces no progress for the configured window. A zero retry limit blocks on the first matching retry event; a zero grace window disables the timer.

When a ticket is blocked by a resumable OpenCode/provider interruption, the prompt runner can preserve the active owned session instead of abandoning it. Eligible interruptions include retryable diagnostics, HTTP 402/408/429/500/502/503/504/529, rate or usage limits, overload/capacity messages, timeouts, and transport failures. `HTTP 402 Payment Required` is treated as externally clearable, so Continue can resume the same session after payment or workspace access is restored. Auth, invalid request, request-size, permission, missing API key, model-not-found, and non-402 insufficient-quota signals remain non-continuable.

CODING also carries the latest meaningful OpenCode retry/session/output-limit diagnostic forward when a bead later blocks for completion-marker or bead retry-budget reasons, so the Error view can show the underlying provider/session cause alongside the bead wrapper failure.

When a pending continuation exists for the preserved session, the next owned prompt body is replaced with exactly:

```text
continue please
```

Continue does not archive the active phase attempt or create a fresh attempt. Retry still keeps the fresh-attempt behavior.

### 6.1 OpenCode Step Caps And Root Configuration

When `OpenCode Max Steps` is greater than zero, LoopTroop merges the cap into
the root `opencode.json` and writes `.ticket/opencode-steps-restore.json` before
the change. It uses `agent` for v1 and `agents` for v2, preserving the other
configuration fields. The sidecar holds the exact pre-run bytes, including the
`absent` case when LoopTroop created the file. A valid marker keeps the
temporary root config out of bead and final candidate staging without adding a
common Git exclude rule.

Ordinary capped runs reset and retry normally. If the current config conflicts
with the marker, LoopTroop preserves the edited bytes and sidecar and refuses a
destructive reset or recovery that would overwrite them. A later bead can run
without applying a fresh cap when no reset is needed. If the sidecar is missing
after a restart, there is no durable ownership evidence, so LoopTroop leaves the
file alone rather than guessing. Filesystem-equivalent casing follows actual
worktree paths; native Windows/macOS equivalent-case behavior is not claimed.

### 6.2 Session Reuse Controls

| Control | Effect |
| --- | --- |
| `keepActive` | Leaves the owned session active after a successful prompt so a later prompt in the same workflow slot can reuse it |
| `forceFresh` | Requests a remote abort and abandons the currently owned active session only after that stop is confirmed; an unconfirmed stop keeps ownership visible and retryable |

These controls are what let multi-turn phases reuse a durable session when appropriate, while still allowing hard resets for flows that must discard the old transcript.

Session creation records ownership in the project database before it relies on
the remote session. If that write is unavailable, LoopTroop records a
ticket-contained marker at `.ticket/runtime/opencode-pending-sessions.json`
before compensating the remote session. Startup consumes the marker even when
the database row is absent. If both SQLite and marker storage are unavailable,
only the current process guard remains, so a restart cannot prove recovery.

## 7. Reconnect Behavior

Reconnect is intentionally conservative.

`SessionManager.validateAndReconnect()` only succeeds when:

- the ticket still exists
- the ticket is still in the same phase, or is in `BLOCKED_ERROR` with an unresolved centrally classified continuation whose `previousStatus`, blocked-from phase, and diagnostic session id exactly match the owned session
- the owned active session record still exists in the project DB
- the same session still exists remotely in OpenCode

Startup resolves ticket ownership from the project database and any
ticket-contained marker in the project currently being reconciled, because
local numeric ticket ids may repeat across projects. It then classifies exact
verification as reconnected, confirmed missing, stale ownership, or temporarily
unverified. Confirmed missing and stale records are abandoned; timeouts,
transport failures, and OpenCode 5xx responses preserve the active record for a
later check.

When the database record or ticket marker is available and the exact ownership
checks still match, LoopTroop can recover an eligible session after restart. It
does not promise restart recovery when both ownership stores are unavailable,
and it does not try to magically continue any random broken stream from the
past.

If OpenCode cannot verify an exact session because the server is down or restarting, validation fails closed without abandoning the database record. This applies both to active phases and to every resumable `BLOCKED_ERROR` condition accepted by the central continuation classifier, including eligible limits, payment blocks, overloads, timeouts, and transport failures. The prompt runner then either creates a new owned session when OpenCode is reachable or lets the phase fail into the normal retry/block path. Owned same-session reuse is also revalidated immediately before prompting, so a stale session cannot be prompted after the ticket has moved phases.

For Continue, the route performs one extra live check: if the OpenCode server can no longer read the preserved session by exact id, the request returns `409` and leaves the ticket in `BLOCKED_ERROR`.

### 7.1 Session Continuation

`server/opencode/sessionContinuation.ts` manages the eligibility logic for Continue actions. It determines whether a blocked ticket can resume its preserved OpenCode session instead of starting a fresh attempt.

**Eligibility criteria:**

- The ticket must be in `BLOCKED_ERROR` with a known `previousStatus`.
- An active error occurrence with a diagnostic `sessionId` must exist.
- A matching active `opencode_sessions` row must exist for that ticket, previous phase, and session ID.
- The OpenCode server must still have the session addressable by that exact ID.
- The error diagnostics must be of a continuable type (retryable provider errors, HTTP 402/408/429/500/502/503/504/529, rate/usage limits, transport failures, timeout-style interruptions).

Backend, OpenCode, WSL, OS, and machine restarts preserve the same eligibility
when those exact ownership checks and a durable database record or ticket marker
still match. A temporary inability to verify OpenCode leaves the session active
rather than removing Continue permanently; a later read or restart may verify
it again. Only confirmed remote absence or provably stale ownership abandons the
local session record.

**Non-continuable errors:** Auth failures, invalid requests, permission errors, missing API keys, model-not-found, and non-402 insufficient-quota signals are not eligible for Continue.

When all checks pass, the Continue action records a pending continuation keyed by `sessionId`. The next owned session prompt consumes this and sends exactly `continue please` — no context rebuild and no new attempt version.

Blocked execution setup also has a same-session action called **Retry with extra note...**. It uses the same exact session ownership checks, but sends only the user's entered text instead of `continue please`. The action keeps the current runtime phase attempt and allows one manual setup attempt beyond the automatic retry budget. It does not add the text to future setup context. Coding uses its existing fresh-bead recovery path for the button with the same label.

## 8. Streaming

OpenCode stream events are consumed server-side and then translated into LoopTroop's own ticket event model.

The v1 SDK and v2 HTTP transports consume OpenCode's event stream and filter events to the owned session before emitting LoopTroop events. This keeps unrelated project/session events out of the ticket log.

OpenCode v2 does not persist bus history by default. If an event-stream interruption leaves LoopTroop unable to prove that it saw the complete event sequence for a prompt, the prompt fails with an interruption diagnostic. LoopTroop does not resubmit a prompt with an uncertain result.

Events without an explicit session ID are not assigned to a per-session stream,
and events naming a different session are omitted. A directory-only or global
event therefore cannot appear to belong to the active ticket by inference.

LoopTroop ships a project-level OpenCode plugin at `.opencode/plugins/looptroop-listener-limit.js` that raises the Node/Bun EventTarget listener warning threshold to 20 inside the OpenCode process. This only changes the warning threshold for legitimate parallel stream listeners; it does not create a hard concurrency limit or replace stream cleanup.

The prompt runner tracks:

- text events
- reasoning events
- tool events
- step start and finish events
- session status events, including retry budget/grace-window detection
- session error events
- question events that contribute to ticket-side recovery or UI prompts
- permission requests that are deduplicated and answered automatically for unattended execution, with an immediate session abort if the reply fails

The runner also backfills finalized assistant message parts from the current prompt segment of `session.messages()` after completion so thinking, intermediate assistant narration, tool activity, and terminal output are durable even if no browser was watching in real time. It never treats older messages from a reused session as new activity. Intermediate text is logged as an `ASSISTANT` Other event and the final response remains `OUTPUT`, both keyed by stable session/message identities.

Each newly completed assistant message also produces one idempotent AI-turn metrics row. OpenCode step-finish data supplies cost and input/output/reasoning/cache tokens; assistant timestamps supply duration; message provenance supplies the actual model and variant. Persistence and SSE invalidation are best-effort diagnostics and cannot fail the workflow. Collection is forward-only and does not scan historical OpenCode sessions.

Tool normalization retains reported elapsed time, compaction time, and attachment filename/MIME metadata while discarding attachment payloads. `session.status.action` recovery metadata is sanitized into an error event; unsafe non-HTTP(S) links are discarded before persistence.

The adapter keeps a short step-finish safety window near prompt deadlines so terminal finish metadata still has a chance to arrive before the stream is treated as done.

Step-finish metadata is also used for blocked-error diagnostics. If OpenCode reports a finish reason such as `length`, LoopTroop records the failure as model output truncation, carries through token counts when available, and explains that subsequent structured-output validation errors may be secondary symptoms of an incomplete response.

The frontend never talks directly to OpenCode. It receives normalized ticket events over `/api/stream`.

Terminal completion, abandonment, or confirmed abort releases the session's
directory mapping. A successful abort is not cached by session ID; each later
abort request must obtain fresh remote confirmation.

## 9. Questions And Human Input

OpenCode's `question` tool may stop a run and ask the operator something. LoopTroop exposes that queue through:

- `GET /api/opencode/questions`
- `GET /api/tickets/:id/opencode/questions`
- `POST /api/tickets/:id/opencode/questions/:requestId/reply`
- `POST /api/tickets/:id/opencode/questions/:requestId/reject`
- `POST /api/tickets/:id/opencode/question-timer/stop`

The per-ticket route filters the global OpenCode question queue down to active sessions that LoopTroop currently owns for that ticket. Reply/reject actions emit deduplicated question lifecycle log entries and `needs_input` SSE updates, so the browser can remove resolved prompts without polling OpenCode directly.

Question forms show OpenCode's labels and submit each selected choice's wire
value. When a choice has no separate value, LoopTroop submits its label.

### 9.1 Who May Ask

Whether a prompt may raise `question` is a setting, not a property of the prompt. `runOpenCodePrompt()` resolves it once at its own boundary, so every retry and same-session continuation is covered by the same answer, and passes it into `resolveOpenCodePermissions()` as a single `question` permission rule. That rule replaces whatever the tool policy said, rather than being appended to it: precedence between a wildcard `{ permission: '*' }` rule and a specific `{ permission: 'question' }` one is not documented, so relying on last-wins would be a guess. The default is deny, so a call site that forgets to opt in fails closed.

Three denials are structural and beat the setting:

- a prompt with no ticket has nobody to ask, which covers the preflight capability probe and ad-hoc calls;
- the interview generates its own questions, and is excluded by workflow group rather than by a hand-written list of statuses;
- the `disabled` tool policy means the step only reformats text it was handed, so it has nothing to investigate.

`default`, `read_only`, and `execution_setup_online` all follow the setting. Before this, `read_only` and `disabled` both carried a hard `question: false`, which is why only five prompts could ever ask regardless of configuration. The resolved rule sets are cached per `(policy, allowed)` pair, and the four "asking is off" variants are exported as `SILENT_*_PERMISSIONS` so tests assert against what is actually sent rather than against the policy tables.

See [Configuration → AI Questions](configuration.md#ai-questions) for the profile/project/ticket cascade and the ticket-start lock.

### 9.2 The Wait

A question that nobody answers is an unbounded stop, so `server/workflow/questionWindows.ts` gives every one an end. The countdown is per `(ticket, phase, attempt)` and shared by every model asking inside that step. It is deliberately coarser than a question and coarser than a request: OpenCode's reply carries every answer in one payload, so expiring a single question would discard answers already given to its siblings, and a council seats several models in one step. A new model asking resets a running clock to full; a stopped clock never restarts.

Any human interaction stops the clock permanently through `POST /api/tickets/:id/opencode/question-timer/stop`. Switching model tabs, moving between questions, focusing an answer field, and pressing **Stop timer** all funnel to that one call, which is idempotent and returns the current state rather than an error on a repeat.

Question listing, reply, and rejection resolve the session directory from the
trusted stored ownership record. A caller-supplied project path cannot redirect
those operations to another workspace, and a missing stored directory fails
closed rather than guessing.

Waiting does not consume the step's working time. Attaching a request suspends every work budget on the ticket through `server/workflow/workBudget.ts`, and resolving it credits the elapsed wall time back. The ledger is ticket-scoped rather than session-scoped because there is no single clock to key: PRD drafting runs two prompts in two sessions under one deadline, the council drafter and voter own `Promise.race` timers that never see the prompt timer, and execution had its own copy of the remaining-time helper. Suspension is reference-counted, so a step with two questions outstanding stays held until the second is dealt with.

> [!NOTE]
> **Current behavior.** Question expiry, successful remote rejection,
> fallback abort, persisted timer restoration, and retryable ownership in this
> subsection describe the current implementation.

Live timer state lives in memory; the durable copy is written to phase artifacts under the `opencode_question:` and `opencode_question_timer:` prefixes. On expiry, LoopTroop tries remote rejection with up to three attempts. A successful remote rejection clears the question and does not abort the surrounding session. If rejection fails, LoopTroop uses the fallback abort; only when both rejection and fallback abort fail does the pending record and ownership stay visible for retry. A local abort or transport failure that returns false, throws, or cannot be verified is not proof that the remote session stopped. Each rejection writes a skip receipt naming the actor (`timeout` for the wait running out, `user` for a manual skip, `system` for a confirmed lost session), the configured window, the elapsed time, and the sibling requests the same expiry covered.

On startup, `reconcilePendingQuestionsAfterRestart()` runs once per project against a session-to-ticket ownership map covering the whole project, because `listPendingQuestions()` answers per project: reconciling ticket by ticket would show each pass its siblings' questions as ownerless, and a ticket whose sessions had all been abandoned would never be visited at all. A question whose session reconnected is rebuilt from its `opencode_question_timer:` artifact, which is authoritative: `stoppedAt` survives, a live deadline keeps its remaining time, and a deadline already past fires as soon as it is armed. If the session cannot be reattached and neither remote rejection nor fallback abort can be confirmed, the question stays visible for retry rather than being treated as stopped.

## 10. Health And Model Discovery

LoopTroop uses related but distinct OpenCode probes:

| Surface | Backing code | Purpose |
| --- | --- | --- |
| `adapter.checkHealth()` and `GET /api/health/opencode` | `server/opencode/adapter.ts`, `server/routes/health.ts` | Authenticated reachability, detected protocol/version, and a lightweight model list |
| `GET /api/models` | `server/opencode/providerCatalog.ts`, `server/routes/models.ts` | Fetch currently available providers and enabled models; `?scope=all` asks for a broader list when the protocol supports one |
| `POST /api/models/refresh` | `server/opencode/providerCatalog.ts`, `server/routes/models.ts` | Reload OpenCode's model data and return its current available-model view |

For v1, provider discovery tries `/provider` and falls back to `/config/providers`; it can return a broader catalog for `scope=all`. For v2, LoopTroop reads OpenCode's available-provider and model endpoints. It shows only the providers the server reports as available and their enabled models. The v2 API does not expose disconnected providers, so `scope=all` returns the same list and the response sets `catalogScope` to `available`.

Model metadata is kept as OpenCode reports it. Unknown price, reasoning, tool-use, or image-support fields stay `null`; LoopTroop does not infer those values. The canonical `id` is used in selections, while `modelID` retains the provider-facing identifier when available. v2 variants are normalized for the existing picker.

If model discovery fails but health still passes, the API returns empty model arrays plus a message instead of crashing the UI. The frontend treats that startup message as retriable so model selectors can recover automatically while OpenCode is still coming up.

The Configuration model pickers show currently available models by default. Protocols that provide a broader catalog expose **Show all providers**. The v2 server does not, because it only returns currently available providers and enabled models. A v1 full-catalog failure does not replace the connected-model result already loaded.

The Configuration reload button uses `POST /api/models/refresh` after provider credentials change. It calls the protocol-specific OpenCode catalog-refresh endpoint and then fetches updated data with the same Basic authentication. It does not restart `opencode serve` or dispose the separate worktree instances owned by active ticket sessions. A refresh or subsequent catalog-fetch failure is surfaced instead of returning a catalog known to be stale.

When `LOOPTROOP_OPENCODE_MODE=mock`, health and model discovery come from in-process mock data rather than network calls. The refresh route returns that mock catalog without a network request.

## 11. Question Log Fingerprinting

LoopTroop uses deterministic fingerprinting to track OpenCode question lifecycle events across log entries. The system is implemented in `shared/logIdentity.ts`.

### 11.1 Why Fingerprinting

OpenCode questions produce multiple log entries: when a question is asked, replied to, rejected, or when a reply or rejection fails. Without a stable identity, the same question could appear multiple times in log views and deduplication would be unreliable.

### 11.2 How It Works

`buildOpenCodeQuestionLogIdentity()` builds a stable identity from the session ID, the request ID, and the action (`asked`, `replied`, `rejected`, `reply_failed`, `reject_failed`). Both values are plain composed strings, not hashes:

- **`entryId`** — `<sessionId>:question:<requestId>:<action>`, falling back to `opencode-question:<requestId>:<action>` when no session is known. The same question and action always produce the same `entryId`.
- **`fingerprint`** — `opencode-question:<sessionId>:<requestId>:<action>`, with `no-session` standing in for a missing session.

Both carry the action, so the fingerprint identifies one stage of one question rather than the question as a whole. That is what the dedupe needs: the same pending question observed twice produces the same identity and is written once, while the later reply or rejection is a different identity and is written as its own entry.

### 11.3 Usage

`extractLogFingerprint()` reads the fingerprint from a log record's metadata. `hasMatchingLogFingerprint()` compares fingerprints across records to detect duplicate or related entries.

The fingerprinting system is used by the OpenCode question polling loop and the execution-log pipeline to prevent duplicate question entries when the same pending question state is observed multiple times.

Fingerprinting says nothing about *why* a question ended. The reject route appends the reason a person typed to its `[QUESTION] AI question skipped.` entry, but a question the wait ran out on has no such entry to carry one. The durable record of who refused a question and why is the skip receipt, which names the actor (`user`, `timeout`, or `system`) along with the window and the elapsed time. Read it through `GET /api/tickets/:id/skips`, not the log.

## 12. Why LoopTroop Wraps OpenCode This Heavily

OpenCode is the model execution engine. LoopTroop adds:

- phase-aware context assembly
- ticket-aware session ownership
- prompt-level tool policy
- durable restart behavior
- workflow-aware retries and blocked-error recovery
- frontend-ready event and question projection

Without that wrapper, the rest of the system would have no safe way to restart, audit, or recover a long-running ticket lifecycle.

## Related Docs

- [Configuration](configuration.md)
- [Operations Guide](operations.md)
- [Prompt Inventory](prompts.md)
- [API Reference](api-reference.md)
- [Beads & Execution](beads.md)
- [Context Engineering](context-engineering.md)
- [System Architecture](system-architecture.md)
