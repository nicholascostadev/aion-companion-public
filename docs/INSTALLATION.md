# Install Aion Companion on Windows

[Download the latest release](https://github.com/nicholascostadev/aion-companion-public/releases/latest).
While this repository is private, sign into GitHub in your browser with an account
that has access. An installer downloaded by an authorized user runs without GitHub
CLI or a source checkout.

## Recommended: download and install

1. Download **AionCompanion-<version>-windows-x64-setup.exe** from the release assets.
2. Run Setup. It installs for your Windows account, adds a Start menu shortcut,
   offers a Desktop shortcut and registers an uninstaller in Windows Settings.
3. Setup checks for Microsoft Edge WebView2 and installs it if missing. This step
   needs an internet connection. The bootstrapper bundled in Setup is verified
   as Microsoft-signed during packaging.
4. Open **Aion Companion** from Start. Home and Settings include an installation
   check and links to fix missing capture requirements.
   Map artwork downloads when each map is first opened and is cached for later offline use.
5. For live capture, download [Npcap](https://npcap.com/#download) from its official
   website. Quit the companion (**Quit**, or **Quit Aion Companion** in its tray
   menu) before running Npcap Setup, install with the default options, then reopen
   the app. Driver installation may ask for administrator approval. If Npcap Setup
   stalls while starting the driver, quit the companion and let Setup finish.
6. Start AION 2 and log into a character. Capture connects automatically. Use
   windowed or borderless display for overlays, then show the meter from Home.

The installer targets **Windows 10/11 x64**. Windows 10 22H2 and current Windows 11
are the intended validation targets; this is not a claim of clean-machine coverage
for every Windows build. Windows 7/8, 32-bit Windows and native ARM64 packages are
not supported by this distribution. No Node.js, Rust, C++ Build Tools, source
checkout or development server is needed by players.

## Which requirements affect which features?

- **WebView2:** needed to open the desktop interface. Setup handles it. Portable
  users must install the [Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
  themselves if it is missing.
- **Npcap and an active AION 2 connection:** needed for live combat, live Group
  observations and the nearby-monster radar. Npcap is installed separately;
  it is not included in the companion or its installer.
- **Game display mode:** windowed or borderless display is needed for reliable
  desktop overlays. The game must be focused for in-game panels to appear.
- **GitHub access:** needed to download private releases. Browser sign-in is
  sufficient for manual downloads. Automatic private-release updates and first-use map downloads additionally
  use [GitHub CLI](https://cli.github.com/) and `gh auth login` with an authorized
  account. Public releases are checked and downloaded directly over HTTPS without
  GitHub CLI. Installing and running an already downloaded app needs neither.

### Map downloads and offline use

Setup and the portable ZIP contain the interface, icons and portraits. Original map
artwork is a separate download for each map, fetched from the matching app release
when that map is first opened. A download indicator and retry action appear while
the map's coordinate chart and markers remain available. Once the download is verified,
the map works offline, including after an app restart. Each cached image is checked
against the app's recorded SHA-256 hash before it is shown; damaged or incomplete
downloads can be retried.

Public map downloads need only an internet connection. For private releases, finish
the GitHub sign-in and access steps in **Settings → App updates** first. An installer
shared with a friend still installs and runs without repository access; uncached maps
from a private release need that access. Map packs (`.acmap`) are separate release
assets used by the app, and do not need to be extracted or installed manually.

Saved logs, offline analysis, reminders and manual pet
planning remain usable without Npcap or the game running. Running the companion as
administrator is not the default installation requirement. A driver configured
to restrict capture to administrators can prevent live access; follow the
[Npcap permissions and troubleshooting guide](https://npcap.com/guide/npcap-users-guide.html).
The app distinguishes a missing driver from an installed driver it cannot access.

### What Npcap does

Home and the Npcap row in Settings include an in-app explanation, available even
after the driver is installed. Npcap is the Nmap Project's Windows network-capture
driver and library. The companion uses it to read game traffic for live features;
it does not use packet injection or modify game files. A Windows kernel driver is
privileged software: install it only from the official source, keep it updated,
and consider the privacy and stability implications of allowing capture-capable
software on your PC. A legitimate driver is not a guarantee about a game's rules
or anti-cheat decisions. You can leave Npcap uninstalled and use the offline
features. See the [official Npcap site](https://npcap.com/) and
[user guide](https://npcap.com/guide/npcap-users-guide.html).

## Portable download

Download the ZIP, extract all its contents and run the included executable. Keep
the third-party notices with it. The bare EXE is also available, but does not
include its adjacent instructions and notices. Portable means no installation
or shortcuts: settings still live in the normal local app-data folder, and are
shared with the stable installed app. Keep Stable and Dev separate.

Portable copies offer the installer download and release checking. To stay
portable, quit the app from the tray, download the new ZIP and replace the old
executable. Portable copies do not offer an automatic restart they cannot perform.

## Updates, repair and uninstall

Installed copies check for releases at startup. Downloads are verified against
GitHub SHA-256 asset digests and staged beside the current version. Choose
**Restart to update** when convenient: the app saves capture first, then the
launcher switches versions. It never restarts itself without that action.

Setup and the stable launcher retain the current build and one fallback build.
When the installation is idle, they remove older recognized app files and leftover
update downloads, then refresh the size shown in Windows Settings. Locked or
unexpected files and linked folders are preserved. New downloads are removed after
staging, including failed downloads. Saved preferences, recordings and logs live
separately and are never part of this cleanup. Existing installations need to run
the updated Setup once to receive the launcher changes; in-app updates replace
the application executable only.

### Giving the installer to a friend

An installer you give a friend can be installed and used without repository
access. Permission to read private releases is a separate requirement for future
updates and first-use map downloads. Previously cached maps remain usable offline.
Your friend does not need a source checkout or developer tools.

In **Settings → App updates**, the private-update guide checks three separate
requirements: GitHub CLI installed, signed into GitHub CLI, and repository access
confirmed. The supported path is:

1. Install [GitHub CLI](https://cli.github.com/) using its official Windows
   installer. Return to the app and check access; a default Windows installation
   can be detected while the app is already open.
2. Start sign-in from the guide. GitHub CLI opens its own interactive window and
   browser flow. Follow its prompts using the GitHub account you will invite.
   If it asks to authenticate Git, choose **No**; release updates do not need Git.
   Companion does not collect the password, token or device code; GitHub CLI
   manages its own authentication. Browser sign-in alone does not sign the CLI in.
3. Invite that account to this repository and have your friend accept the
   invitation from their email or GitHub notifications. They can complete sign-in
   before you grant access. Return to the guide and check access again afterward.
4. Once access is confirmed, use **Check for updates**, download the available
   release, then choose **Restart to update**. Setup never grants repository
   permission on its own.

If the interactive sign-in window cannot open, the guide includes a manual
alternative. In a terminal your friend opens themselves, run:

```text
gh auth login --hostname github.com --web --git-protocol https
```

Then check access again in the app. A connection or GitHub service failure means
access could not be verified, not necessarily that the invitation was denied.
Public releases do not need GitHub CLI or a GitHub sign-in. See GitHub CLI's
[sign-in documentation](https://cli.github.com/manual/gh_auth_login) and
[authentication status documentation](https://cli.github.com/manual/gh_auth_status).

For a manual upgrade or repair, quit the companion from its tray, then run the
new Setup. Setup refuses to replace a running installation. Existing versioned
installations made with `install-stable.ps1` use the same install root and launcher
protocol. Saved preferences, recordings and logs are preserved.

Uninstall through **Windows Settings → Apps → Aion Companion**, after quitting
the tray app. Uninstall removes the installed application and its shortcuts;
it preserves saved data, the Dev channel, WebView2 and Npcap. The latter runtimes
may also be used by other programs.

Stable application files live in `%LOCALAPPDATA%/AionCompanion`. Saved data lives
in `%APPDATA%/org.aioncompanion.prototype`. Export a native backup from Settings
before manually deleting saved data. See [backup and recovery](BACKUPS.md).

## Download trust and troubleshooting

Releases include `SHA256SUMS.txt`. Check a downloaded file in PowerShell with
`Get-FileHash -Algorithm SHA256 -LiteralPath '<downloaded file>'` and compare it
with that release's checksum. Checksums detect changed downloads; they are not a
verified publisher identity. Releases remain unsigned until the publisher supplies
a verified signing certificate. Windows may show an unknown-publisher, SmartScreen
or application-control prompt. Verify the official download source and signature
status before deciding whether to run it; do not disable Windows protection.

If Setup cannot install WebView2, install the official Evergreen Runtime manually
and retry Setup. If the app opens but capture is unavailable, use the installation
check in Home or Settings. A ready driver with no game connection means the next
step is launching AION 2 and logging in, rather than reinstalling the driver.

If automatic updates cannot access the private repository, manual browser
downloads remain available. A missing or broken installation can be repaired by
rerunning Setup. Bug reports can be exported from Settings; see [support](BUG_REPORTS.md).

## Validation before a broad release

CI exercises an isolated installer with fixture executables: initial install,
upgrade, launcher verification, running-app refusal and uninstall preservation.
It must not touch a developer's real install, shortcuts or uninstall registration.
Release packaging additionally builds the real application and installer.

Before broad distribution, verify on clean Windows 10 22H2 and Windows 11 virtual
machines with WebView2 absent/present, Npcap absent/usable/admin-restricted, an
ordinary nonadministrator account, private browser access without GitHub CLI,
offline WebView2 failure, upgrades and downloaded-file Windows trust prompts.
These clean-machine scenarios are not replaced by fixture tests on a prepared
developer computer or GitHub runner.
