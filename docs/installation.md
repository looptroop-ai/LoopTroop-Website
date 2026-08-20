# Installation

LoopTroop installs like ordinary software and runs as a background service. Pick
a channel, start it, open it.

::: code-group

```bash [macOS, Linux, WSL]
curl -fsSL https://www.looptroop.ovh/install | sh
looptroop open
```

```powershell [Windows PowerShell]
irm https://www.looptroop.ovh/install.ps1 | iex
looptroop open
```

:::

`open` starts LoopTroop in the background if it is not already running, then
points a browser at it with a signed-in link. Use `looptroop start` if you want
the service without a browser.

> [!IMPORTANT]
> Whichever channel you pick, LoopTroop needs **[OpenCode](https://opencode.ai)
> with a configured provider** before it can run a coding task. LoopTroop starts
> OpenCode if it is installed and adopts one you are already running, but it will
> not install it, and it refuses to start with no OpenCode to reach. See
> [Getting Started](getting-started.md).

## What you need first, per channel

Everything else differs by channel, so read the row you are actually using.
`looptroop doctor` checks all of it and names anything missing.

| Channel | Node | git | `gh` |
| --- | --- | --- | --- |
| **Installer script** | you provide **24.15.0+** (and npm **11.12.1+**) — the installer is a Node program, never installs Node, and hands the package to npm | you provide it | you provide it |
| **npm, bun, pnpm, Yarn** | you provide **24.15.0+** (and npm **11.12.1+**) | you provide it | you provide it |
| **Homebrew** | installed for you (`node@24`) | from the OS | installed for you |
| **Scoop** | installed for you (`nodejs-lts`) | installed for you | installed for you |
| **Chocolatey** ⏳ | installed for you (`nodejs-lts`) | installed for you | installed for you |
| **WinGet** ⏳ | not needed — the executable carries its own | installed for you | installed for you |
| **AUR** ⏳ | installed for you (`nodejs>=24`) | installed for you | installed for you |
| **Standalone executable** | needed to *install*, not to *run* | you provide it | you provide it |
| **Container** | in the image | in the image | in the image |

`gh` is only used for the pull-request step at the end of a ticket, and it must
be authenticated (`gh auth login`) for that step to work. Everything before it
runs without `gh`, which is why `looptroop doctor` warns about a missing `gh`
rather than failing.

## Channels

| | Install | Upgrade | |
| --- | --- | --- | --- |
| **Installer script** (macOS, Linux, WSL) | `curl -fsSL https://www.looptroop.ovh/install \| sh` | run it again | ✅ |
| **Installer script** (Windows) | `irm https://www.looptroop.ovh/install.ps1 \| iex` | run it again | ✅ |
| **npm** (everywhere) | `npm install -g looptroop` | `npm install -g looptroop@latest` | ✅ |
| **bun** (everywhere) | `bun add -g looptroop` | `bun add -g looptroop@latest` | ✅ |
| **pnpm** (everywhere) | `pnpm add -g looptroop` | `pnpm add -g looptroop@latest` | ✅ |
| **Yarn Classic** (everywhere) | `yarn global add looptroop` | `yarn global upgrade looptroop@latest` | ✅ |
| **Homebrew** (macOS, Linux) | `brew install looptroop-ai/tap/looptroop` | `brew upgrade looptroop` | ✅ |
| **Scoop** (Windows) | `scoop bucket add looptroop https://github.com/looptroop-ai/scoop-bucket`, then `scoop install looptroop` | `scoop update looptroop` | ✅ |
| **Container** (Docker, Podman) | `docker pull looptroopai/looptroop:latest` or `docker pull ghcr.io/looptroop-ai/looptroop:latest` | pull again | ✅ |
| **Chocolatey** (Windows) | `choco install looptroop` | `choco upgrade looptroop` | ⏳ |
| **WinGet** (Windows) | `winget install LoopTroopAI.LoopTroop` | `looptroop stop`, then `winget upgrade LoopTroopAI.LoopTroop` | ⏳ |
| **AUR** (Arch Linux) | `yay -S looptroop-bin` or `paru -S looptroop-bin` | `yay -Syu looptroop-bin` or `paru -Syu looptroop-bin` | ⏳ |

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

Four different things travel under the same version number, and the difference
matters when you compare two machines.

**Homebrew, Scoop, Chocolatey and the AUR install a locked bundle.** The
application plus every dependency, resolved once at build time and archived.
Everyone on those channels runs the exact versions the release was tested
against.

**npm, bun and pnpm resolve version ranges on your machine.** That is how those
tools are supposed to work, and it means two installations of the same LoopTroop
version can carry slightly different dependency versions. The installer script in
its default mode is this too, with one difference worth knowing: it downloads the
package archive from the GitHub release and hands npm *that file*, rather than
asking the registry for it. You get the same result, and it is why the installer
can pin an exact version and verify a checksum before npm sees anything.

**WinGet and `--binary` install the standalone executable.** One file carrying
its own Node runtime, no dependency resolution at all. WinGet takes this rather
than the bundle because its repository refuses a portable package whose entry
point is anything but an `.exe`.

**The container carries everything**, including git and `gh`.

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
| `--prefix DIR` | `-Prefix DIR` | Choose where the executable goes, instead of `~/.looptroop`. Applies only with `--binary` — an npm install goes wherever npm's global prefix points, which you change with `npm config set prefix` |
| `--tarball PATH` | `-Tarball PATH` | Install a tarball you already have, skipping the download |
| `--dry-run` | — | Report what it would do and change nothing. POSIX only; `install.ps1` has no equivalent |

`LOOPTROOP_INSTALL_DIR` sets the same location as `--prefix`, for when you would
rather not repeat the flag on every upgrade.

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

Every downloadable asset also carries a **build provenance attestation**: a
signed statement of which workflow, repository and commit produced those exact
bytes. That covers the four executables, the npm tarball, the bundle, both
installer scripts, `release-manifest.json` and `checksums.sha256` — so the
scripts you pipe into a shell are verifiable, not only the executables you
unpack.

```bash
gh attestation verify looptroop-<version>-linux-x64.tar.gz --repo looptroop-ai/LoopTroop
gh attestation verify install.sh --repo looptroop-ai/LoopTroop
```

## Upgrading

```bash
looptroop doctor
```

tells you the current version, the latest published GitHub version, which channel
your copy came from, and the exact ordered commands that upgrade it. The same
update notice appears after `looptroop --version`, `looptroop status`,
`looptroop start`, and `looptroop open` whenever a newer release exists.

The notice goes to stderr, never stdout. `looptroop --version` still prints the
bare version and nothing else, so a script that captures it keeps getting a
value it can compare.

In the interface, click the version beside the LoopTroop title to open
**About**. A small monochrome update icon appears beside that version when an
update is available. About shows the current and latest versions, channel-aware
upgrade steps, and a **Changelog** button. Hover or focus the button to read the
complete latest GitHub release notes; click it to open that release on GitHub.

Release information is refreshed from GitHub and cached for 15 minutes. A failed
lookup keeps the last known release and is also briefly cached, so an offline
machine does not wait on the same network timeout for every command. Only a
published GitHub release is announced: drafts and prereleases are not treated as
the next stable update.

GitHub is the common release signal, but a downstream package channel can still
take longer to publish or index that version. The displayed guidance retains the
correct channel-specific caveat: pnpm commonly waits about 24 hours, Chocolatey
and WinGet can be held for review, and other managed channels or the container
tag can briefly lag. If the manager says the displayed version is unavailable,
keep the existing installation and retry later.

Use the detected command rather than guessing: **each package manager only
upgrades its own installation.** Running `npm install -g looptroop@latest`
against a bun or pnpm installation does not upgrade it — it installs a second
copy under npm's prefix, leaves the first one where it is, and which one runs
afterwards depends on the order of your `PATH`.

For npm, bun, pnpm, Yarn, Homebrew, Scoop, Chocolatey, AUR and source installs,
the displayed final step is `looptroop restart`. Replacing package files does not
replace the code already loaded by a running daemon. The standalone installer
stops, verifies, rolls back if necessary, and restarts the daemon itself. A
container is different: after pulling the image, recreate the container with the
same volumes, ports and environment settings; a pull alone does not replace a
running container.

Channel caveats worth knowing in advance:

- **pnpm arrives about a day late.** pnpm will not resolve a tag to a version
  published within roughly the last 24 hours — a supply-chain protection, on by
  default — so `pnpm add -g looptroop@latest` installs the newest release older
  than that window. Asking for an exact version (`pnpm add -g looptroop@1.2.3`)
  bypasses it.
- **Yarn means Yarn Classic.** Yarn 2 removed `yarn global` and never replaced
  it, so there is no global install in modern Yarn — `yarn global add looptroop`
  on Yarn 4 does not report an unknown command, it reads `global` as a package
  name and fails with a confusing lockfile error. On modern Yarn, either run it
  without installing (`yarn dlx looptroop`) or install it with one of the other
  channels on this page.
- **Yarn does not put its global binaries on your `PATH`.** This is the one that
  looks like a failed install and is not: `yarn global add looptroop` reports
  success, and then `looptroop` is not a command. Yarn links global executables
  into its own directory and leaves adding it to you. Check where, and add it:

  ```bash
  yarn global bin                 # usually ~/.yarn/bin
  export PATH="$(yarn global bin):$PATH"
  ```

  Put that `export` in your shell profile — `~/.bashrc`, `~/.zshrc` — or the next
  terminal will have forgotten it. npm, bun and pnpm each install into a
  directory that is normally already on `PATH`, which is why this catches people
  out on Yarn specifically.
- **On Windows, a Node installed by unpacking an archive leaves npm's global
  directory off `PATH`.** The installer script hands the package to npm and lets
  npm place the shim, so the install genuinely succeeded and `looptroop` still is
  not a command. It prints the fix when its own verification notices, but only
  then. Check where npm puts global binaries and add that directory:

  ```powershell
  npm prefix -g                   # usually %APPDATA%\npm
  ```

  A new terminal is needed either way: a `PATH` change does not reach the one
  that is already open. Node installed from the official Windows installer, from
  winget or from Scoop sets this up for you.
- **WinGet needs the daemon stopped first.** Windows will not replace a running
  executable, and the daemon holds it open. `looptroop stop` is printed as a
  separate line rather than joined with `&&`, because no single joining operator
  is valid in both PowerShell 5.1 and `cmd.exe`. After the upgrade, the displayed
  `looptroop open` step starts the new version and opens the interface.

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
| ⏳ **AUR** | `yay -R looptroop-bin`, or `paru -R looptroop-bin` |
| **Installer script (default mode)** | `npm uninstall -g looptroop` — it installs through npm, so npm removes it |
| **Installer script (`--binary`)** | no command; remove the install directory, below |
| **Container** | `docker rmi looptroopai/looptroop:latest` or `docker rmi ghcr.io/looptroop-ai/looptroop:latest` |

**The standalone executable has no uninstall command.** Remove the whole install
directory by hand — the executable lives in `bin/` inside it, but other files
from the archive sit alongside, so deleting only `bin/` leaves them behind:

```bash
looptroop stop
rm -rf ~/.looptroop
```

```powershell
looptroop stop
Remove-Item -Recurse -Force "$env:USERPROFILE\.looptroop"
```

If you installed with `--prefix` or `LOOPTROOP_INSTALL_DIR`, remove that
directory instead. This is the *install* directory only — your configuration,
database and logs live somewhere else entirely, and are covered below.

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

The same image runs under **Podman**, with one difference that is not a
substitution: **Podman needs the registry in the name.** Docker assumes Docker
Hub for a bare `looptroopai/looptroop`; Podman does not, and depending on the
`unqualified-search-registries` in its `registries.conf` it will either refuse
the name or stop to ask you which registry you meant. Say it outright:

```bash
podman pull docker.io/looptroopai/looptroop:latest
# or
podman pull ghcr.io/looptroop-ai/looptroop:latest
```

The GHCR name already carries its registry, so that one is the same under both.
Everywhere else on this page, `podman` does substitute for `docker` directly.

Podman's rootless default maps your user to the container's root, which changes
the uid question at the end of this section: with `podman run --userns=keep-id`
the mounted checkout stays owned by you and the `--user` flag below is
unnecessary.

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

## Download statistics

```project-stats
```
