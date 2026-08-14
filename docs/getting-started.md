# Getting Started

Welcome to LoopTroop! This guide takes you from zero to your first AI-driven development cycle.

> [!TIP]
> You don't need expensive API keys to get started. LoopTroop supports free-tier models from OpenRouter, NVIDIA NIM, or OpenCode — see [Setting Up Your AI Council](#4-setting-up-your-ai-council) below.

## 1. Prerequisites

You need a few basic developer tools:

- **Node.js** and **npm**
- **Git**
- A local git repository with an `origin` pointing to GitHub
- **[OpenCode](https://opencode.ai)** installed locally with at least one configured provider (v1 for now, v2 coming soon).

### Why a VM?

LoopTroop runs OpenCode in `dangerously-skip-permissions` (or YOLO) mode so that long-running autonomous tasks can proceed without human prompts. This means the agent executes with your local user privileges — and AI agents are not perfect.

> [!WARNING]
> **Run LoopTroop inside a disposable VM, cloud dev machine, or sandboxed environment.**
>
> Git worktrees protect your repository checkout, but they do not sandbox command execution. A bad generation could delete system folders, corrupt configs, or break your workspace. Worktrees protect code; a VM protects everything else.

## 2. Installation

```bash
npm install -g looptroop
```

That is the whole installation. LoopTroop is also on Homebrew, Scoop, bun, pnpm
and Docker, and publishes a standalone executable that carries its own Node
runtime — see [Installation](installation.md) for every channel, and for
upgrading, uninstalling and verifying a download.

## 3. Starting the Application

```bash
looptroop start
looptroop open
```

`start` detaches from the terminal, so LoopTroop keeps running after the shell
closes. It serves the interface and the API from **one address on port 3000** —
there is no separate web server to configure. `open` points a browser at it.

What `open` prints is a **signed-in link**: a URL carrying a single-use code in
its fragment, which the browser exchanges for a session cookie. The fragment is
never sent in a request line, so it cannot reach an access log, and there is no
password to set. Sessions last 12 hours; run `looptroop open` again when one
ends.

| | Address |
| --- | --- |
| **LoopTroop** (interface and API) | `http://127.0.0.1:3000` |
| **OpenCode** | `http://127.0.0.1:4096` |
| **Docs** | `https://www.looptroop.ovh/docs/` (hosted externally) |

> [!IMPORTANT]
> If OpenCode is running on a different port, point LoopTroop to it:
> `export LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:YOUR_PORT`

The daemon binds loopback only, and will not bind wider by omission — see
[Configuration](configuration.md) for the two variables that change that and the
token they require.

```bash
looptroop status    # is it running?
looptroop logs -f   # what is it doing?
looptroop doctor    # can this machine run it?
looptroop stop
```

The full command list is in the [CLI Reference](cli.md).

::: details Not sure the machine is ready?

`looptroop doctor` checks Node, git, OpenCode, the port and the daemon, and tells
you which of those is missing rather than failing at the first ticket. It also
names the channel this copy was installed from and the exact command that
upgrades it. See [Runtime Diagnostics](diagnostics.md).
:::

## 4. Setting Up Your AI Council

LoopTroop works best with multiple AI models — they draft, vote on, and refine plans together before any code is written. You can configure your council models inside the app via the **Configuration** button on the dashboard.

You need at least a **Main Implementer Model** (which writes and validates code) and **1–9 additional Council Members** (which challenge and improve the plan), for a maximum council size of ten. See [Configuration](configuration.md) for all settings and trade-offs.

### Choosing Your Main Implementer

The Main Implementer is the model that actually writes, fixes, and validates your code — it needs to be the strongest model you can access. Pick a frontier-class model with strong coding benchmarks:

- **OpenAI** — top models via API key or a Codex subscription through OpenCode
- **Anthropic** — latest Claude models via API key
- **Google** — latest Gemini model via API key
- **Any other top-tier model** — check the [Chatbot Arena leaderboard](https://lmarena.ai/) or coding-specific benchmarks like SWE-bench to find the current best performers

Council members can be a mix of different providers — diversity actually improves plan quality since different models catch different blind spots (it is recommended to use models from different providers and families for the council). You can also experiment with weaker models in the council to save costs — they still provide value by catching basic mistakes and asking clarifying questions.

### Free Model Options

You don't need paid API keys to get started. Here are three ways to access free models:

#### OpenRouter (Recommended)

OpenRouter provides a unified API with a dynamic router that selects available zero-cost models.

1. Create a free account at [openrouter.ai](https://openrouter.ai/).
2. Open OpenCode and connect to OpenRouter using your API key.
3. In LoopTroop, set your model to `openrouter/free` — it automatically routes to available free models capable of tool-calling. You can also pick specific models from the catalog; they rotate every few days.

#### NVIDIA NIM API

NVIDIA provides GPU-accelerated endpoints. Signing up gives you 1,000 base credits (up to 5,000 trial credits).

1. Create a Developer account at [build.nvidia.com](https://build.nvidia.com/).
2. Generate a personal key in the API Keys section and connect it to OpenCode.

#### OpenCode Go

OpenCode curates models benchmarked for agentic coding, more details at [OpenCode docs](https://opencode.ai/go).

::: details Latency & model tracking tools

Free APIs can experience rate-limiting or latency spikes. Community trackers help you route efficiently:

- **[free-ai-tools](https://github.com/ShaikhWarsi/free-ai-tools)** — master directory of 550+ free APIs, IDEs, and local RAG stacks.
- **[ClawRouter](https://github.com/BlockRunAI/ClawRouter)** — open-source routing layer tracking real-time free model latency with load balancing.
- **[frouter](https://github.com/jyoung105/frouter)** — CLI tool to ping free models and test Time To First Token (TTFT) before starting your loop.
:::

## 5. Attaching Your First Project

1. Open the interface with `looptroop open`.
2. Click **Add Project** and provide the absolute path to your local git repository.
3. LoopTroop verifies it is a valid git repo with a GitHub origin.
4. If the repository already has a `.looptroop` state folder, choose whether to restore everything, keep the project settings while clearing all tickets, or delete that state and start fresh. The two destructive choices show exactly what will be deleted and require confirmation.
5. Create your first **Ticket** with a description of the feature or fix you want.

> [!WARNING]
> Clearing tickets or starting fresh also removes active ticket data, artifacts, logs, and managed worktrees. It does not delete repository source files, commits, or branches. Clearing tickets resets numbering, so the next ticket starts at `<SHORTNAME>-1` and can reuse an identifier found on an older surviving branch.

Once submitted, LoopTroop kicks off an **interview phase** to clarify your intent, then generates a structured spec and implementation plan before any code is written. You review and approve at each gate.

## What Happens After Your First Ticket?

Your ticket flows through a structured pipeline — each stage has a clear purpose and a human review gate:

1. **Interview** — the AI council asks targeted questions to clarify ambiguities in your request.
2. **PRD** — your answers are synthesized into a structured spec with epics, user stories, and implementation steps.
3. **Beads** — the spec is decomposed into the smallest independently implementable units of work.
4. **Execution** — each bead is coded, tested, and retried in an isolated worktree until it passes.
5. **Review** — you inspect the final diff, commits, and changes before merging.

For the full lifecycle, see [Ticket Flow](ticket-flow.md).

## Working on LoopTroop itself

Everything above installs LoopTroop to use it. To develop LoopTroop, run it from
a checkout instead — this is the development stack, with Vite on port 5173 and
hot reload, not the installed service:

```bash
git clone https://github.com/looptroop-ai/LoopTroop.git
cd LoopTroop
npm run dev
```

One command starts the frontend, backend and OpenCode watcher; you do not need to
start OpenCode manually. On first run it also handles dependency installation and
daily maintenance.

| Service | Address |
| --- | --- |
| **Frontend** (UI) | `http://localhost:5173` |
| **Backend** (API) | `http://127.0.0.1:3000` |
| **OpenCode** | `http://127.0.0.1:4096` |

::: details What happens during startup?

The preflight handles dependency updates, security audit fixes, OpenCode CLI updates, and port checks. Dependency proposals must pass npm's normal peer resolution before they can change the checkout; incompatible releases are held rather than forced. Normal startup prints a short summary of every updated package (previous → new version) and releases held by the age or compatibility gates.

For the full preflight specification, see [Operations Guide](operations.md).
:::

::: details Useful startup flags

- **`npm run dev --opencode-logs=all`** — full OpenCode DEBUG logs in your terminal (starts OpenCode with `--print-logs --log-level DEBUG`).
- **`npm run dev --lan`** — binds the frontend to the local network, prints LAN URLs and a QR code. Backend and OpenCode stay on loopback, while documentation links continue to use the hosted site. This way you can connect to the app via mobile or another computer on the same network.

For non-mutating startup, forced maintenance, and manual maintenance commands, see [Operations Guide](operations.md).
:::

## Next Steps

- [Installation](installation.md) — every channel, upgrading, uninstalling, verifying a download
- [CLI Reference](cli.md) — every command and option
- [Ticket Flow](ticket-flow.md) — end-to-end lifecycle from ticket to PR
- [Ticket Lifecycle Screenshots](ticket-lifecycle-screenshots.md) — visual walkthrough of every workflow status
- [Core Philosophy](core-philosophy.md) — context engineering, councils, retries, approvals
- [Configuration](configuration.md) — all profile settings with defaults, ranges, and trade-offs
- [Operations Guide](operations.md) — runtime storage, environment variables, startup maintenance, diagnostics, and troubleshooting

## Is LoopTroop Right For Your Task?

Before you start, it helps to know what LoopTroop is built for — and what it is not.

LoopTroop is at its best for:

- **Mid-size and large feature work** where planning and correctness are paramount.
- **Overnight or multi-hour runs** designed to run unattended while you sleep.
- **Traceable planning artifacts** stored as durable local specs.
- **Recoverable execution** using isolated worktrees and fresh-session retry logic.
- **Explicit delivery outcomes** with strict human approval gates.

It is **not** a magic autopilot, and it is the wrong tool for:

- **One-shot trivial edits** or quick fixes, where the planning overhead will feel slow.
- **Chat-first exploratory coding** — traditional IDE-based chat assistants are better suited here.
- **Unbounded autonomous runs** without explicit human checkpoints.
- **Cost-sensitive budgets** — orchestrating multi-model councils and long retry loops uses a high volume of API tokens, though costs can be mitigated by leveraging subscription plans or free-tier providers in OpenCode (see [Free Model Options](#free-model-options) above).
- **A secure sandbox** — it does not replace process isolation, filesystem policy, or host-level blast-radius reduction. Always run in a disposable VM or cloud container (see [Why a VM?](#why-a-vm) above).
