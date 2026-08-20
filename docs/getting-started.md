# Getting Started

Welcome to LoopTroop! This guide takes you from zero to your first AI-driven development cycle.

> [!TIP]
> You don't need expensive API keys to get started. LoopTroop supports free-tier models from OpenRouter, NVIDIA NIM, or OpenCode — see [Setting Up Your AI Council](#4-setting-up-your-ai-council) below.

## 1. Prerequisites

Two things every channel needs, because none of them install it for you:

- **[OpenCode](https://opencode.ai)** with at least one configured provider.
  LoopTroop starts one if it is on your PATH and adopts one you are already
  running, but it will not install it, and refuses to start with no OpenCode to
  reach.
- A local git repository with an `origin` pointing to GitHub.

**Everything else depends on how you install it** — Homebrew and Scoop bring
their own Node, git and `gh`, while npm, bun and pnpm expect you to have them.
Each tab in the next section states its own requirements, so you only read the
one you are using.

### Why a VM?

LoopTroop runs OpenCode in `dangerously-skip-permissions` (or YOLO) mode so that long-running autonomous tasks can proceed without human prompts. This means the agent executes with your local user privileges — and AI agents are not perfect.

> [!WARNING]
> **Run LoopTroop inside a disposable VM, cloud dev machine, or sandboxed environment.**
>
> Git worktrees protect your repository checkout, but they do not sandbox command execution. A bad generation could delete system folders, corrupt configs, or break your workspace. Worktrees protect code; a VM protects everything else.

## 2. Installation

Pick one. Each tab says what it needs beyond the command itself.

::: code-group

```bash [curl]
curl -fsSL https://www.looptroop.ovh/install | sh
```

```powershell [irm]
irm https://www.looptroop.ovh/install.ps1 | iex
```

```bash [npm]
npm install -g looptroop
```

```bash [Homebrew]
brew install looptroop-ai/tap/looptroop
```

```powershell [Scoop]
scoop bucket add looptroop https://github.com/looptroop-ai/scoop-bucket
scoop install looptroop
```

```bash [bun]
bun add -g looptroop
```

```bash [pnpm]
pnpm add -g looptroop
```

```bash [Yarn]
yarn global add looptroop
```

```bash [Docker]
docker pull looptroopai/looptroop:latest
```

:::

| Channel | What it needs first |
| --- | --- |
| **curl / irm** | Node 24.15.0+, npm 11.12.1+, git, `gh`. The installer resolves the newest release, checks it against that release's checksum and hands it to npm — it never installs Node and never asks for sudo. |
| **npm** | Node 24.15.0+, npm 11.12.1+, git, `gh` |
| **Homebrew** | Nothing else — it pulls in `node@24` and `gh`, and takes git from the OS |
| **Scoop** | Nothing else — it depends on `nodejs-lts`, `git` and `gh` |
| **bun** | bun *and* Node 24.15.0+ (the launcher is a Node program), git, `gh` |
| **pnpm** | pnpm *and* Node 24.15.0+, git, `gh`. pnpm will not resolve a tag to a version published in the last 24 hours |
| **Yarn** | Yarn **Classic** *and* Node 24.15.0+, git, `gh`. Yarn 2 removed global installs, so modern Yarn cannot install a CLI at all |
| **Docker** | Only Docker — Node, git and `gh` are in the image, but it needs an OpenCode server it can reach |

[Installation](installation.md) covers every channel in full: upgrading,
uninstalling, the standalone executable that carries its own Node runtime, and
verifying a download.

## 3. Starting the Application

```bash
looptroop open
```

That is both steps: `open` starts LoopTroop in the background if it is not
already running, then points a browser at it. It serves the interface and the API
from **one address on port 3000**.

What `open` gives the browser is a **signed-in link**: a single-use code in the
URL fragment, exchanged for a session cookie. The fragment never reaches an
access log, and there is no password to set. Sessions last 12 hours; run
`looptroop open` again when one ends.

```bash
looptroop status    # is it running?
looptroop logs -f   # what is it doing?
looptroop stop
```

Every command and flag is in the [CLI Reference](cli.md). Settings, ports and the
configuration directory are in [Configuration](configuration.md); when something
misbehaves, [Runtime Diagnostics](diagnostics.md) covers `looptroop doctor` and
the rest; [Installation](installation.md) covers upgrading and uninstalling; and
[Operations](operations.md) covers running it day to day.

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
4. If the repository is already attached, LoopTroop warns you and stops the duplicate add. Project names and short names must also be unused by other attached projects.
5. If the repository has a `.looptroop` state folder but is not currently attached, choose whether to restore everything, keep the project settings while clearing all tickets, or delete that state and start fresh. The two destructive choices show exactly what will be deleted and require confirmation.
6. Open **Advanced** to review the concrete Manual QA, Git-hook, and [folder-ignore](configuration.md#looptroop-folder-ignore-policy) choices seeded from Configuration. Folder ignores default to **This clone only**, which keeps `/.looptroop/` and `/.ticket/` out of Git status through this clone's exclude file without modifying the repository's `.gitignore`.
6. Create your first **Ticket** with a description of the feature or fix you want.

Once submitted, LoopTroop kicks off an **interview phase** to clarify your intent, then generates a structured spec and implementation plan before any code is written. You review and approve at each gate.

## What Happens After Your First Ticket?

Your ticket flows through a structured pipeline — each stage has a clear purpose and a human review gate:

1. **Interview** — the AI council asks targeted questions to clarify ambiguities in your request.
2. **PRD** — your answers are synthesized into a structured spec with epics, user stories, and implementation steps.
3. **Beads** — the spec is decomposed into the smallest independently implementable units of work.
4. **Execution** — each bead is coded, tested, and retried in an isolated worktree until it passes.
5. **Review** — you inspect the final diff, commits, and changes before merging.

For the full lifecycle, see [Ticket Flow](ticket-flow.md).

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
