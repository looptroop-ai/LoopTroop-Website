# Installation

LoopTroop installs like ordinary software and runs as a background service. Pick
a channel, start it, open it.

```bash
npm install -g looptroop
looptroop start
looptroop open
```

`start` detaches from the terminal, so LoopTroop keeps running after the shell
closes. It serves the interface and the API from one address on port 3000, and
`open` points a browser at it with a signed-in link.

> [!IMPORTANT]
> Everything here still needs **Node.js 24.15.0 or newer** and **git**, with one
> exception: the [standalone executable](#standalone-executable) carries its own
> Node runtime and needs only git. You also need
> [OpenCode](https://opencode.ai) with a configured provider before LoopTroop can
> run a coding task — see [Getting Started](getting-started.md).

## Channels

| | Install | Upgrade | |
| --- | --- | --- | --- |
| **npm** (everywhere) | `npm install -g looptroop` | `npm install -g looptroop@latest` | ✅ |
| **bun** (everywhere) | `bun add -g looptroop` | `bun add -g looptroop@latest` | ✅ |
| **pnpm** (everywhere) | `pnpm add -g looptroop` | `pnpm add -g looptroop@latest` | ✅ |
| **Homebrew** (macOS, Linux) | `brew install looptroop-ai/tap/looptroop` | `brew upgrade looptroop` | ✅ |
| **Scoop** (Windows) | `scoop bucket add looptroop https://github.com/looptroop-ai/scoop-bucket`<br>`scoop install looptroop` | `scoop update looptroop` | ✅ |
| **Docker** | `docker pull looptroopai/looptroop:latest` | `docker pull looptroopai/looptroop:latest` | ✅ |
| **Installer script** | `curl -fsSL https://www.looptroop.ovh/install \| sh` | run it again | ✅ |
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
| **Chocolatey** | `choco uninstall looptroop` |
| **WinGet** | `winget uninstall LoopTroopAI.LoopTroop` |
| **AUR** | `yay -R looptroop-bin` |
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

Published for `linux/amd64` and `linux/arm64`. Docker is the only thing the host
needs — Node, git and `gh` are in the image. It needs an OpenCode server it can
reach and a project mounted at its own absolute path; both are covered in the
[README's container section](https://github.com/looptroop-ai/LoopTroop#run-it-in-a-container).

## Building from a checkout

To develop LoopTroop rather than use it, see
[Getting Started](getting-started.md#working-on-looptroop-itself). That is the
development stack, not the installed service described here.
