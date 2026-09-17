# API Reference

> [!IMPORTANT]
> **TL;DR** — LoopTroop exposes a local REST API for ticket lifecycle actions, artifact access, settings, and real-time SSE streams. The frontend and external tools use this API — there is no separate internal protocol.

All backend routes are mounted under `/api`.

This page documents the current HTTP surface exposed by `server/index.ts` and the route handlers in `server/routes/*`.

> [!NOTE]
> **Next release behavior.** Remote-mode cookie enforcement, strict Origin
> checks, configured development-origin exceptions, and SSE admission
> reservations described below are upcoming. The installed daemon’s credential
> mechanisms remain unchanged.

## Reaching An Installed Daemon

An installed LoopTroop serves the interface and the API from **one address**,
`http://127.0.0.1:3000` by default. There is no separate API port, and no
cross-origin headers are sent in production — the interface and the API are the
same origin.

### Authenticating

There are two credentials, for two different callers, and they are not
interchangeable:

| Caller | Credential | How it is obtained |
| --- | --- | --- |
| **A browser** | A session cookie | `looptroop open` prints a signed-in link carrying a single-use code in its fragment; the browser exchanges it for the cookie |
| **A script** | `Authorization: Bearer <token>` | The daemon mints a random token at startup and records it in `daemon.json` in the [configuration directory](configuration.md), owner-readable only |

```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/looptroop/daemon.json')))['apiToken'])")
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/projects
```

> [!NOTE]
> `/api/health` is deliberately **not** authenticated on an installed daemon: a
> container health probe holds no credentials, and the response carries nothing
> worth protecting behind a loopback-only bind. It is therefore the one endpoint
> that cannot tell you whether your token works — use a real route like
> `/api/projects` to check a credential.

> [!IMPORTANT]
> **`LOOPTROOP_API_TOKEN` is not this token.** In a container it is what
> *authorises* a non-loopback bind; the token the API accepts is still the one
> the daemon minted and recorded. Reading `daemon.json` is how you get a
> credential that works.

The session cookie is set `HttpOnly` so no script on the page can read it,
`Path=/api` so it is not attached to requests for the static bundle, and
`SameSite=Strict` so another site cannot drive the control API with it. Sessions
last 12 hours.

There is no way to authenticate by query string, including for `EventSource`.
Requests are also restricted to this machine and to this daemon's own address,
so a page served from a different port on the same loopback interface cannot
drive it with a cookie the browser would otherwise attach — cookies carry no
port scope of their own.

### Browser cookies and remote mode

When remote access is explicitly enabled, a request that carries the session
cookie still has to prove same-origin with the daemon's canonical authority.
With an `Origin` header, its scheme, host, and effective port must match the
actual request authority. In local mode, the request Host authority must be
recognized as loopback; Origin parsing rejects non-canonical hostname spellings,
including alternate IPv4 forms, and explicit port `0` is rejected. A request
without `Origin` must carry `Sec-Fetch-Site: same-origin`. Remote opt-in does
not add a new strict Host-name validator to requests without an Origin, and
explicit configured development origins retain their configured scheme and
authority. A bearer-only script request that has no session cookie remains valid
without that browser header. An invalid bearer header does not turn a
cookie-bearing request into bearer-only authentication, and forwarded host
headers do not widen the authority check.

The same authentication boundary applies to `/api/stream`. Admission reserves
capacity before the asynchronous stream opens, with six connections per ticket
and 100 connections globally; aborted or failed opens release their reservation
exactly once.

## Conventions

| Convention | Meaning |
| --- | --- |
| Ticket identifiers | Ticket route params such as `:id` and `:ticketId` use the public composite ticket ref `projectId:externalId` (for example `1:AUTH-12`), not the project-local numeric DB id |
| JSON validation | Most write routes validate request bodies with Zod or route-specific parsers |
| Streaming | Live ticket updates use Server-Sent Events from `/api/stream` |
| Error shape | Error responses usually include `error` and sometimes `details` or `message` |
| Content hashes | Human-reviewed artifacts expose lowercase SHA-256 hashes so approval requests can prove which bytes were reviewed |
| Action responses | Most workflow action routes return `message`, `ticketId`, `status`, `state`, and the latest `ticket` snapshot |

Because the public ticket ref contains a colon, callers should URL-encode it whenever it appears in a path or query component. For example, use `/api/tickets/1%3AAUTH-12`, `/api/files/1%3AAUTH-12/logs`, and `/api/stream?ticketId=1%3AAUTH-12`.

