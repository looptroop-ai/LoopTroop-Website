# Installation

LoopTroop installs like ordinary software and runs as a background service. Pick
a channel, start it, open it.

```bash
curl -fsSL https://www.looptroop.ovh/install | sh
looptroop open
```

`open` starts LoopTroop in the background if it is not already running, then
points a browser at it with a signed-in link. Use `looptroop start` if you want
the service without a browser.

> [!IMPORTANT]
> Everything here still needs **Node.js 24.15.0 or newer** and **git**, with one
> exception: the [standalone executable](#standalone-executable) carries its own
> Node runtime and needs only git. You also need
> [OpenCode](https://opencode.ai) with a configured provider before LoopTroop can
> run a coding task — see [Getting Started](getting-started.md).

## Channels

| | Install | Upgrade | |
| --- | --- | --- | --- |
| **Installer script** (everywhere) | `curl -fsSL https://www.looptroop.ovh/install \| sh` | run it again | ✅ |
| **npm** (everywhere) | `npm install -g looptroop` | `npm install -g looptroop@latest` | ✅ |
| **bun** (everywhere) | `bun add -g looptroop` | `bun add -g looptroop@latest` | ✅ |
| **pnpm** (everywhere) | `pnpm add -g looptroop` | `pnpm add -g looptroop@latest` | ✅ |
| **Homebrew** (macOS, Linux) | `brew install looptroop-ai/tap/looptroop` | `brew upgrade looptroop` | ✅ |
| **Scoop** (Windows) | `scoop bucket add looptroop https://github.com/looptroop-ai/scoop-bucket`<br>`scoop install looptroop` | `scoop update looptroop` | ✅ |
| **Container** (Docker, Podman) | `docker pull looptroopai/looptroop:latest` | `docker pull looptroopai/looptroop:latest` | ✅ |
| **Chocolatey** (Windows) | `choco install looptroop` | `choco upgrade looptroop` | ⏳ |
| **WinGet** (Windows) | `winget install LoopTroopAI.LoopTroop` | `looptroop stop`<br>`winget upgrade LoopTroopAI.LoopTroop` | ⏳ |
| **AUR** (Arch Linux) | `yay -S looptroop-bin` | `yay -Syu looptroop-bin` | ⏳ |

### ⏳ means the command does not work yet

Those three packages are written, built, installed and removed again by CI on
every change. Each is waiting on somebody else:

| Channel | Waiting on |
| --- | --- |
| **Chocolatey** | Community moderation. Every version is reviewed before the feed serves it, and no release waits on that. |
| **WinGet** | A pull request open at [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), reviewed by people at Microsoft. |
| **AUR** | Registration reopening. New AUR accounts are closed following a security incident, so there is no account to publish from. |

The commands are listed because they are what will work, unchanged, the day each
clears. Until then every ✅ row is a real alternative on the same platform — Arch
users can install with npm, and Windows users with Scoop.

## What each channel actually installs

Three different things travel under the same version number, and the difference
matters when you compare two machines.

**Homebrew, Scoop and Chocolatey install a locked bundle.** The application plus
every dependency, resolved once at build time and archived. Everyone on those
channels runs the exact versions the release was tested against.

**npm, bun and pnpm resolve version ranges on your machine.** That is how those
tools are supposed to work, and it means two installations of the same LoopTroop
version can carry slightly different dependency versions.

**The standalone executable carries its own Node runtime.** One file, no
dependency resolution at all, and nothing needed on the machine but git.

## Standalone executable

Every release publishes an executable for macOS (Apple silicon), Linux (x64 and
arm64) and Windows (x64) on the
[releases page](https://github.com/looptroop-ai/LoopTroop/releases/latest).

The installer will place one for you, into `~/.looptroop` unless you say
otherwise:

```bash
curl -fsSL https://www.looptroop.ovh/install | sh -s -- --binary
```

```powershell
& ([scriptblock]::Create((irm https://www.looptroop.ovh/install.ps1))) -Binary
```

Everything the installer accepts, in either mode:

| Flag | PowerShell | What it does |
| --- | --- | --- |
| `--binary` | `-Binary` | Install the standalone executable instead of going through npm |
| `--version X.Y.Z` | `-Version X.Y.Z` | Install an exact version rather than the newest release |
| `--prefix DIR` | `-Prefix DIR` | Choose where the executable goes, instead of `~/.looptroop` |
| `--tarball PATH` | `-Tarball PATH` | Install a tarball you already have, skipping the download |
| `--dry-run` | — | Report what it would do and change nothing. POSIX only; `install.ps1` has no equivalent |

Run the same command again to upgrade. The upgrade is transactional: it verifies
the download against the checksum the release published, stops a running daemon
and confirms it exited, replaces the file by rename rather than writing over it,
and checks the new executable reports the version that was asked for. If anything
fails, the previous version is put back and the daemon it stopped is started
again — so a bad upgrade leaves you on the version you already had rather than
with nothing.

> [!NOTE]
> Installing this way still needs Node, because the installer is itself a Node
> program. What the executable removes is Node as a requirement to **run**
> LoopTroop. On a machine with no Node at all, download the archive from the
> releases page and unpack it yourself.

### Platforms with no executable

| Platform | Why | Use instead |
| --- | --- | --- |
| **macOS on Intel** | Node cannot build a single-file executable for `darwin-x64`. | Homebrew, or npm |
| **Alpine and other musl systems** | The runtime is built against glibc. | npm, in a glibc container |
| **Windows on ARM** | No build target. | npm, or Scoop |

The installer refuses each of these by name and points at the channel that works,
rather than installing something that cannot run.

## Verifying a download

Every release publishes `checksums.sha256`. It lists **every** asset the release
publishes, so check the line for the file you actually downloaded rather than
checking the whole file:

```bash
grep looptroop-<version>-linux-x64.tar.gz checksums.sha256 | sha256sum -c
```

```bash
grep looptroop-<version>-darwin-arm64.tar.gz checksums.sha256 | shasum -a 256 -c
```

```powershell
Get-FileHash looptroop-<version>-win-x64.zip -Algorithm SHA256
```

> [!WARNING]
> A plain `sha256sum -c checksums.sha256` reports every asset you did *not*
> download as `FAILED open or read` and exits non-zero. That looks like a
> corrupted release and is not one — it is the checksum file describing every
> asset in the release while you have one. GNU coreutils can skip them with
> `sha256sum --ignore-missing -c checksums.sha256`; macOS `shasum` has no such
> flag, which is why the single-line form above is the one that works
> everywhere.

`release-manifest.json` records the same hashes alongside each asset's size, and
is what the installers check against — `checksums.sha256` is generated from it,
so the two cannot disagree.

The four executables also carry a **build provenance attestation**: a signed
statement of which workflow, repository and commit produced those exact bytes.

```bash
gh attestation verify looptroop-<version>-linux-x64.tar.gz --repo looptroop-ai/LoopTroop
```

## Upgrading

```bash
looptroop doctor
```

tells you which channel your copy came from and the exact command that upgrades
it. Use that rather than guessing: **each package manager only upgrades its own
installation.** Running `npm install -g looptroop@latest` against a bun or pnpm
installation does not upgrade it — it installs a second copy under npm's prefix,
leaves the first one where it is, and which one runs afterwards depends on the
order of your `PATH`.

Two channels have a caveat worth knowing in advance:

- **pnpm arrives about a day late.** pnpm will not resolve a tag to a version
  published within roughly the last 24 hours — a supply-chain protection, on by
  default — so `pnpm add -g looptroop@latest` installs the newest release older
  than that window. Asking for an exact version (`pnpm add -g looptroop@1.2.3`)
  bypasses it.
- **WinGet needs the daemon stopped first.** Windows will not replace a running
  executable, and the daemon holds it open. `looptroop stop` is printed as a
  separate line rather than joined with `&&`, because no single joining operator
  is valid in both PowerShell 5.1 and `cmd.exe`.

## Uninstalling

Stop the daemon first in every case, so nothing is holding a file open or writing
to the database:

```bash
looptroop stop
```

| Channel | Command |
| --- | --- |
| **npm** | `npm uninstall -g looptroop` |
| **bun** | `bun remove -g looptroop` |
| **pnpm** | `pnpm remove -g looptroop` |
| **Homebrew** | `brew uninstall looptroop` |
| **Scoop** | `scoop uninstall looptroop` |
| ⏳ **Chocolatey** | `choco uninstall looptroop` |
| ⏳ **WinGet** | `winget uninstall LoopTroopAI.LoopTroop` |
| ⏳ **AUR** | `yay -R looptroop-bin` |
| **Installer script (npm mode)** | `npm uninstall -g looptroop` — it installs through npm, so npm removes it |
| **Docker** | `docker rmi looptroopai/looptroop:latest` |

**The standalone executable has no uninstall command.** Remove it by hand:

```bash
looptroop stop
rm -rf ~/.looptroop/bin
```

```powershell
looptroop stop
Remove-Item -Recurse -Force "$env:USERPROFILE\.looptroop\bin"
```

### What uninstalling leaves behind

None of the commands above delete your configuration, database or logs — which is
deliberate, so reinstalling does not lose your projects and tickets. They live in
the [configuration directory](configuration.md):

| Platform | Path |
| --- | --- |
| **Linux, macOS** | `$XDG_CONFIG_HOME/looptroop`, or `~/.config/looptroop` |
| **Windows** | `%APPDATA%\looptroop` |

Delete that directory too for a clean removal. Your projects are untouched by any
of this — LoopTroop works in git worktrees under `<project>/.looptroop/`, and
`looptroop clean` lists and removes abandoned ones while it is still installed.

## Running in a container

Published for `linux/amd64` and `linux/arm64`, to **Docker Hub** and to
**GitHub Container Registry**. A container runtime is the only thing the host
needs — Node, git and `gh` are in the image:

```bash
docker pull looptroopai/looptroop:latest
```

```bash
docker pull ghcr.io/looptroop-ai/looptroop:latest
```

The same image runs under **Podman** — substitute `podman` for `docker` in every
command on this page. Podman's rootless default maps your user to the container's
root, which changes the uid question at the end of this section: with
`podman run --userns=keep-id` the mounted checkout stays owned by you and the
`--user` flag below is unnecessary.

Two things it still needs from you, both deliberately not baked in.

**An OpenCode server.** It is not in the image: it needs a configured model
provider and your credentials, and bundling it would tie LoopTroop's releases to
OpenCode's. A container with no OpenCode to reach exits at startup instead of
serving an interface that cannot run a single coding operation, so pass
`-e LOOPTROOP_OPENCODE_BASE_URL=…` pointing at a server you run — or
`-e LOOPTROOP_OPENCODE_MODE=mock` to look around without one.

That server has to be able to open the files LoopTroop gives it. LoopTroop works
in git worktrees under `<project>/.looptroop/worktrees/` and asks OpenCode to
open one **by absolute path**, so the path has to mean the same thing on both
sides. Mounting the project somewhere tidy like `/workspace/project` breaks that
the moment OpenCode is not in the same container: it is handed a directory that
does not exist on its own filesystem. So mount the project at its own path:

```bash
PROJECT=/absolute/path/to/project
```

and use `-v "$PROJECT":"$PROJECT"`, as below. If you would rather keep a tidy
path inside the container, run OpenCode as a sidecar with the identical mount, so
both processes see the same string.

**A way to reach it.** The daemon binds `127.0.0.1`, which inside a container is
the container's own loopback, so publishing a port alone connects to nothing.
That default is the point: this is a control plane that executes code on the
machine it runs on, and it does not become network-reachable by accident.

On Linux, share the host's network namespace and the loopback boundary stays
real:

```bash
docker run --network host \
  -e LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:4096 \
  -v looptroop-config:/home/node/.looptroop \
  -v "$PROJECT":"$PROJECT" -w "$PROJECT" \
  looptroopai/looptroop:latest
```

On Docker Desktop for Mac and Windows the containers run in a VM, so
`--network host` is that VM's loopback rather than yours. There the daemon has to
bind wider, which it will not do by omission — it refuses a non-loopback bind
unless both variables are set, and refuses it without a token:

```bash
docker run -p 127.0.0.1:3000:3000 \
  -e LOOPTROOP_ALLOW_REMOTE_API=1 \
  -e LOOPTROOP_BACKEND_HOST=0.0.0.0 \
  -e LOOPTROOP_API_TOKEN="$(openssl rand -hex 32)" \
  -e LOOPTROOP_OPENCODE_BASE_URL=http://host.docker.internal:4096 \
  -v looptroop-config:/home/node/.looptroop \
  -v "$PROJECT":"$PROJECT" -w "$PROJECT" \
  looptroopai/looptroop:latest
```

In PowerShell, the same run with the same meaning:

```powershell
$Project = "C:\path\to\project"
$Token = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
docker run -p 127.0.0.1:3000:3000 `
  -e LOOPTROOP_ALLOW_REMOTE_API=1 `
  -e LOOPTROOP_BACKEND_HOST=0.0.0.0 `
  -e LOOPTROOP_API_TOKEN=$Token `
  -e LOOPTROOP_OPENCODE_BASE_URL=http://host.docker.internal:4096 `
  -v "${Project}:${Project}" -w $Project `
  looptroopai/looptroop:latest
```

Windows needs one more decision than the others, because of the path rule above.
`C:\path\to\project` is not a path a Linux container can be given, and an
OpenCode server running natively on Windows cannot open a Linux one — so the two
sides cannot meet by mounting the same string. Either run OpenCode as a container
sidecar with the identical mount, or keep the project inside WSL and run both
from there, where `/home/you/project` means the same thing on both sides. A
native Windows OpenCode with a container LoopTroop is the one combination that
cannot be made to work.

`-p 127.0.0.1:3000:3000`, not `-p 3000:3000`: the short form publishes on every
host interface, which on a shared network offers that control plane to everyone
on it.

`LOOPTROOP_API_TOKEN` is what authorises the wider bind. It is **not** the token
the API accepts — the daemon mints its own at startup and records it owner-only.
Read the one that works with:

```bash
docker exec <container> sh -c 'cat "$LOOPTROOP_CONFIG_DIR/daemon.json"'
```

Keep the `looptroop-config` volume. It holds the database and the daemon record;
without it every restart is a fresh install.

The container runs as uid 1000. If your host user is a different uid, git refuses
the mounted checkout with "detected dubious ownership" — match the uid rather
than relaxing `safe.directory` inside the image for everyone. The named config
volume is then no longer writable either, so put the config somewhere that uid
owns:

```bash
docker run --network host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e LOOPTROOP_CONFIG_DIR=/workspace/.looptroop \
  -e LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:4096 \
  -v "$PROJECT":"$PROJECT" -w "$PROJECT" \
  -v "$HOME/.looptroop:/workspace/.looptroop" \
  looptroopai/looptroop:latest
```

`HOME=/tmp` because `/home/node` belongs to uid 1000 and nothing should have to
write into a home directory it does not own.

Commits carry their identity per invocation, so no global git config is needed.
`gh` does need credentials for the pull-request step: pass `-e GH_TOKEN=…`. The
push uses the same token, through `gh`'s credential helper — git does not read
`GH_TOKEN` itself, and nothing else in the image supplies a credential, so
without that the pull request would be prepared and never pushed.

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

The dev stack is several processes with hot reload, not one daemon. `looptroop
start` plays no part in it, and the two have **different authentication rules** —
see the [API Reference](api-reference.md).

::: details What happens during startup?

The preflight handles dependency updates, security audit fixes, OpenCode CLI updates, and port checks. Dependency proposals must pass npm's normal peer resolution before they can change the checkout; incompatible releases are held rather than forced. Normal startup prints a short summary of every updated package (previous → new version) and releases held by the age or compatibility gates.

For the full preflight specification, see [Operations Guide](operations.md).
:::

::: details Useful startup flags

- **`npm run dev --opencode-logs=all`** — full OpenCode DEBUG logs in your terminal (starts OpenCode with `--print-logs --log-level DEBUG`).
- **`npm run dev --lan`** — binds the frontend to the local network, prints LAN URLs and a QR code. Backend and OpenCode stay on loopback, while documentation links continue to use the hosted site. This way you can connect to the app via mobile or another computer on the same network.

For non-mutating startup, forced maintenance, and manual maintenance commands, see [Operations Guide](operations.md).
:::