> [!IMPORTANT]
> **The paragraph below is the development stack only.** An installed daemon
> uses the credentials in [Reaching An Installed Daemon](#reaching-an-installed-daemon)
> above, and its middleware is a different one with different rules. Do not mix
> the two.

In the development stack (`npm run dev`), when `LOOPTROOP_API_TOKEN` is configured, every `/api/*` route requires either `X-LoopTroop-Token: <token>` or `Authorization: Bearer <token>`. `npm run dev` generates an ephemeral token when needed and keeps it server-side; the Vite dev proxy injects it for same-origin `/api` requests, including `/api/stream`. Query-string authentication is not accepted.

**The installed daemon uses a different authentication path.** Its session middleware accepts a session cookie or a bearer token and nothing else. A same-origin browser `EventSource` sends the session cookie on its own.

The development proxy also preserves the backend's cross-origin protection when the frontend is reached through another same-origin address, such as an HTTPS Tailscale URL. Before proxying to the loopback backend, Vite normalizes the `Origin` header only when the browser marks the request as same-origin and the `Origin` authority exactly matches the incoming frontend `Host`. An `Origin` from an unrelated site stays unchanged, so the backend rejects it with `403`.

Invalid or missing credentials return `401`. If auth is required but no backend token is configured and unauthenticated mode is not allowed, the middleware returns `503`.

API routes use a global per-client rate limit, with separate buckets for read requests, normal write actions, and UI-state autosave writes. The default local-tool budget is 200 reads/minute, 120 normal writes/minute, and 300 autosaves/minute per client. The lightweight `GET /api/health` liveness probe is exempt so reachability checks remain available after the normal read budget is exhausted. On an installed daemon that probe is also unauthenticated; in the development stack the configured token still applies. When another route exceeds its limit, the backend returns `429` with a JSON error body and a `Retry-After` header containing the number of seconds to wait before retrying. Forwarded client IP headers are ignored unless `LOOPTROOP_TRUST_PROXY=1` is set, so local development typically uses a single shared `local` bucket identity.

## Health, Models, Workflow Meta, And Streaming

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Basic process health; exempt from the normal read-rate bucket |
| `GET` | `/api/health/opencode` | OpenCode reachability and version |
| `GET` | `/api/health/startup` | Startup recovery and restore status |
| `GET` | `/api/health/update` | Current/latest release, detected install channel, ordered update steps, and complete latest GitHub release metadata |
| `POST` | `/api/health/startup/restore-notice/dismiss` | Dismiss startup restore notice |
| `GET` | `/api/models` | Models from configured providers; pass `scope=all` to request the full catalog |
| `POST` | `/api/models/refresh` | Refresh the provider catalog now and return the current connected-model view |
| `GET` | `/api/workflow/meta` | Current workflow groups and phases |
| `GET` | `/api/stream?ticketId=<id>` | Ticket-scoped SSE stream using the composite ticket ref; validates the ticket and enforces stream caps |

`POST /api/models/refresh` uses the same payload shape as `GET /api/models`, but always refreshes the provider catalog first and returns the connected-model view rather than the optional `scope=all` catalog.

> [!NOTE]
> **Next release behavior.** While OpenCode is starting, the browser retries
> model discovery only when the response carries the exact startup message
> ``OpenCode server is not reachable. Start it with `opencode serve`.``. Other
> failures, including HTTP 500 responses, keep their existing error and are not
> retried by the model query or its manual refresh.

`/api/stream` accepts an optional replay cursor from either the `Last-Event-ID` header or the `lastEventId` query parameter; the header wins when both are present. It does not accept credentials in the query string. In development, the Vite proxy injects the token header server-side; an installed browser uses its same-origin session cookie. Browsers normally send `Last-Event-ID` automatically only for native reconnects; the frontend persists the last event id per ticket and sends the query value after reloads so the backend can replay buffered events when possible.

Unsafe cursor values fail the request before the stream opens: control characters or values longer than 128 characters return `400` with `{ "error": "Invalid lastEventId" }`. A bounded but invalid cursor instead opens the stream and emits `replay_gap` with `reason: "invalid_cursor"`. A well-formed cursor that is no longer available in the replay buffer emits `replay_gap` with `reason: "cursor_unavailable"`. In both replay-gap cases the event is sent with an empty SSE `id:` so the browser resets its native last-event-id state.

> [!NOTE]
> **Next release behavior.** On the first `open` after a reload with a stored
> cursor, the browser refreshes the affected ticket caches but keeps the cursor
> and live subscription. A `replay_gap` clears the in-memory and durable cursor,
> refreshes the affected caches when that connection has not already recovered,
> and keeps the live subscription while the snapshots load. After a replay gap,
> later reconnects omit `lastEventId` until a new event supplies one. Ordinary
> transport errors
> still invalidate the current ticket and ticket list, but do not trigger the
> broad cache refresh unless the server reports a gap.

The stream route rejects the 7th concurrent client for the same ticket and rejects new streams once the global total reaches 100 active clients.

After a completed assistant turn is recorded, an `ai_metrics` event carries only `ticketId`, `phase`, `phaseAttempt`, `modelId`, and `updatedAt`. It invalidates an already-open AI/model details query; token and cost values remain in the authenticated REST response rather than the SSE replay buffer.

Example health payload:

```json
{
  "status": "ok",
  "timestamp": "2026-04-23T09:00:00.000Z",
  "uptime": 1234.56
}
```

Example models payload:

```json
{
  "models": [],
  "allModels": [],
  "connectedProviders": [],
  "defaultModels": {},
  "message": "OpenCode server is not reachable. Start it with `opencode serve`."
}
```

## Profile Routes

LoopTroop uses a singleton profile, not a collection.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/profile` | Returns the singleton profile or `null` |
| `POST` | `/api/profile` | Creates the singleton profile |
| `PATCH` | `/api/profile` | Updates the singleton profile |

`POST /api/profile` returns `409` when the profile already exists. `PATCH /api/profile` returns `404` when no profile has been created yet.

> [!NOTE]
> **Next release behavior.** The browser form snapshot and prompt preview
> handling described in this section are upcoming client behavior.

The browser forms keep a snapshot of the actual values they are editing. A
successful profile, project, or ticket write advances only the submitted
snapshot; a failed write leaves the draft dirty, and later edits remain newer
than the request that is still completing. Hydration and refetch do not replace
values already being edited. This is browser state, not a promise that an
unsaved modal draft survives a reload.

Example profile update payload:

> [!NOTE]
> Timeout and delay fields (`perIterationTimeout`, `executionSetupTimeout`, `councilResponseTimeout`, `opencodeRetryDelay`) are stored and used in **milliseconds**. The values shown below are the current defaults.

```json
{
  "mainImplementer": "openai/gpt-5.4",
  "mainImplementerVariant": "high",
  "councilMembers": "[\"openai/gpt-5.4\",\"anthropic/claude-sonnet-4\"]",
  "councilMemberVariants": "{\"openai/gpt-5.4\": \"high\"}",
  "manualQaEnabled": true,
  "aiQuestionsEnabled": true,
  "aiQuestionWindow": 300000,
  "gitHookPolicy": "validate_advisory",
  "ignoreMode": "local",
  "minCouncilQuorum": 2,
  "perIterationTimeout": 1200000,
  "executionSetupTimeout": 1200000,
  "councilResponseTimeout": 1200000,
  "interviewQuestions": 50,
  "coverageFollowUpBudgetPercent": 20,
  "maxCoveragePasses": 2,
  "maxPrdCoveragePasses": 5,
  "maxBeadsCoveragePasses": 5,
  "structuredRetryCount": 1,
  "maxIterations": 5,
  "opencodeRetryLimit": 10,
  "opencodeRetryDelay": 60000,
  "opencodeSteps": 0,
  "toolInputMaxChars": 4000,
  "toolOutputMaxChars": 12000,
  "toolErrorMaxChars": 6000
}
```

`councilMemberVariants` is a JSON-encoded map of model ID → variant string (e.g. `"high"` or `"low"`) that pins specific effort levels per council member.

`structuredRetryCount` controls automatic structured-output retry prompts after the first invalid or missing structured response. It defaults to `1`, accepts `0` through `5`, and is locked onto each ticket at start; missing locked values on older tickets fall back to the current profile value and then the default.

`opencodeRetryLimit` and `opencodeRetryDelay` control prompt-level OpenCode retry handling for continuable provider interruptions across all phases that use OpenCode. The limit defaults to `10` retry status events and accepts `0` through `50`; the delay defaults to `60000` ms and accepts `0` through `3600000`. Exhaustion of either budget blocks with diagnostics and preserves the active session for Continue when the interruption is resumable.

`opencodeSteps` sets the maximum number of steps OpenCode is allowed to perform per session. When the limit is reached, OpenCode instructs the model to summarize its work and close the session; LoopTroop then starts a fresh session to continue. Defaults to `0` (no limit — OpenCode default), accepts `0` through `500`.

Selected validation ranges that are easy to miss when calling the API directly:

> [!NOTE]
> **Next release behavior.** The `maxIterations` continuation scope described
> below applies to automatic bead-response continuations within one bead
> iteration. User-facing Continue across workflow phases is a separate action
> and is not counted by this cap.

| Field(s) | Accepted values | Notes |
| --- | --- | --- |
| `minCouncilQuorum` | `1` to `6` | Must not exceed the practical council size |
| `interviewQuestions` | `0` to `50` | `0` is accepted, though normal runs typically keep a positive interview budget |
| `coverageFollowUpBudgetPercent` | `0` to `100` | Percentage budget for coverage follow-up questions |
| `maxCoveragePasses` | `1` to `10` | Shared generic coverage loop |
| `maxPrdCoveragePasses`, `maxBeadsCoveragePasses` | `2` to `20` | PRD and beads coverage loops have a stricter lower bound |
| `maxIterations` | `0` to `20` | Finite values bound automatic bead-response continuation within each bead iteration; `0` means unlimited for that path |
| `aiQuestionWindow` | `60000` to `3600000` ms | How long an AI question waits before the run carries on; defaults to `300000` |
| `gitHookPolicy` | `observe_only`, `validate_advisory`, `validate_required`, `use_native_hooks` | Future-project default for LoopTroop-owned Git operations; `validate_advisory` is the built-in default |
| `ignoreMode` | `repo`, `local`, `skip` | Future-project folder-ignore default; `local` is the built-in default |
| `toolInputMaxChars`, `toolErrorMaxChars` | `500` to `50000` | Applied to OpenCode tool transcript truncation |
| `toolOutputMaxChars` | `1000` to `100000` | Higher lower bound because tool output is usually larger |

## Authentication And Daemon Control

These routes are part of the full daemon surface, but some are mounted only when the host enables session credentials or shutdown control.

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/exchange` | Exchange a one-time bootstrap nonce for the browser session cookie; unauthenticated by design |
| `POST` | `/api/auth/bootstrap` | Mint a one-time bootstrap nonce for `looptroop open`; available only when session auth is enabled |
| `POST` | `/api/auth/bootstrap/status` | Check whether a minted bootstrap nonce is still outstanding; available only when session auth is enabled |
| `POST` | `/api/daemon/shutdown` | Ask the daemon to stop after the response is flushed; mounted only when the host exposes a shutdown hook |

`POST /api/auth/exchange` expects `{ "nonce": "..." }`. Invalid or expired nonces return `401`. On success, the response sets the HttpOnly session cookie and returns `{ "ok": true }`.

`POST /api/auth/bootstrap` returns `{ "nonce": "..." }`. `POST /api/auth/bootstrap/status` expects `{ "nonce": "..." }` and returns `{ "pending": true|false }`.

`POST /api/daemon/shutdown` is authenticated like the rest of the mounted API, returns `{ "ok": true }` with HTTP `202`, and sets `Connection: close` so the daemon can retire the socket after acknowledging the request.

## Prompt Customization Routes

Prompt IDs can name either editable prompt templates or editable global rule blocks.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/prompts` | List editable prompt groups, prompt IDs, modification flags, template directory, and load warnings |
| `GET` | `/api/prompts/:id` | Read one editable prompt or global rule, including current and default source |
| `PUT` | `/api/prompts/:id` | Save one prompt or global rule from `{ "source": "..." }` |
| `POST` | `/api/prompts/:id/preview` | Render a preview using the supplied `{ "source": "..." }` or the currently saved source when omitted |
| `POST` | `/api/prompts/:id/revert` | Revert one prompt or global rule to its bundled default |
| `POST` | `/api/prompts/reset-all` | Revert every editable prompt and global rule to defaults |

Unknown prompt IDs return `404`. Save requests require a non-empty `source` string. Preview returns `400` when the supplied text cannot be parsed as a valid prompt or rule block. Revert returns the current defaulted source for the selected ID, and reset-all returns `{ "reset": true, "templatesDir": "..." }`.

The Prompts editor applies preview results only when the prompt ID and draft
still match the request. Current validation or preview errors remain visible;
responses from an older prompt or draft are ignored. **Revert** intentionally
requests the default returned by the server; later edits remain dirty instead of
being replaced by that response.

## Project Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/projects/check-git?path=...` | Validates git/GitHub origin status, reports whether the canonical repository is already attached, and previews existing LoopTroop state |
| `GET` | `/api/projects/ls?path=...` | Directory browser used by the attach-project flow |
| `GET` | `/api/projects` | List attached projects |
| `GET` | `/api/projects/:id` | Get one project |
| `POST` | `/api/projects` | Attach a project |
| `PATCH` | `/api/projects/:id` | Update project settings |
| `DELETE` | `/api/projects/:id` | Delete a project if no active tickets remain |
| `GET` | `/api/projects/:id/worktrees/size` | Get the total disk size of all worktrees for a project |
| `DELETE` | `/api/projects/:id/worktrees` | Delete worktrees for completed and canceled tickets only, including same-user read-only cache trees; active ticket worktrees are left untouched |

`GET /api/projects/check-git` returns attach-flow metadata in addition to simple validity. When relevant, the response also includes `scope` (`root` or `subfolder`), `repoRoot`, `githubRepoSlug`, `hasLoopTroopState`, `existingProject`, `alreadyAttached`, `attachedProject`, and `performanceWarning` for WSL mounted-drive performance warnings. `alreadyAttached` is based on the canonical Git repository root, so a subfolder, symlink, trailing slash, or alternate path for an attached repository reports the same conflict. `attachedProject` contains the attached project's `id`, `name`, `shortname`, and canonical `folderPath`; clients should block the create action when `alreadyAttached` is true. GitHub origin inspection adds `githubOriginWriteAccess` (`writable`, `read_only`, or `unknown`) and `githubViewerPermission`; a confirmed `READ` or `TRIAGE` permission also adds `githubWriteWarning`. This warning is advisory and leaves `status` as `valid`, because the active GitHub CLI identity may differ from the credentials used by Git push. The `existingProject` preview contains the saved `name`, `shortname`, `icon`, `color`, `ticketCounter`, total `ticketCount`, `activeTicketCount`, `gitHookPolicy`, `manualQaOverride`, and `ignoreMode`. `activeTicketCount` counts statuses other than `DRAFT`, `COMPLETED`, and `CANCELED`. This lets clients show exactly which project settings and ticket data each attachment action keeps or removes before submitting.

The folder picker treats a failed Git-check request as a retryable error, not as
the valid response for a non-Git directory. Navigation generations fence late
directory or check responses so an older result cannot replace the current
path.

Example existing-state preview:

```json
{
  "isGit": true,
  "status": "valid",
  "scope": "root",
  "repoRoot": "/home/liviu/MeiliSearch",
  "githubRepoSlug": "meilisearch/meilisearch",
  "githubOriginWriteAccess": "read_only",
  "githubViewerPermission": "READ",
  "githubWriteWarning": "The active GitHub CLI account has READ access to meilisearch/meilisearch, which does not include branch write access. You can attach this project, but LoopTroop's bead pushes may fail unless origin uses writable credentials. Configure a writable fork or repository as origin before starting tickets.",
  "hasLoopTroopState": true,
  "existingProject": {
    "name": "MeiliSearch",
    "shortname": "MESE",
    "icon": "🔎",
    "color": "#a855f7",
    "ticketCounter": 7,
    "ticketCount": 7,
    "activeTicketCount": 2,
    "gitHookPolicy": "validate_advisory",
    "manualQaOverride": false,
    "ignoreMode": "local"
  },
  "message": "Existing LoopTroop project found at repository root"
}
```

Example project attachment payload:

```json
{
  "name": "LoopTroop",
  "shortname": "LOOP",
  "folderPath": "/home/liviu/LoopTroop",
  "icon": "📁",
  "color": "#3b82f6",
  "profileId": 1,
  "manualQaOverride": false,
  "gitHookPolicy": "validate_advisory",
  "ignoreMode": "local",
  "existingStateAction": "restore"
}
```

When the resolved repository root already contains `.looptroop` project state and is not currently registered in the app-level attachment registry, `existingStateAction` controls the attachment:

| Value | Behavior |
| --- | --- |
| `restore` | Keeps tickets, workflow/artifact state, ticket counter, saved short name, and project-level overrides. Applies current form edits to visible project settings. |
| `clear_tickets` | Keeps the project row, saved short name, appearance, creation time, profile association, Advanced choices, and every project-level override; applies current visible form edits; removes all ticket-linked database state, ticket content, and managed worktrees; then resets `ticketCounter` to `0` and advances the update time. |
| `start_fresh` | Removes managed worktrees and the complete `.looptroop` folder, then creates a new project from the submitted form values. |

The field is optional for API compatibility and defaults to `restore` when existing state is found. When the corresponding request fields are omitted, restore and clear-tickets retain the saved `manualQaOverride`, `gitHookPolicy`, and `ignoreMode`, backfilling a legacy missing value from Configuration; explicit form/API values win. Start-fresh uses the submitted choices or current profile defaults. All three existing-state paths update the saved `folderPath` to the repository root resolved on the current machine. Destructive modes remove active tickets as well as terminal tickets, but never delete repository source files, commits, or local/remote branches. Because `clear_tickets` resets numbering, its next ticket is `<SHORTNAME>-1`; an old branch retained in the repository can therefore have the same ticket identifier.

Creating an already-attached repository returns HTTP `409` with `code: "PROJECT_ALREADY_ATTACHED"`. Creating or renaming a project with a name or short name already used by another attached project returns HTTP `409` with `code: "PROJECT_IDENTITY_CONFLICT"`; names compare case-insensitively after trimming, and short names compare in uppercase form. The response includes a `conflicts` array whose entries identify `folder`, `name`, or `shortname` conflicts.

Direct attachment/update validation and mutability rules:

| Field | Create | Patch | Notes |
| --- | --- | --- | --- |
| `name` | required | optional | `1` to `100` characters; unique among attached projects after trimming and case folding |
| `shortname` | required | not accepted | `3` to `5` uppercase letters or digits; unique among attached projects |
| `folderPath` | required | not accepted | Must resolve to a git repository; outside tests, the repository must also have a GitHub `origin` |
| `profileId` | optional | not accepted | Attach-time only |
| `icon`, `color` | optional | optional | `color` must be `#RRGGBB` |
| `ignoreMode` | optional | not accepted | Attach-time project choice: `repo`, `local`, or `skip`; omission uses the profile default, then built-in `local` |
| `existingStateAction` | optional | not accepted | Existing state only: `restore`, `clear_tickets`, or `start_fresh`; defaults to `restore` |
| Project overrides listed below | optional | optional | Apply only to future ticket starts |

Create and update routes also accept optional project-level overrides for future tickets in that project:

```json
{
  "councilMembers": "[\"openai/gpt-5.4\",\"anthropic/claude-sonnet-4\"]",
  "manualQaOverride": true,
  "aiQuestionsOverride": null,
  "aiQuestionWindowOverride": 600000,
  "gitHookPolicy": "use_native_hooks",
  "maxIterations": 7,
  "perIterationTimeout": 1500000,
  "executionSetupTimeout": 1800000,
  "councilResponseTimeout": 1500000,
  "minCouncilQuorum": 2,
  "interviewQuestions": 40
}
```

`aiQuestionsOverride` and `aiQuestionWindowOverride` are nullable, and `null` means inherit from the profile. They cascade independently, so a project can set its own wait while taking the on/off answer from Configuration. The window accepts `60000` to `3600000` ms.

The Manual QA and Git-hook choices submitted for a new project are concrete saved project settings. If either is omitted at creation, LoopTroop copies the current profile default; an explicit value wins. Project updates affect future ticket starts, while existing tickets keep their locked values. `ignoreMode` is likewise concrete, but it is attach-time only and controls where LoopTroop appends its runtime-folder rules rather than ticket execution.

Project list/detail responses expose the persisted `manualQaOverride`, `gitHookPolicy`, and effective `ignoreMode`. Newly created or restored projects hold concrete values, so clients do not need to recompute them from the current profile.

Worktree size response:

```json
{ "bytes": 1234567 }
```

Worktree delete response:

```json
{ "success": true, "freedBytes": 1234567 }
```

Project deletion (`DELETE /api/projects/:id`) returns 409 when any ticket in the project is not in `DRAFT`, `COMPLETED`, or `CANCELED` status. Finish or cancel all active tickets before deleting the project. Worktree deletion is narrower: it only removes completed and canceled ticket worktrees and leaves active ticket worktrees untouched. Before removal, LoopTroop safely restores owner permissions throughout each managed worktree without following symlinks, allowing cleanup of read-only outputs created by project tooling while preserving targets outside the worktree.

> [!NOTE]
> **Next release behavior.** The guarded approval-save and UI-state draft
> retention details in the ticket routes below describe the upcoming release.

## Ticket Routes

Ticket routes are implemented using a modular handler architecture located in `server/routes/ticketHandlers/*`. This splits the broad ticket API into focused domains:

- `crudHandlers.ts` for lifecycle creation and basic updates
- `artifactHandlers.ts` for artifact retrieval
- `approvalHandlers.ts` for human approval gates
- `uiStateHandlers.ts` for frontend draft persistence
- `executionSetupHandlers.ts` for environment setup plan routes
- `interviewHandlers.ts` for Q&A persistence
- `lifecycleHandlers.ts` for workflow progression
- `devEventHandlers.ts` and `openCodeQuestionHandlers.ts` for advanced integrations

### CRUD And UI State

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets` | Optionally filtered with `?project=` or `?projectId=` |
| `GET` | `/api/tickets/:id` | Get one ticket by composite ticket ref |
| `GET` | `/api/tickets/:id/size` | Recursively measure the ticket worktree and return logs/artifacts/source breakdown; returns `{ "size": 0, "exists": false }` when no worktree exists yet |
| `POST` | `/api/tickets` | Create a ticket; title max 500 characters, description max 50,000 characters, priority `1` through `5`, with an optional Manual QA choice |
| `PATCH` | `/api/tickets/:id` | Update title, description, priority, or Manual QA; Manual QA is Draft-only |
| `DELETE` | `/api/tickets/:id` | Only allowed for `COMPLETED` or `CANCELED` |
| `GET` | `/api/tickets/:id/ui-state?scope=...` | Read persisted UI state |
| `PUT` | `/api/tickets/:id/ui-state` | Save persisted UI state |

The browser treats a confirmed `DELETE /api/tickets/:id` as a cache boundary.
It settles pending UI-state saves before sending the request, removes the
deleted ticket's ticket-scoped query and local state after success, and
refetches the ticket list. Logs, seen notices, UI-state revisions, rendered
markers, the SSE cursor, question-collapse state, and pending ticket-scoped
invalidations are included; unrelated tickets are left alone. A failed delete
keeps the living ticket's state and releases its pending save queue. If the
server later issues the same ticket id again, this browser tab starts it
without the previous cursor. This behavior is local to the current tab and is
not a cross-tab cleanup guarantee.

Example ticket creation payload:

```json
{
  "projectId": 1,
  "title": "Implement refresh-token rotation",
  "description": "Rotate refresh tokens and invalidate the family on reuse.",
  "priority": 2,
  "manualQaOverride": null,
  "aiQuestionsOverride": null,
  "aiQuestionWindowOverride": null
}
```

Create-ticket validation requires a non-empty title up to 500 characters. The optional description is capped at 50,000 characters, and `manualQaOverride` accepts a boolean or `null`. `aiQuestionsOverride` accepts a boolean or `null`, and `aiQuestionWindowOverride` accepts `60000` to `3600000` ms or `null`; `null` means inherit from the project, then the profile. Update validation is slightly narrower: patched titles are capped at 200 characters, Manual QA and AI-question changes return `409` outside Draft, and `status` is API-protected so workflow transitions must go through the action routes below. Ticket create/update payloads do not accept `gitHookPolicy`; Git-hook policy belongs to the project.

Ticket read responses expose the resolved values as `effectiveAiQuestionsEnabled` / `effectiveAiQuestionsSource` and `effectiveAiQuestionWindow` / `effectiveAiQuestionWindowSource`, alongside the equivalent Manual QA fields. The source is `ticket`, `project`, or `profile`. Once a ticket has started, these read from the columns frozen at Start rather than from current settings, and a ticket that started before these settings existed resolves to off.

Ticket list and detail responses also carry `pendingQuestions`, which is `null` when nothing is waiting:

```json
{
  "requestCount": 3,
  "questionCount": 6,
  "deadlineAt": "2026-08-28T09:19:02.113Z",
  "stoppedAt": null
}
```

The two counts disagree on purpose: a council of three models asking two things each is 3 requests and 6 questions. Surfaces that speak to a person count questions. There is one `deadlineAt` rather than an earliest-of, because the countdown belongs to the step and every request in it shares one. This is what moves a card into the **Needs Input** board column; the ticket's `status` does not change.

Before Start, ticket responses expose the stored Manual QA choice and its effective fields. Git-hook fields remain read-only workflow data: `effectiveGitHookPolicy` reflects the saved project choice, and Start snapshots it into `lockedGitHookPolicy` with a project source so later project edits do not alter that run. A legacy project whose saved policy is missing may still report `profile` as the fallback source until it is restored or resaved.

All ticket route params shown as `:id` or `:ticketId` use the composite public ticket ref, such as `1:AUTH-12`. The browser URL uses only the external ticket id (`/ticket/AUTH-12`), but API callers should send the composite ref returned by ticket list/detail payloads and URL-encode it when constructing request paths or query strings.

Ticket list/detail payloads also include `isDisplayOnlyMock`, a boolean UI hint for board-only mock/demo tickets. These tickets keep their raw `externalId` for routing and storage, but clients can use the flag to add display-only markers without parsing reserved branch names. Display-only mock/demo tickets that are not terminal expose only the `cancel` action; runnable workflow actions remain hidden and rejected.

Example ticket size response:

```json
{
  "size": 1234567,
  "exists": true,
  "breakdown": {
    "logs": {
      "total": 4096,
      "children": [
        { "name": "execution-log.jsonl", "size": 2048, "isDirectory": false }
      ]
    },
    "artifacts": {
      "total": 8192,
      "children": [
        { "name": "runtime", "size": 8192, "isDirectory": true }
      ]
    },
    "source": {
      "total": 12288,
      "children": [
        { "name": "src", "size": 12288, "isDirectory": true }
      ]
    }
  }
}
```

Example UI-state payload:

```json
{
  "scope": "interview-drafts",
  "expectedRevision": 12,
  "actionId": "autosave:manual-qa-v2:9f5c",
  "data": {
    "draftAnswers": {},
    "skippedQuestions": {},
    "selectedOptions": {}
  }
}
```

Example UI-state response:

```json
{
  "scope": "interview-drafts",
  "exists": true,
  "data": {
    "draftAnswers": {},
    "skippedQuestions": {},
    "selectedOptions": {}
  },
  "updatedAt": "2026-04-23T09:00:00.000Z",
  "revision": 12,
  "clientRevision": 12
}
```

The UI-state channel is server-owned compare-and-set storage. Each mutation supplies an `expectedRevision` and unique `actionId`. Saves are serialized per ticket/scope; an exact revision match increments the server revision, while stale, equal-but-conflicting, or otherwise mismatched writes return `409` with the latest state and revision. Reusing the same action id is idempotent. `clientRevision` remains as a response compatibility alias for `revision`.

The browser may keep a pending or failed local draft while a completed `GET`
records the server revision it observed. That revision is a fence for the next
retry; it does not rebase the unconfirmed local payload or turn it into a
confirmed save. A successful mutation publishes its new revision before the
next queued mutation is sent, and a delayed older response cannot replace a
newer cache entry.

UI-state `scope` must match `^[a-zA-Z0-9:_-]+$` and be at most 80 characters. Stored UI-state payloads are capped at 2 MiB. A successful `PUT` returns the incremented revision; a conflict response includes `conflict: true`, the latest `data`, and the current revision so the caller can reconcile before retrying.

Manual QA live drafts use the sole scope `manual_qa_draft:vN`; only evidence metadata/references enter that state. New items initialize as `pending`; Pass and Waive require no evidence, Pass notes and waiver reasons are optional, and the frontend keeps the five-second debounce plus keepalive flush on `pagehide`/`beforeunload`. There is no separate manual-save endpoint: the workspace derives its relative last-save indicator and exact hover timestamp from the successful UI-state response.

Submit and Skip capture the draft, evidence, and checklist round synchronously
at the click. A later autosave from another tab may be newer, but it does not
replace the submitted checks or cancel follow-up generation. This click-time
snapshot is separate from best-effort unload persistence; an unload request is
not guaranteed to arrive.

### Manual QA Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/manual-qa` | Round index/current projection: active version plus structured per-version artifact availability, outcome/status, completion time, and matching phase attempt |
| `GET` | `/api/tickets/:id/manual-qa/versions/:version` | Checklist, coverage, results, summary, evidence metadata, hash, read-only state, and any resumable `{ actionId, operationType, state }` journal |
| `PUT` | `/api/tickets/:id/manual-qa/versions/:version/evidence?itemId=...` | Stream one evidence file; filename/media metadata use headers/query fields; 250 MiB per-file limit |
| `GET` | `/api/tickets/:id/manual-qa/versions/:version/evidence/:itemId/:evidenceId` | Secure read/download; `?inline=true` works only for safe raster media types |
| `DELETE` | `/api/tickets/:id/manual-qa/versions/:version/evidence/:itemId/:evidenceId` | Remove one evidence file and metadata record while waiting |
| `POST` | `/api/tickets/:id/manual-qa/submit` | Validate the round; for failures require read-only repository inspection and persist a complete `fix-beads.yaml` candidate before idempotently creating configured improvements and normal QA-fix beads |
| `POST` | `/api/tickets/:id/manual-qa/skip` | Bypass ordinary result/observation/group completeness validation, preserve all entered data plus an optional reason as an immutable draft, create no drafted work, then integrate |
| `POST` | `/api/tickets/:id/manual-qa/workspace-drift/include` | Commit only the selected audited drift files into the QA checkpoint |
| `POST` | `/api/tickets/:id/manual-qa/workspace-drift/discard` | Discard only the selected audited drift files |

Evidence upload/remove calls carry `X-Action-Id`, `X-Checklist-Hash`, and `X-Draft-Revision` (query/body equivalents are supported). The raw upload body is streamed; `X-Checklist-Item-Id`, `X-File-Name`, and optional stable `X-Evidence-Id` identify it. The client publishes a successful upload into the active item immediately and initially discloses five evidence entries, with the rest controlled locally by Show more/Show less. HTTP(S) link evidence is created on demand from separate Link and Details fields rather than from a default blank row.

Submit, skip, and drift decisions carry `actionId`, `expectedChecklistHash`, and `expectedDraftRevision` in JSON. Improvement drafts also carry priority `1–5` and an explicit Manual QA enabled/disabled snapshot. Submit validation permits multi-select merge-group drafts to refer to any checklist item while editing, but returns item number/title diagnostics if a selected member is not Fail. For failures, model/tool/parser errors occur before any child side effect and route to `BLOCKED_ERROR`; Retry resumes the same journal action. Evidence uploads/removals must settle before Submit or Skip. On Submit, the durable evidence index is canonical: stored files and their metadata are retained, dangling optional IDs are omitted, and known cross-item references remain integrity errors that identify both checklist items and the original filename without exposing internal evidence IDs. Skip intentionally ignores incomplete result-specific fields and group membership because it creates neither fix beads nor Improvement tickets; it still archives the entered draft read-only. Action IDs use the strict workflow identifier grammar and are rejected before any reservation or filesystem mutation. Mutations are allowed only during `WAITING_MANUAL_QA` and return `409` for stale guards or detected workspace drift. Interrupted Submit/Skip calls must resume the journal's same action and operation type. The client retains upload, removal, and drift action/evidence identities until confirmation, but refreshes the checklist/revision CAS guards on every retry. Ambiguous failures refetch the round, and failed uploads retain the exact selected `File` in an explicit retry state; the server uses the stable identities to reconcile contained file/index/receipt windows without duplicate effects.

Only PNG, JPEG, GIF, WebP, and AVIF may be served inline. SVG, HTML, executable/unknown content, and all other files are sent with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`. Evidence links in results accept HTTP or HTTPS only.

Ticket projections expose `visitedStatuses`, monotonic `workflowRevision`, and `manualQa`. REST and SSE status fields may include `GENERATING_EXECUTION_SETUP_PLAN` between pre-flight and setup approval, including when regeneration returns immediately in that state; request and response envelopes otherwise remain unchanged. The Manual QA projection distinguishes reservations from checklist-backed versions and maps each available version to its phase attempt, so clients never request an unavailable active reservation and can bind historical artifacts and logs to the same version. These fields also let SSE and polling clients reconcile a deliberate reverse transition (`WAITING_MANUAL_QA → CODING`) without comparing status positions in a linear list.

### Workflow Actions

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/tickets/:id/start` | Starts a `DRAFT` ticket using locked profile and project settings |
| `POST` | `/api/tickets/:id/approve` | Generic workflow approval endpoint |
| `POST` | `/api/tickets/:id/cancel` | Cancel active work — accepts an optional JSON body (see below) |
| `POST` | `/api/tickets/:id/approve-interview` | Approve interview artifact |
| `POST` | `/api/tickets/:id/approve-prd` | Approve PRD artifact |
| `POST` | `/api/tickets/:id/approve-beads` | Approve bead plan artifact |
| `POST` | `/api/tickets/:id/approve-execution-setup-plan` | Approve execution setup plan |
| `POST` | `/api/tickets/:id/edit-execution-setup-plan` | After UI confirmation, rewind a blocked workspace runtime setup to setup-plan approval |
| `POST` | `/api/tickets/:id/coverage/fix-gaps` | Run one approval-screen extra fix for unresolved PRD or beads coverage gaps |
| `POST` | `/api/tickets/:id/merge` | Merge delivered PR |
| `POST` | `/api/tickets/:id/close-unmerged` | Close without merge — accepts an optional `{ "reason": "..." }` body, stored as `closeReason` on the `merge_report` artifact. Unknown fields return `400`, so a retry note cannot be sent here by mistake |
| `POST` | `/api/tickets/:id/verify` | Alias for the merge handler — both routes call the same handler |
| `POST` | `/api/tickets/:id/retry` | Retry a blocked ticket or failed phase; an optional `{ "note": "..." }` body adds CODING bead guidance or sends one direct message to a preserved execution setup session |
| `POST` | `/api/tickets/:id/continue` | Continue a blocked ticket only when eligible OpenCode/provider diagnostics, including `HTTP 402 Payment Required`, have a matching active preserved OpenCode session |
| `POST` | `/api/tickets/:id/dev-event` | Disabled by default; requires `LOOPTROOP_ENABLE_DEV_EVENT=1`, `LOOPTROOP_DEV_EVENT_TOKEN`, and `X-LoopTroop-Dev-Event-Token` |

Merge and Close Without Merge read the live pull request before making a
decision, then revalidate the same PR under the ticket lock. An initial remote
read failure writes a typed recovery receipt with `step: "refresh_pull_request"`,
the PR number, the error, and null remote state/URL, then leaves the ticket in
`WAITING_PR_REVIEW` without recording success. A verified merge or
closed-unmerged decision resumes after an interrupted dispatch and fences
conflicting actions for that PR; observed merged state remains visible even if
approved-candidate validation rejects completion. Close Without Merge never
merges the PR, and remote uncertainty is not recorded as success.

All approval routes, including the generic `/approve` route, require the hash of the content currently shown to the user:

```json
{
  "expectedContentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "gapAcknowledgementReason": "The remaining gap is tracked in a follow-up ticket."
}
```

`gapAcknowledgementReason` is optional and is offered by the interface only when coverage left unresolved gaps. When present it is recorded as a `gap_acknowledgement` block on the `approval_receipt` artifact and in the ticket's skip trail.

Malformed or missing hashes return `400`. If the current server artifact no longer matches the expected hash, the route returns `409` and leaves the workflow paused:

```json
{
  "error": "Stale approval",
  "artifactType": "prd",
  "expectedContentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "currentContentSha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}
```

Successful approvals write durable `approval_receipt` phase artifacts. Approval snapshots and receipts include `content_sha256`; interview and PRD receipts also include `stored_content_sha256` when approval stamping changes the persisted YAML.

`POST /api/tickets/:id/approve-beads` also uses `422` for plans that need repair rather than a generic server error. That includes damaged bead JSONL (the response names the failing line) and syntactically valid saved plans that still fail approval-time validation, such as a bead with empty `testCommands` and no required `testCommandReason`.

`POST /api/tickets/:id/coverage/fix-gaps` accepts `{ "domain": "prd" }` only while the ticket is in `WAITING_PRD_APPROVAL`, or `{ "domain": "beads" }` only while the ticket is in `WAITING_BEADS_APPROVAL`. The server reloads the latest coverage artifact and source artifacts before prompting, ignores stale browser gap text, runs exactly one fresh targeted fix attempt followed by one fresh coverage check, and returns the updated result. Concurrent fix attempts for the same ticket/domain return `409`, and approval routes also return `409` while a matching fix is in progress. If no gaps remain, the route returns a no-op success.

Most action routes in this section respond with the latest machine snapshot so callers can refresh local state without making an immediate follow-up read:

```json
{
  "message": "Start action accepted",
  "ticketId": "1:AUTH-12",
  "status": "SCANNING_RELEVANT_FILES",
  "state": "SCANNING_RELEVANT_FILES",
  "ticket": {
    "id": "1:AUTH-12",
    "status": "SCANNING_RELEVANT_FILES"
  }
}
```

The Continue endpoint is available only from `BLOCKED_ERROR`. It requires a known `previousStatus`, an unresolved active error occurrence with a diagnostic `sessionId`, a matching active `opencode_sessions` row for that ticket and previous phase, and an OpenCode session that is still addressable by that exact id. It returns `409` and leaves the ticket blocked when those checks fail. On success it dispatches `CONTINUE`, records the pending session continuation, and the next owned prompt sends exactly `continue please` without creating a fresh phase attempt.

The Retry endpoint accepts an empty body for ordinary recovery. It also accepts the following body when the ticket is currently in `BLOCKED_ERROR` with `previousStatus: "CODING"` or `previousStatus: "PREPARING_EXECUTION_ENV"`:

```json
{
  "note": "Check the migration ordering before rerunning the focused tests."
}
```

`note` must contain at least one non-whitespace character and must not exceed 20,000 characters. For coding, LoopTroop first proves it can reset the same failed or paused bead, then appends a structured `userRetryNotes` entry containing the ISO timestamp, iteration, and the user's text unchanged. This keeps the existing fresh-bead recovery behavior.

For execution setup, the request requires the preserved `PREPARING_EXECUTION_ENV` OpenCode session. LoopTroop sends only the user's text as the next prompt in that session and allows exactly one manual setup attempt beyond the configured automatic retry budget. The current runtime phase attempt is not archived, and the text is not appended to `execution_setup_notes` or reused as future setup context. If the session cannot be resumed or the manual attempt cannot start, the ticket remains blocked. Note-bearing requests for historical errors, other phases, blank notes, or oversized notes are rejected. Omitting `note` preserves ordinary Retry behavior.

The ticket's advertised `availableActions` are authoritative for recovery UI.
Setup approval does not imply `edit_execution_setup_plan` or a note-bearing
retry; those actions are available only for the live blocked runtime setup when
the server includes them. Unknown workflow statuses advertise no actions.

`POST /api/tickets/:id/edit-execution-setup-plan` is available only for the live `BLOCKED_ERROR` whose `previousStatus` is `PREPARING_EXECUTION_ENV`. The UI opens a confirmation dialog before calling it. Once confirmed, the route archives the failed runtime attempt, preserves it in phase history, and returns the ticket to `WAITING_EXECUTION_SETUP_APPROVAL` with the current plan available for editing or regeneration. Other phases and historical error occurrences return `409`.

Bead API/read-model payloads expose three independent append-only arrays: `failedIterationNotes`, `userRetryNotes`, and `finalizationFailureNotes`. Each entry contains `timestamp`, `iteration`, `content`, and optional `errorCode`. Runtime bead overlays also expose `startedAt`, `updatedAt`, `completedAt`, and typed nullable `qaOrigin` on Manual-QA-created fix beads. `updatedAt` is the live countdown anchor. LoopTroop strips ANSI terminal sequences from machine-generated failed-iteration and finalization content; user retry content is preserved exactly.

Final-test file effects no longer expose include/discard recovery endpoints. The audit preserves explicit candidate intent and tracked or staged changes, keeps recognized untracked generated/cache/setup-local outputs on disk as local-only, and retries classification once for unknown untracked files. The same known generated exclusions apply at merge; arbitrary untracked-file exemptions are not supported. Unresolved tracked changes remain candidates for the later PR audit.

The cancel endpoint accepts an optional JSON request body to trigger cleanup or complete deletion at cancellation time.

```json
{
  "deleteContent": false,
  "deleteLog": false,
  "deleteTicket": false,
  "reason": "Requirements changed before implementation started."
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `deleteContent` | `boolean` | `false` | Permanently removes all AI-generated artifacts (interview Q&A, PRD drafts, beads plan) from the database and deletes the isolated git worktree and its branch |
| `deleteLog` | `boolean` | `false` | Permanently removes the execution log files (`.ticket/runtime/execution-log.jsonl`, `.ticket/runtime/execution-log.debug.jsonl`, and `.ticket/runtime/execution-log.ai.jsonl`) for this ticket. This is only effective when the worktree still exists; if `deleteContent` is also `true` the worktree removal already covers the logs |
| `deleteTicket` | `boolean` | `false` | Permanently deletes the ticket record from the database and removes all related files (equivalent to the DELETE ticket action once canceled) |
| `reason` | `string` | — | Optional. Why the ticket was cancelled, up to 20,000 characters. Stored on the ticket's own `cancel_reason` column, so it survives `deleteContent`. Nothing survives `deleteTicket` |

The body is validated strictly. A malformed or oversized field returns `400` and the ticket is left running. It previously fell back to defaults and cancelled anyway, which silently dropped the rejected field while still performing the destructive part of the request.

In the next release, the cancel endpoint will return `409` while the ticket is
in `CLEANING_ENV` and after a verified merge has been recorded. In either case,
the ticket remains unchanged.

### Interview And Planning Editing

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/interview` | Returns interview payload with `winnerId`, `raw`, `document`, `session`, and `questions` |
| `PUT` | `/api/tickets/:id/interview` | Save raw interview YAML |
| `PUT` | `/api/tickets/:id/interview-answers` | Save structured interview answers during approval or planning restart |
| `POST` | `/api/tickets/:id/answer` | Deprecated, returns `410`; use `answer-batch` |
| `POST` | `/api/tickets/:id/answer-batch` | Submit interview answers |
| `POST` | `/api/tickets/:id/skip` | Skip remaining interview questions |
| `PATCH` | `/api/tickets/:id/edit-answer` | Edit a previously recorded answer while waiting for interview answers |

Interview responses include `contentSha256` for the reviewed raw interview bytes. PRD file responses from `/api/files/:ticketId/prd` include `contentSha256` for the returned file content.

Raw and structured interview/PRD saves must send the `contentSha256` value that
was loaded with the draft as `expectedContentSha256`. A missing baseline returns
HTTP `428`; a baseline that no longer matches returns the typed stale-approval
HTTP `409` with the expected and current hashes. The same precondition is
checked before either save mode writes. A post-approval edit holds the existing
ticket planning claim across the durable write, awaited restart, and downstream
invalidation. A competing live writer can therefore receive `409` before
restart work begins; these requests are protected, not all queued for success.
The claim is renewed only for its exact token after awaited stop work, so an
expired holder cannot apply side effects to a successor's edit.

`POST /api/tickets/:id/skip` accepts the same fields as `answer-batch` plus `bulkSkipReason`, so the client can persist already entered answers before skipping the remaining questions. Both routes are strict and validate the same things, but they are separate schemas: sharing one is how a field added for a single route gets silently ignored on the other.

Interview and PRD approval edits are planning-only. After approval, saving an interview edit is allowed while the ticket is still before `PRE_FLIGHT_CHECK`; if PRD or beads planning already exists, LoopTroop archives the current approved interview version and downstream PRD/beads phase attempts, cancels active downstream sessions as intentional cancellation, clears stale downstream artifacts and approval UI state, writes a `user_edit_receipt:interview` artifact, saves and approves the edited interview as the new active version, and starts `DRAFTING_PRD`. Saving a PRD edit follows the same contract for the current approved PRD version and downstream beads attempts, writes `user_edit_receipt:prd`, then starts `DRAFTING_BEADS`.

Archived versions are read-only approved planning generations backed by phase attempts. Once a ticket reaches `PRE_FLIGHT_CHECK` or any later execution-band status, interview and PRD edit saves return `409`. Intentional downstream session aborts during these planning restarts are cancellation, not blocked errors, and existing tickets/projects such as `PCKM-22` are not migrated or repaired.

Current batch-answer payload:

> [!NOTE]
> **Next release behavior.** Batch identity, durable claim recovery, delayed
> timeout fencing, and same-tick answer/skip guarding in this section describe
> the upcoming release.

```json
{
  "batchNumber": 2,
  "answers": {
    "q-auth-1": "Support both password login and SSO."
  },
  "selectedOptions": {
    "q-auth-2": ["option-password", "option-sso"]
  },
  "skipReasons": {
    "q-auth-3": "Already answered in the ticket description."
  }
}
```

`skipReasons` is keyed by question ID and is optional. Each entry must belong to a question the submission will actually skip; a reason attached to a question the user answered returns `400` naming the offending IDs, because it would otherwise record an explanation for a decision nobody made.

`POST /api/tickets/:id/skip` additionally accepts `bulkSkipReason`, a single reason applied only to questions that action skipped and left unexplained. It never overwrites a per-question reason and never reaches an answer submitted in an earlier batch.

`selectedOptions` is checked against the question it answers. An option ID the question does not offer, more than one option on a single-choice question, or any selection at all on a free-text question returns `400` listing what was wrong. Repeated IDs are collapsed rather than rejected.

A ticket processes one answer batch at a time. Both answer and skip submissions carry a positive `batchNumber` for the active batch. A missing or schema-invalid `batchNumber` returns `400`; a valid but stale batch number returns `409`, both before claim acquisition or mutation. Unknown question, option, or skip-reason IDs return `400`. A submission that arrives while one is still in flight returns `409` and changes nothing. The claim is recorded in the project database rather than daemon memory, so two daemons opened on one project cannot both accept the same submission. A foreign claim can be reclaimed after its ordinary lease expires—the fallback even when liveness cannot be checked—or when its recorded PID is proven gone; a live lease protects live, invalid, or otherwise unverified owners. A pending-stop marker is separate non-expiring safety ownership and cannot be bypassed by lease expiry. A timeout that cannot confirm its remote stop restores the durable current batch and keeps it retryable. The marker carries the exact claim token observed before the remote await, so a delayed callback cannot promote a newer generation. `POST /api/tickets/:id/skip` takes the same claim and returns the same `409`: skipping the remaining questions rewrites the interview session and moves the ticket on, so a batch still running underneath cannot overwrite that transition.

Possible `answer-batch` response shapes:

`202 { "accepted": true }` means the user answers were accepted and asynchronous AI processing is continuing in the background. A non-complete batch response keeps the ticket in `WAITING_INTERVIEW_ANSWERS` with another batch to answer. When `isComplete` is `true`, the backend dispatches interview completion and the workflow advances to coverage.

```json
{
  "accepted": true
}
```

```json
{
  "questions": [
    {
      "id": "q-auth-3",
      "question": "What session lifetime should SSO tokens use?",
      "type": "free_text"
    }
  ],
  "progress": {
    "current": 4,
    "total": 8
  },
  "isComplete": false,
  "isFinalFreeForm": false,
  "aiCommentary": "Need one more clarification about session lifetime.",
  "batchNumber": 2,
  "source": "coverage",
  "roundNumber": 1
}
```

Structured interview-answer approval payload:

```json
{
  "questions": [
    {
      "id": "q-auth-1",
      "answer": {
        "skipped": false,
        "selected_option_ids": [],
        "free_text": "Support password login and SSO."
      }
    }
  ]
}
```

Edit-answer payload:

```json
{
  "questionId": "q-auth-1",
  "answer": "Support password login and SSO."
}
```

### Execution Setup Plan Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/execution-setup-plan` | Read the current setup plan |
| `POST` | `/api/tickets/:id/edit-execution-setup-plan` | Return a blocked workspace runtime setup to setup-plan approval |
| `PUT` | `/api/tickets/:id/execution-setup-plan` | Save setup plan as raw content or structured plan |
| `POST` | `/api/tickets/:id/regenerate-execution-setup-plan` | Persist regeneration input and enter setup-plan drafting |

Execution setup plan read response:

```json
{
  "exists": true,
  "artifactId": 42,
  "updatedAt": "2026-04-23T09:00:00.000Z",
  "contentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "raw": "{\"schemaVersion\":1,\"ticketId\":\"AUTH-12\",\"artifact\":\"execution_setup_plan\",\"status\":\"draft\",\"summary\":\"Prepare the workspace before implementation.\"}",
  "plan": {
    "schemaVersion": 1,
    "ticketId": "AUTH-12",
    "artifact": "execution_setup_plan",
    "status": "draft",
    "summary": "Prepare the workspace before implementation.",
    "readiness": {
      "status": "ready",
      "actionsRequired": false,
      "evidence": ["Dependencies are already installed."],
      "gaps": []
    },
    "tempRoots": [".looptroop/worktrees/AUTH-12"],
    "workspaceInputs": [],
    "workspaceProbes": [
      {
        "id": "workspace-test",
        "command": "npm test -- --runInBand",
        "purpose": "Prove the repository test runner can load the project."
      }
    ],
    "gitHooks": {
      "policy": "validate_advisory",
      "detected": [
        {
          "name": "pre-commit",
          "path": ".husky/pre-commit",
          "source": "core.hooksPath",
          "executable": true,
          "managerHint": "husky"
        }
      ],
      "validationCommands": []
    },
    "steps": [
      {
        "id": "setup-1",
        "title": "Install dependencies",
        "purpose": "Ensure commands run with the expected packages.",
        "commands": ["npm install"],
        "required": true,
        "rationale": "The project uses npm scripts for verification.",
        "cautions": ["Do not update unrelated dependencies."]
      }
    ],
    "projectCommands": {
      "prepare": ["npm install"],
      "testFull": ["npm test"],
      "lintFull": ["npm run lint"],
      "typecheckFull": ["npm run typecheck"]
    },
    "qualityGatePolicy": {
      "tests": "Run targeted tests first, then the full suite before handoff.",
      "lint": "Run the project linter after code changes.",
      "typecheck": "Run TypeScript typecheck after code changes.",
      "fullProjectFallback": "If targeted checks are inconclusive, run all required project checks."
    },
    "cautions": ["Keep generated artifacts out of source control."]
  }
}
```

Execution setup plan reads may select archived versions with `phaseAttempt`. Drafting attempts preserve the generated candidate, generation report, and diagnostics; approval attempts hold the separately published, potentially user-edited copy used by runtime setup. Archived reads stay available, but explicit writes to non-current phase attempts return `409` because archived versions are read-only. Invalid `phaseAttempt` values return `400`. Successful manual saves write `user_edit_receipt:execution_setup_plan`.

Successful `PUT /execution-setup-plan` responses return the saved `raw`, normalized `plan`, `contentSha256`, and current route state (`status`, `state`, `ticket`) so the client does not need an immediate follow-up fetch.

`workspaceInputs`, `workspaceProbes`, and `gitHooks.validationCommands` are ordered editable lists. Each workspace input contains `path`, `kind`, `sourceStatus`, and `reason`; the server checks it against the original checkout before accepting the plan. `gitHooks.detected` is refreshed from repository/Git evidence and cannot be changed through the plan editor. `gitHooks.policy` is also backend-authoritative: both raw and structured saves replace an attempted policy edit with the ticket's locked project value. An empty validation-command list is valid; no waiver field or secondary confirmation is required.

`PUT /execution-setup-plan` and `POST /regenerate-execution-setup-plan` are normally accepted only while the ticket is in `WAITING_EXECUTION_SETUP_APPROVAL`. A manual save stays at approval. Regeneration parses the request before entering the ticket lock, then re-reads the current ticket and status under that lock. It durably preserves the commentary plus the supplied structured or raw baseline, archives the current drafting/approval attempts, creates fresh attempts, and immediately returns `GENERATING_EXECUTION_SETUP_PLAN`; a stale or competing request is rejected rather than silently losing content. The runner later publishes the new plan/report into approval through normal artifact, log, and SSE updates. The request reference survives backend restart and blocked-error retry so one requested version is neither lost nor duplicated.

Both routes are also accepted from `PREPARING_EXECUTION_ENV` as a runtime rewind. LoopTroop stops active runtime setup, archives the relevant setup-plan/runtime attempts, clears stale setup profile/runtime outputs, and preserves `.ticket/runtime/execution-setup/tool-cache`. Manual editing uses the `execution_setup_runtime_rewind` archival reason and returns directly to `WAITING_EXECUTION_SETUP_APPROVAL` with the supplied plan. Regeneration uses `execution_setup_runtime_regenerate`, enters `GENERATING_EXECUTION_SETUP_PLAN`, and returns to approval only after the fresh version is produced. These routes still reject from `CODING` and later statuses. Host or Git-hook evidence refresh during approval remains in `WAITING_EXECUTION_SETUP_APPROVAL` because it updates the existing plan without model generation.

Regeneration payload:

```json
{
  "commentary": "Tighten the temp-root cleanup steps and add the full lint command.",
  "plan": {
    "schemaVersion": 1,
    "ticketId": "AUTH-12",
    "artifact": "execution_setup_plan",
    "status": "draft",
    "summary": "Prepare the workspace before implementation.",
    "readiness": {
      "status": "ready",
      "actionsRequired": false,
      "evidence": [],
      "gaps": []
    },
    "tempRoots": [],
    "workspaceInputs": [],
    "steps": [],
    "projectCommands": {
      "prepare": [],
      "testFull": ["npm test"],
      "lintFull": ["npm run lint"],
      "typecheckFull": ["npm run typecheck"]
    },
    "qualityGatePolicy": {
      "tests": "Run full tests before handoff.",
      "lint": "Run lint before handoff.",
      "typecheck": "Run typecheck before handoff.",
      "fullProjectFallback": "Run all required project checks when unsure."
    },
    "cautions": []
  }
}
```

### OpenCode Question Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/opencode/questions` | Aggregate pending OpenCode question requests across active tickets |
| `GET` | `/api/tickets/:id/opencode/questions` | List pending OpenCode question requests |
| `POST` | `/api/tickets/:id/opencode/questions/:requestId/reply` | Submit question answers |
| `POST` | `/api/tickets/:id/opencode/questions/:requestId/reject` | Skip a question request, with an optional reason |
| `POST` | `/api/tickets/:id/opencode/question-timer/stop` | Stop the countdown for a ticket because a person is dealing with it |

`GET /api/tickets/:id/opencode/questions` returns `{ "questions": [...], "timer": ... }`. The aggregate route returns `{ "questions": [...], "timers": {...} }`, keyed by ticket ID, and may also include `{ "errors": [...] }` when some tickets fail question discovery. Each question entry carries a `timerKey` naming the countdown it belongs to; several entries can share one.

Both list routes reconcile against OpenCode before answering. A poll that succeeds prunes anything OpenCode no longer lists and arms a countdown for anything OpenCode has that LoopTroop is not yet tracking. A poll that fails prunes nothing, because an unreachable server is not evidence that a question went away.

> [!NOTE]
> **Next release behavior.** After the browser receives a resolution for a
> question, it keeps that `(sessionId, requestId)` identity closed until a
> successful snapshot omits it. A stale successful response containing the same
> identity cannot reopen the question; a later request with a new identity can
> still appear.

Timer shape, which appears as `timer` on the per-ticket route, as a value in `timers` on the aggregate route, and inside the `needs_input` SSE payload:

```json
{
  "timerKey": "CODING:1",
  "windowMs": 300000,
  "armedAt": "2026-08-28T09:14:02.113Z",
  "deadlineAt": "2026-08-28T09:19:02.113Z",
  "stoppedAt": null,
  "stoppedBy": null,
  "resetCount": 0,
  "revision": 1,
  "serverNow": "2026-08-28T09:14:31.007Z"
}
```

There is one countdown per `<phase>:<attempt>`, shared by every model asking inside that step, not one per question and not one per request. `resetCount` records how many times a new model arriving pushed a running clock back to full; a stopped clock is never restarted. `revision` increases on every transition, so a late SSE frame cannot undo a newer one. `serverNow` is the server's clock at the moment the state was built, and is what lets a client correct for skew without owning the deadline. A non-null `stoppedAt` means the countdown will never expire.

Reply payload:

```json
{
  "answers": [
    ["yes"],
    ["postgres", "redis"]
  ]
}
```

The outer `answers` array must stay in the same order as the returned `questions` array for that request. Each inner array carries the answer values for one question, which lets multi-select prompts submit more than one string.

Reject payload, where `reason` is optional and capped at 20,000 characters:

```json
{ "reason": "Answered in the ticket description already." }
```

There is deliberately no `skippedBy` field. A client claiming `timeout` would forge a machine decision into the audit trail, so this route always records `user`. A question the wait ran out on is refused by the server under `timeout`, and one refused because a restart could not re-attach its session is refused under `system`.

`POST /api/tickets/:id/opencode/question-timer/stop` takes an empty object and returns `{ "success": true, "timers": [...], "timer": ... }`. Every way of engaging goes through it: switching model tabs, moving between questions, focusing an answer field, and pressing **Stop timer**. It is idempotent, and a second call returns the same state rather than an error. There is no matching resume; the ways out of a stopped countdown are answering and skipping.

Reply, reject, and expiry all race for the same request. Whichever arrives first claims it; a loser gets `409` with `That question was already resolved` while the claim is still in flight, and `404` once the request has been cleared. Neither sends a second verdict for a question that already has one. A reply or reject that fails to reach OpenCode hands its claim back, so the request stays answerable.

See [Configuration → AI Questions](configuration.md#ai-questions) for the settings that decide whether a model may ask and how long it waits.

### Artifact And History Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/artifacts` | List ticket artifacts, optionally filtered |
| `GET` | `/api/tickets/:id/artifacts/manifest` | List lightweight artifact metadata and previews without artifact bodies |
| `GET` | `/api/tickets/:id/artifacts/:artifactId/content` | Read one ticket-isolated artifact body; supports SHA-256 ETags and `304 Not Modified` |
| `POST` | `/api/tickets/:id/artifacts/content/batch` | Read up to 20 artifact bodies, capped at approximately 2 MB of content per response |
| `GET` | `/api/tickets/:id/phases/:phase/attempts` | List phase attempt history |
| `GET` | `/api/tickets/:id/logs` | Read a projected log page; defaults to the newest 20 rows and accepts an older-page cursor |
| `GET` | `/api/tickets/:id/logs/export` | Export the complete matching log history as plain text for Copy all |
| `GET` | `/api/tickets/:id/ai-details` | Aggregate completed AI-turn cost, tokens, and timing for a phase attempt or the ticket lifecycle |
| `GET` | `/api/tickets/:id/skips` | Every skip recorded for the ticket, with counts |

`GET /api/tickets/:id/artifacts` accepts optional `phase` and `phaseAttempt` query filters. When `phaseAttempt` is omitted, the backend resolves the current active attempt for that phase; supplying `phaseAttempt=1` is how clients intentionally read archived planning generations after an edit/retry/regenerate flow.

The manifest route accepts the same filters and returns `{ "artifacts": [...] }`. Every entry includes its identity, phase and attempt, type, timestamps, `contentByteCount`, lowercase `contentSha256`, availability, and a compact scalar preview. It never includes the raw artifact body. Fetch bodies from the content routes after selecting the artifact; batch requests use `{ "artifactIds": [1, 2] }` and return unavailable or byte-budget-deferred IDs in `omittedIds`.

The projected log route accepts `scope=phase|lifecycle`, `view=overview|system|command|ai|error|debug`, optional `phase`, `phaseAttempt`, and `modelId`, `limit=1..500`, and an opaque `before` cursor. When `limit` is omitted, it defaults to 20 so ticket and status views can paint the latest activity quickly; the frontend then requests older cursor pages in batches of up to 250 as the user scrolls upward. Overview excludes command-classified rows before applying the page limit because commands have their own view and are not rendered in ALL. The newest-page response returns chronological `entries`, `olderCursor`, `hasOlder`, cursor-independent `totalEntries`, and `totalTextLines` for the complete matching filter; older cursor pages omit the unchanged totals to avoid repeating the aggregate work. Empty content contributes zero text lines; non-empty content contributes one plus its newline count. These totals are aggregated in SQLite and do not load historical entry bodies into the application or browser. The AI channel includes model-scoped error rows so provider recovery information is also visible beside that model; the same durable event remains available from the ERROR view. Projection catch-up reads unindexed JSONL suffixes cooperatively and deduplicates concurrent catch-up requests; it does not change the live SSE or durable log-writing paths.

> [!NOTE]
> **Next release behavior.** Complete `DEBUG` history and export use the full
> available native OpenCode history, including older files beyond the bounded
> diagnostic defaults. Initial pages remain bounded; Go to top, bead navigation,
> and complete exports perform action-triggered full drains. A native cursor
> that falls outside the four retained snapshots returns HTTP `409` with
> `code: "LOG_CURSOR_EXPIRED"`; it is never returned as a silently partial
> page. Complete metadata, read, and index failures surface to the caller.

Native history keeps stable file/line identities through JSON serialization and
uses incremental index ranges for appends. A cold or previously unseen session
still scans the needed file prefix, and upstream-deleted files cannot be
recovered. Returned native rows are bounded by the page `LIMIT`, while lineage
visibility checks grow with ancestry depth; the route does not promise constant
total query work or a bounded archive.

The newest-page response includes `modelIds`: sorted distinct model IDs across the requested ticket, phase, attempt, and bead scope, independent of `view`, `modelId`, and the page limit. Older pages omit this metadata with the totals. AI history includes attributed system milestones and matches source-only model identity when no explicit model ID exists. Missing audience and kind fields are inferred before indexing with the same rules used by raw log reads, so plain model output remains in ALL counts, pages, and exports. Sparse OpenCode session rows retain their session kind for activity detection. Explicit source, audience, and kind fields take precedence. AI history also recovers entries saved only in the AI file when the normal-file append was interrupted, deduplicating mirrored copies before pagination, counts, and exports. Repeated anonymous appends remain distinct; canonical updates use the latest surviving revision. AI history sorts by timestamp with a stable logical-entry tie-breaker; other views retain file order. Cursors remain opaque and must be reused with the same scope and filter.

`GET /api/tickets/:id/ai-details` accepts `scope=phase|lifecycle` and an optional `modelId`. Phase scope requires `phase`; `phaseAttempt` selects an archived attempt or defaults to the active attempt using the same resolver as phase logs. Lifecycle scope ignores phase boundaries. The response contains completed turn/session counts, nullable cost and token aggregates, nullable total/average/longest duration, per-metric reporting coverage, and `updatedAt`. A nullable aggregate means OpenCode did not report that metric; it is not equivalent to zero.

`GET /api/tickets/:id/skips` returns the append-only skip trail for a ticket, oldest first, with optional `phase` and comma-separated `surfaces` filters. An unknown surface returns `400`. It is deliberately not filtered by phase attempt: the artifact routes hide archived attempts, which is right for what a phase is working from and wrong for an audit trail, because a receipt from a retried attempt is still a decision somebody made. Each event carries its receipt and action IDs, surface, item, phase and attempt, timestamp, reason, and whether a later action on the same item superseded it. `counts` reports actions and items separately, so a forty-question Skip All is one action and forty items rather than forty-one skips.

Every event also carries `skippedBy`, one of `user`, `timeout`, or `system`. Receipts written before this field existed report `user`, which is what they meant: a person was the only actor there was. Events on the `opencode_question` surface additionally carry `questionContext` with the request and session IDs, the asking model, the question count, the configured `window_ms`, `armed_at` and `deadline_at`, `reset_count`, `stopped_at` / `stopped_by`, `elapsed_wall_ms` and `elapsed_active_ms`, the `sibling_request_ids` the same refusal covered, an `expiry_reason`, and a `quorum_impact` line when the refusal cost a council round its quorum. `elapsed_active_ms` is wall time minus what the wait credited back, so a question that ran its full window reports zero: the wait cost the step nothing.

```json
{
  "ticketId": "1:LOOP-42",
  "events": [
    {
      "receiptId": "skip-4f2a91c0d3b57e68",
      "actionId": "interview_all-9c1d0f2b7a4e6851",
      "parentActionId": null,
      "surface": "interview_all",
      "itemId": "Q07",
      "itemType": "interview_question",
      "isActionSummary": false,
      "phase": "WAITING_INTERVIEW_ANSWERS",
      "phaseAttempt": 1,
      "skippedAt": "2026-08-27T10:14:02.113Z",
      "reason": "Already answered in the ticket description.",
      "supersedes": null,
      "superseded": false
    }
  ],
  "counts": {
    "actions": 1,
    "items": 2,
    "itemsWithReason": 1,
    "itemsWithoutReason": 1
  }
}
```

```json
{
  "scope": "phase",
  "phase": "CODING",
  "phaseAttempt": 1,
  "modelId": "openai/gpt-5.4",
  "summary": {
    "turns": 3,
    "sessions": 1,
    "costUsd": 0.089462,
    "tokens": {
      "total": 45479,
      "input": 43117,
      "output": 409,
      "reasoning": 33,
      "cacheRead": 1920,
      "cacheWrite": 0
    },
    "timingMs": {
      "total": 8421,
      "average": 2807,
      "longest": 4210
    },
    "coverage": {
      "costTurns": 3,
      "tokenTurns": 3,
      "timingTurns": 3
    }
  },
  "updatedAt": "2026-07-23T12:00:00.000Z"
}
```

Example artifact list item:

```json
{
  "id": 84,
  "ticketId": "1:AUTH-12",
  "phase": "WAITING_PRD_APPROVAL",
  "phaseAttempt": 1,
  "artifactType": "approval_receipt",
  "filePath": null,
  "content": "{\"content_sha256\":\"...\"}",
  "createdAt": "2026-04-23T09:00:00.000Z",
  "updatedAt": "2026-04-23T09:00:00.000Z"
}
```

Example phase-attempt list item:

```json
{
  "ticketId": "1:AUTH-12",
  "phase": "WAITING_PRD_APPROVAL",
  "attemptNumber": 2,
  "state": "active",
  "archivedReason": null,
  "createdAt": "2026-04-23T09:00:00.000Z",
  "archivedAt": null
}
```

Ticket list and detail responses include a cleanup summary derived from the latest `cleanup_report` artifact:

```json
{
  "cleanup": {
    "status": "warning",
    "errorCount": 2,
    "latestReportArtifactId": 123
  }
}
```

`cleanup.status` is `clean`, `warning`, or `null`. Cleanup warnings do not change the ticket's terminal `COMPLETED` status.

## File Routes

These routes are intentionally narrow.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/files/:ticketId/logs` | Read folded normal execution logs from `.ticket/runtime/execution-log.jsonl` |
| `GET` | `/api/files/:ticketId/logs?channel=debug` | Read folded debug/forensic execution logs from `.ticket/runtime/execution-log.debug.jsonl`; the same `status`, `phase`, and `phaseAttempt` filters apply |
| `GET` | `/api/files/:ticketId/logs?channel=ai` | Read folded AI detail logs from `.ticket/runtime/execution-log.ai.jsonl`; loaded by AI/model log views |
| `GET` | `/api/files/:ticketId/logs?channel=all` | Merge all three LoopTroop log files plus OpenCode native server log lines filtered by the ticket's session IDs; used by the DEBUG tab to show every log line |
| `GET` | `/api/files/:ticketId/:file` | Only `interview` or `prd`; returns `{ content, exists }` and adds `contentSha256` when the file exists |
| `PUT` | `/api/files/:ticketId/:file` | Only `interview` or `prd`; delegates to the dedicated interview/PRD save handlers rather than exposing a generic file write route |
| `POST` | `/api/files/open-path` | Reveal a file or folder in the user's native file explorer; file paths open their containing folder |

Log routes accept optional `status`, `phase`, and `phaseAttempt` filters. The same filters apply to the default normal log channel, `channel=debug`, and `channel=ai`. The `channel=all` endpoint merges and deduplicates entries from all channels server-side, then sorts by timestamp. OpenCode native server rows are included only for the ticket's known session IDs, and once included they go through the same normalization and `status`/`phase`/`phaseAttempt` filters as the file-backed rows. Matching completed log entries are returned from the durable log files without an entry-count cap; streaming partial upserts are folded so the UI receives the latest completed or current streaming row for each stable entry. Live `log` and `state_change` SSE payloads carry the resolved `phaseAttempt` used for the durable JSONL row so active multi-attempt phase views can keep streaming while filtering to the selected attempt.

When `GET /api/files/:ticketId/:file` cannot find the requested artifact file, it returns:

```json
{
  "content": "",
  "exists": false
}
```

`POST /api/files/open-path` expects:

```json
{
  "path": "/absolute/path/to/file-or-folder"
}
```

Path validation is strict. The supplied path must be absolute, must already exist, and after canonical real-path resolution must remain inside either an attached project root or the LoopTroop application configuration directory. Authorization is containment-based, not string-prefix-based, so symlink aliases and alternate spellings are resolved before the route decides whether the path is allowed.

LoopTroop resolves file targets to their containing directory before launch. It then re-checks the resolved target and refuses it with HTTP `400` if it disappeared, became a symlink, escaped containment, or otherwise changed between validation and launch. Invalid request bodies and refused paths therefore return `400` JSON errors rather than partial success. Unexpected opener failures return `500` with `{ "error": "Failed to open path", "details": "..." }`.

Before launch, LoopTroop resolves the platform opener through its trusted executable resolver rather than blindly running the first checkout-controlled `PATH` hit. On WSL it uses trusted `wslpath` plus `powershell.exe` with `explorer.exe` fallback; on Windows it uses `explorer.exe`; on macOS `open`; on Linux `xdg-open`.

There is no generic filesystem browser or arbitrary file read route under `/api/files`.

## Bead Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/beads` | Read bead plan; accepts optional safe relative `?flow=` |
| `GET` | `/api/tickets/:id/beads/raw` | Read the exact stored JSONL plus parsed items and line diagnostics; accepts optional safe relative `?flow=` |
| `PUT` | `/api/tickets/:id/beads` | Replace bead plan only while the ticket is in `WAITING_BEADS_APPROVAL`; accepts optional safe relative `?flow=` |
| `GET` | `/api/tickets/:id/beads/:beadId/diff` | Read diff artifact for a bead |

The `flow` value must be a safe relative branch/flow name. Absolute paths, backslashes, `.` segments, and `..` traversal segments are rejected. When `flow` is omitted, the route falls back to the ticket's base branch.

Both read routes expose the canonical on-disk plan hash through `X-Content-Sha256`, even when the tracker is empty or damaged. `GET /api/tickets/:id/beads` returns every row that parsed successfully, not an all-or-nothing failure, and can therefore succeed even when other JSONL lines are malformed or cannot be represented as editable bead objects. The route reports those file-line diagnostics through:

- `X-Malformed-Line-Count` / `X-Malformed-Lines` for lines that did not parse as JSON
- `X-Unrepresentable-Line-Count` / `X-Unrepresentable-Lines` for lines that parsed as JSON but are not representable bead rows

The `...-Count` headers are exact. The `...-Lines` headers list file line numbers, counting blank lines, and are capped to the first 50 numbers so a badly damaged tracker does not overflow response headers.

`GET /api/tickets/:id/beads/raw` returns the repair-oriented payload below. `content` is the exact stored JSONL bytes, while `items` contains only the rows that parsed:

```json
{
  "content": "{\"id\":\"B-1\"}\n{\"id\": \"B-2\", \n",
  "items": [{ "id": "B-1" }],
  "malformedLines": [2],
  "unrepresentableLines": []
}
```

The JSONL editor may send `X-Source-Lines` with one comma-separated file line for
each edited row. The server requires exactly one strictly increasing positive
safe integer per row, then keeps the mapping as diagnostic metadata only. It
does not use that header to invent or rewrite source text. Unknown top-level and
dependency keys survive canonicalization and save.

Each bead's `testCommands` field is a `CommandSpec[]`. A process command carries
an explicit `mode`, `program`, and `args`; a shell command carries an explicit
`mode`, `shell`, and `script`, with optional repository-relative `cwd`, `env`,
and timeout fields. A bare command string is not inferred into a shell command.

`PUT /api/tickets/:id/beads` rewrites the tracker atomically only while the ticket is in `WAITING_BEADS_APPROVAL`. On the first write to a missing tracker no concurrency hash is required. When a tracker already exists, the request must include `X-Content-Sha256` from the read it was built on; missing it returns `428`, and a stale hash returns `409` with both the expected and current hashes. Manual saves write `user_edit_receipt:beads`, record `X-Edit-Surface` as `jsonl` only when the client sent exactly that value, and otherwise record the `structured` surface. The input alias `dependencies.blockedBy` is normalized to canonical `dependencies.blocked_by`; the server derives `blocks` from those authoritative edges and rejects dangling references or cycles before writing. `GET /api/tickets/:id/beads/:beadId/diff` returns `{ "diff": "", "captured": false }` when no diff artifact exists yet.

Read-only ticket projections retain valid bead rows when the JSONL file is
damaged and expose the affected lines through `runtime.beadsDiagnostics`. The
board and workspace display a repair warning and suppress completion summaries
while those diagnostics are present.

## SSE Events

The stream endpoint emits two categories of events:

**Stream control events** — sent directly by the stream handler, not through the broadcaster:

| Event type | When emitted | Key payload fields |
| --- | --- | --- |
| `connected` | The SSE connection is established | `ticketId`, `clientId`, `timestamp` |
| `heartbeat` | Every 30 seconds while the connection stays open | `timestamp` |
| `replay_gap` | The requested replay cursor cannot be used | `ticketId`, `reason` (`invalid_cursor` or `cursor_unavailable`); sent with an empty SSE `id:` to reset cursor state |

**Typed ticket events** — broadcast through `server/sse/broadcaster.ts` and defined in `server/sse/eventTypes.ts`:

| Event type | When emitted | Key payload fields |
| --- | --- | --- |
| `state_change` | Ticket transitions between workflow phases | `ticketId`, `from`, `to`, `phaseAttempt`, `previousStatus` |
| `log` | A new execution log entry is written | flat `LogEvent` fields: `ticketId`, `type`, `content`, `kind`, `op`, `phase`, `entryId`, … (no `logEntry` wrapper) |
| `bead_complete` | A single bead finishes execution | `ticketId`, `beadId`, `title`, `completed`, `total` |
| `needs_input` | A pending question or interview batch needs the user | `ticketId`, `type`, plus a shape that varies by source (interview batch: `batch`; OpenCode question: `requestId`, `questions`, `answers`, `tool`, …) |
| `artifact_change` | A phase artifact is created or updated | `ticketId`, `phase`, `artifactType`, `artifact` |
| `ai_metrics` | Completed assistant-turn metrics were recorded | `ticketId`, `phase`, `phaseAttempt`, `modelId`, `updatedAt` |

`needs_input` carries three OpenCode question shapes, told apart by `type`:

| `type` | When | Added fields |
| --- | --- | --- |
| `opencode_question` | A model asked | `action: "asked"`, `sessionId`, `requestId`, `questions`, `questionCount`, `phase`, `modelId`, `tool` |
| `opencode_question_updated` | The countdown was armed, reset, or stopped | `timer`, `requests`, `phase`, `phaseAttempt` |
| `opencode_question_resolved` | A request was answered or refused | `action: "replied"` or `"rejected"`, `requestId`, `sessionId`, and on a refusal `resolution` (`user_skipped`, `window_elapsed`, `ticket_canceled`, `session_lost`, `daemon_restart`) plus `rejectFailed` when OpenCode could not be told |

`timer` uses the shape shown under [OpenCode Question Routes](#opencode-question-routes). `requests` lists every request still outstanding on that countdown, each with its `sessionId`, `requestId`, `memberId`, `questions`, `questionCount`, and `timerKey`. Both are additive; the fields the browser already read are unchanged.

The compatibility event-name contract still includes `progress` and `app_error`, and frontend hooks understand them, but this page documents only the events the current backend emits.

SSE replay is an optimization, not the only recovery path. After a reconnect with a remembered event id, the frontend also invalidates the ticket, list, artifacts, interview, setup-plan, bead, and server-log queries so missed events outside the replay buffer are reconciled from durable storage.

Example `state_change` event payload:

```json
{
  "ticketId": "1:AUTH-12",
  "from": "DRAFTING_PRD",
  "to": "WAITING_PRD_APPROVAL",
  "phaseAttempt": 1,
  "previousStatus": "VERIFYING_PRD_COVERAGE",
  "timestamp": "2026-04-23T09:00:00.000Z"
}
```

Example `bead_complete` event payload:

```json
{
  "ticketId": "1:AUTH-12",
  "beadId": "session-store-foundation",
  "title": "Session store foundation",
  "completed": 3,
  "total": 8
}
```

Example `log` event payload (flat `LogEvent`, no wrapper):

```json
{
  "ticketId": "1:AUTH-12",
  "type": "session",
  "kind": "session",
  "op": "append",
  "phase": "CODING",
  "entryId": "log-1742839200-001",
  "content": "Bead session-store-foundation started (iteration 1)"
}
```

Example `artifact_change` event payload:

```json
{
  "ticketId": "1:AUTH-12",
  "phase": "CODING",
  "artifactType": "bead_diff:api-refresh-endpoint",
  "artifact": {
    "id": 84,
    "ticketId": "1:AUTH-12",
    "phase": "CODING",
    "phaseAttempt": 1,
    "artifactType": "bead_diff:api-refresh-endpoint",
    "filePath": null,
    "content": "diff --git a/server/routes/auth.ts b/server/routes/auth.ts\n...",
    "createdAt": "2026-04-23T09:00:00.000Z",
    "updatedAt": "2026-04-23T09:00:00.000Z"
  },
  "timestamp": "2026-04-23T09:00:00.000Z"
}
```

## Related Docs

- [Frontend](frontend.md)
- [OpenCode Integration](opencode-integration.md)
- [Ticket Flow & State Machine](ticket-flow.md)
- [System Architecture](system-architecture.md)
