# Windows builds and releases

The private repository uses `master` as its default branch.

Follow the [commit, PR and release-note conventions](#commits-pull-requests-and-release-notes)
below when writing titles or editing release descriptions. That section
defines the Markdown subset and grouping used by Settings → App updates, with a
release-body template and a checklist for publication.

## Download an executable without a release

Open **Actions → Build Windows executable → Run workflow**. Select a branch and
run it. After it succeeds, download the `AionCompanion-<version>-windows-x64`
artifact. It contains the recommended `-setup.exe`, portable `.exe` and `.zip`, third-party notices,
requirements and SHA-256 checksums. Every push and PR also runs this build.

The same artifact also contains three content-addressed `.acmap` map packs. They
are uploaded alongside the executable and installer, outside the portable ZIP.
The app downloads only the map first opened, from its matching version's release,
then verifies and caches it for offline use. Publish all three packs with every
release, including when the map bytes have not changed. A local unpublished build
cannot fetch packs that are not present on its matching published release yet.

## Automatic releases

Merging a pull request into `master` starts **Release Windows**. It:

1. Increments the app's patch version, synchronizing npm, Tauri, the desktop Cargo
   manifest and both lock files. Library crate versions are independent.
2. Commits the version to `master` and reserves a matching `vX.Y.Z` tag atomically.
3. Checks and builds that exact commit on Windows, with a release profile.
4. Creates a GitHub release containing Setup, the portable executable and ZIP,
   checksums and notices. Release notes start with installation and requirements
   links before the generated change list.

Add a `release:minor` or `release:major` PR label before merging to choose that
increment; major takes precedence. With neither label, the bump is patch.
Closing an unmerged PR does not publish. A direct push runs checks but does not
publish. A manual **Release Windows** run on `master` can publish the first release
or make an explicit patch/minor/major release.

The release queue processes runs one at a time and retains pending merges (up to
GitHub's 100-run concurrency queue limit). Each queued merge gets a version of the
latest `master` when its release starts, so a release can include later merges.
The tagged commit always identifies the exact source of its executable.

Versions/tags are reserved before building. If a build fails, the tag remains but
there is no published release. **Re-run all jobs** on that same run to retry the
same version. Starting a new manual run requests a new version. Rerunning a
completed run replaces the assets of that version rather than creating another.
The source PR/run marker in the version commit prevents double version bumps.
Bot pushes do not recursively create releases.

The workflows use the repository's `GITHUB_TOKEN`; no personal token or extra
secret is needed. Release preparation and publishing have `contents: write`;
builds have read access. Actions are pinned to reviewed commit IDs. If branch
rules are added later, allow the release bot's version commits on `master`, or
adapt the version reservation to that policy.

## Publish from a local computer

Use the project `$local-release` skill in Codex, or `/local-release` in Claude
Code and Cursor, to build on this Windows computer and publish a stable GitHub
release. A bare invocation requests a patch release; specify minor or major to
change the increment. "Preview only" requests a read-only plan. This is separate
from the automatic release workflow and does not dispatch a CI release build.

Publishing means a non-draft, non-prerelease GitHub release with the installer,
portable executable, ZIP, notices, requirements and checksums. It preserves
repository visibility: publishing in this private repository does not make the
downloads public. Changing repository visibility is a separate explicit action.

### Select and prepare the source

Use Git Bash and the `bash dev.sh` environment. Check GitHub CLI authentication,
repository identity, permissions and visibility, then fetch `origin/master` and
tags. Inspect **Release Windows** runs for queued or active publications. Let an
existing run finish and re-fetch before reserving a local version; do not cancel
it or publish the same source again blindly.

Use latest fetched `origin/master` by default. Preserve the caller's branch and
uncommitted changes by creating a separate clean release worktree with a
`chore/local-release-<timestamp>` branch. If the user asks to include an unmerged
feature, resolve the source/merge choice first; invoking this skill does not
authorize merging a PR. An explicitly selected alternate source still needs to
be suitable for a normal fast-forward update of `master`.

Record the fetched `origin/master` SHA, chosen source SHA and previous published stable tag, then run the version
script **in the release worktree**, for example:

```bash
bash dev.sh exec -- node scripts/release-version.mjs --bump patch
```

Use the returned version for `vX.Y.Z` and `Aion Companion X.Y.Z`. The script
accounts for existing version tags, including reservations without a release.
Inspect and stage only its five version files, then commit with
`chore(release): vX.Y.Z`. Record that release SHA, version, tag, bump and output
paths in an ignored local record for recovery. Validate every new commit subject
that would reach `master`. Do not run `prepare-release.ps1` locally: it is the CI
reservation entry point and pushes before the build.

### Build before reserving the remote version

Run every command under **Local packaging** below against the version commit,
using `bash dev.sh exec --` for npm, Node, Cargo and Windows adapter calls. This
includes frontend checks, version tests, stable and development release-profile
native tests, and installer tests. The shipped executable must be built with
stable `custom-protocol` features. `bash dev.sh build` produces a Dev executable
and is not the release build command.

Use `bash dev.sh package --output-dir <new-directory>` for the packaging step;
choose an unused directory under ignored `release-artifacts/`. Never clear an
existing output directory just to retry. Verify the expected file set and every
entry in `SHA256SUMS.txt`; preserve any configured signing requirement. Keep notes
and recovery records outside the packaged file set so they do not invalidate it.
No remote version reservation or publication follows a failed command.

After successful packaging, re-fetch and check that `master` still equals the
recorded `origin/master` SHA and the new tag does not exist. Create the matching local tag
and atomically push the version commit and tag. From the release branch, the
shape is:

```bash
git tag "v$release_version" "$release_commit"
git push --atomic origin "$release_commit:refs/heads/master" "refs/tags/v$release_version"
```

These variables denote the recorded, verified values. Use a normal fast-forward
push. A concurrent update or tag collision requires re-fetching, choosing a fresh
version and rebuilding its exact source; never move a tag or force-push `master`.
If another collision occurs, stop and report it. A direct version push runs the
usual checks but does not trigger **Release Windows**, which listens for merged
PRs or manual dispatch.

### Draft, verify and publish

Read the installation and requirements prefix from `.github/workflows/release.yml`
and prepare it as a local notes file. Generate the change list for the actual
new tag, starting at the previous published stable tag. Create the draft with
the verified assets:

```bash
gh release create "$release_tag" "$release_output"/* \
  --verify-tag --draft --title "Aion Companion $release_version" \
  --notes-file "$release_notes" --generate-notes --notes-start-tag "$previous_tag"
```

For a first release omit `--notes-start-tag` and supply no invented comparison
range. Follow the README release-note conventions, inspect the generated draft
body and attach migration guidance where needed. Verify all uploaded asset names,
sizes and SHA-256 hashes against the local package, downloading into a fresh
verification directory when necessary. Recheck the remote tag SHA. Once complete,
publish the same draft:

```bash
gh release edit "$release_tag" --draft=false --prerelease=false --latest
```

Invocation authorizes final publication after successful verification unless the
user requested a preview or draft. Read back the published release and latest
release pointer. Report its URL, version/tag, exact source SHA, checks, asset and
signing verification, and whether repository access is required.

On a lost response or failed upload, inspect remote state before retrying. Resume
the same recorded commit/tag/draft, verify assets already present and upload only
missing files. Do not bump again, overwrite conflicting assets, delete a tag or
rebuild an already-published version with different bytes. If the matching release
is already published and complete, report success. Keep the release worktree,
record and artifacts until recovery or verification is complete.

## Build performance and release checks

`npm run check:size` checks the shipped public assets against decimal-byte size
budgets: no bundled maps and 8 MB for all public assets. `npm run build`
also checks the completed `dist` directory against an 11 MB budget before Cargo
embeds it. Packaging refuses a Setup installer over 15 MB. Full-quality sources
and downloadable map images belong outside both shipped directories.
If a budget fails, inspect the added assets and optimize them before considering
a deliberate budget increase in `scripts/check-bundle-size.mjs`.

The release profile optimizes the desktop shell for size with thin LTO and stripped
symbols. Combat processing, capture and JSON serialization retain speed optimization;
panic unwinding remains enabled for native callback guards.

`npm run check:art` also verifies `src-tauri/map-art-index.json` against the
unbundled delivery files in `artwork/delivery/pet-map-art`. When map delivery changes,
run `node scripts/build-map-packs.mjs --write-index` before building the executable.
`package-release.ps1` verifies that index and emits the corresponding `.acmap`
packs before calculating checksums. The native executable embeds only the index,
and accepts only packs and image bytes that match its pinned lengths and hashes.

The reusable build runs frontend quality checks on Ubuntu alongside the Windows
build. Both jobs check out the same requested commit. Publishing waits for the
entire reusable workflow, so failed frontend checks still block a release.
Windows still builds the embedded frontend, runs versioning, launcher and isolated installer tests,
tests the Rust release profile in both stable and development modes, and packages
only the stable executable with its licenses and checksums.

Rust dependencies are cached with the compiler and Cargo manifests in the key.
Dependencies from the same compiler can be restored after version or lockfile
changes; Cargo checks which artifacts remain usable. The cache excludes test and
app executables to reduce transfers; Cargo rebuilds them from the checked-out
source. A cold cache still performs the full build and all checks.

The stable executable is built before testing development identity, avoiding a
switch back to stable build-script outputs. Development tests build test binaries
only, and packaging still rejects a development executable.

## Local packaging

With Node 22.12+, Rust/MSVC and WebView2 build prerequisites installed (and network
access to fetch the verified NSIS toolchain and Microsoft WebView2 bootstrapper):

```powershell
npm ci
npm run check
node --test scripts/release-version.test.mjs
npm run build
cargo test --release --locked -p companion-core -p companion-capture -p aion-companion --features custom-protocol --lib --bins
cargo build --release --locked -p aion-companion --features custom-protocol
cargo test --release --locked -p aion-companion --features custom-protocol,development --bins
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/test-installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/package-release.ps1
```

Packaging writes a new `release-artifacts` directory and never modifies a running
app or the local development launcher. Use a different `-OutputDirectory` when
that directory already exists. NSIS is fetched from Tauri's toolchain release and
checked against a pinned SHA-256 hash before execution. The WebView2 bootstrapper
is fetched from Microsoft's official Evergreen URL and must pass Microsoft
Authenticode verification. You can supply predownloaded paths with `-Makensis`
and `-Bootstrapper` when packaging offline.

`build-installer.ps1` compiles the permanent launcher at build time and bundles
the same immutable version directory, pointer and protocol used by the existing
updater. Installation never compiles source or needs GitHub CLI. Tauri's default
bundler remains disabled deliberately: its standard direct-executable layout
would bypass this app's versioned launcher. `scripts/installer.nsi` is the NSIS
packaging entry point. Runtime bootstrap, per-user registration, safe upgrade and
uninstall all live there. No Npcap binaries are redistributed. No game capture
driver is needed to compile or run automated tests.

## Optional Windows code signing

The pipeline remains explicitly unsigned until a verified signing identity is
provided. Set `AION_SIGN_CERT_THUMBPRINT` to the 40-hex-digit thumbprint of a
trusted code-signing certificate available in the current user's Windows
certificate store, with its private key accessible to the build account. The
Windows SDK's `signtool.exe` must be installed. The scripts never request, print
or embed the private key. An invalid configured signing identity fails the build;
it never silently falls back to unsigned output.

`package-release.ps1 -RequireSigning` fails if no identity is configured. It signs
the portable app before computing the version hash, signs the bundled launcher,
and signs both the generated uninstaller and final Setup. SHA-256 checksums and
GitHub asset digests therefore describe the final signed files. The build's source
executable is not modified. Signing uses SHA-256 and an RFC 3161 timestamp, then
requires valid Authenticode verification.

CI does not automatically acquire a certificate or change repository visibility.
Provision the certificate in the build account securely before enabling signing;
do not commit certificates, credentials or private keys. An identity validation or
paid certificate enrollment is a publisher task. See [Microsoft signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
A valid signature identifies the publisher but does not guarantee immediate
SmartScreen reputation. See [installation validation](INSTALLATION.md#validation-before-a-broad-release)
for the remaining clean-machine checks.

## Commits, pull requests and release notes

**PR titles become release notes.** The release workflow uses GitHub's generated
list of merged PR titles; Settings → App updates reads that release body and
groups Conventional Commit entries by type. Write titles that explain the change
to a reader who has not seen the code. PR descriptions and commit bodies are not
automatically copied into those entries.

### Commit and PR titles

Every commit and PR title must use:

```text
<type>[optional scope][!]: <description>
```

Use a lowercase type, an optional short lowercase area such as `pets`, `group`
or `updates`, and a concise imperative description without a trailing period.
Choose the type for the actual change:

| Type                           | Use for                                 | Group in App updates |
| ------------------------------ | --------------------------------------- | -------------------- |
| `feat`                         | New functionality                       | New features         |
| `fix`                          | Correcting broken behavior              | Fixes                |
| `perf`                         | Performance changes                     | Performance          |
| `refactor`                     | Restructuring existing code             | Improvements         |
| `style`                        | Styling or formatting changes           | Improvements         |
| `docs`                         | Documentation                           | Documentation        |
| `revert`                       | Reverting an earlier change             | Reverted             |
| `build`, `ci`, `chore`, `test` | Build, automation, maintenance or tests | Maintenance          |

For example:

```text
feat(pets): add persistent farming goals
fix(group): preserve live roster readiness
docs(release): explain release note formatting
chore(release): v0.7.26
```

Keep each commit focused on one coherent change. These rules also apply to
initial, merge, squash, revert and automated commits. Give merge and revert
commits explicit Conventional Commit subjects instead of Git's defaults. Avoid
unprefixed titles, `WIP`, `wip:` and unsupported types. An unrecognized release
entry remains a plain list item and is not included in the grouped change count.

Name working branches `<type>/<kebab-case-description>`, for example
`docs/readme-release-conventions`; `master` is exempt. Before committing, inspect
the staged diff. Before pushing or merging, validate every new commit subject,
the PR title and the final merge/squash subject against these rules. Preserve
issue references, release metadata and breaking-change footers when correcting
messages. PR descriptions should explain the problem, resulting behavior,
validation and remaining limitations; see [Contributing](../CONTRIBUTING.md).

### Breaking changes and version selection

Mark a breaking change with `!` in both the commit subject and PR title, and add a
`BREAKING CHANGE:` footer to the commit body explaining the compatibility impact
and required migration or recovery steps. For example:

```text
feat(recordings)!: introduce a new native recording format

BREAKING CHANGE: Older builds cannot open new recordings. Export needed reports
before upgrading and keep a backup of existing recordings.
```

This is an illustrative format change, not an announcement. The in-app renderer
detects `!` in the release entry, or `BREAKING CHANGE:` at the start of its
description. A footer in a commit or PR body alone cannot mark a generated entry
as breaking. When editing release notes, put migration instructions in an
indented bullet immediately under that change so they stay with it.

Version selection is separate from the title: merging into `master` requests a
patch release by default, including for `feat` or `!` titles. Add `release:minor`
or `release:major` to the PR **before merging** to request that increment; major
takes precedence. The workflow reserves `vX.Y.Z`, synchronizes the app manifests
and lock files, and publishes as `Aion Companion X.Y.Z`. Let it manage those
versions. See [Automatic releases](#automatic-releases) for manual runs, retries and packaging.

### Release descriptions and supported Markdown

Keep the workflow's installer/portable links, requirements and installation
guidance when editing a release body. Retain the generated `## What's Changed`
list and its `by @author in https://github.com/.../pull/123` suffixes so the app
can extract author attribution and clickable PR references. Use one top-level
bullet per change. A trailing `(#123)` also supplies a PR number, but does not
create a clickable PR reference in the app.

The following is an editing template; replace all `{placeholders}` with the
actual release details and describe only changes included in its tagged build:

```markdown
[Download Windows installer](https://github.com/nicholascostadev/aion-companion-public/releases/download/v{version}/AionCompanion-{version}-windows-x64-setup.exe) · [Portable ZIP](https://github.com/nicholascostadev/aion-companion-public/releases/download/v{version}/AionCompanion-{version}-windows-x64.zip)

{Keep the workflow's installation and requirements paragraphs here.}

## What's Changed

- feat(pets): add persistent farming goals by @author in https://github.com/nicholascostadev/aion-companion-public/pull/{number}
- fix(group): preserve live roster readiness by @author in https://github.com/nicholascostadev/aion-companion-public/pull/{number}
  - {Optional limitation, compatibility note or user action for this change.}

## Known limitations

{Include only verified limitations relevant to this release, or omit this section.}

**Full Changelog**: https://github.com/nicholascostadev/aion-companion-public/compare/v{previous}...v{version}
```

Use this Markdown subset so descriptions work both on GitHub and in Settings:

- Headings (`#` through `######`), paragraphs, bullet and numbered lists,
  blockquotes (`>`), fenced code blocks and horizontal rules are supported.
- Inline **bold**, _emphasis_, `code` and `[label](https://example.com)` links are
  supported. Use absolute HTTPS links for PRs, downloads and documentation;
  relative links, anchors and other URL schemes do not become clickable links.
- Use a single level of detail bullets indented by at least two spaces directly
  under a change. Deeper indentation is flattened; arbitrary nested Markdown
  structures are not supported. Separate headings, paragraphs and lists with
  blank lines.
- Avoid tables, images, HTML, task checkboxes, strikethrough and GitHub alert
  syntax in release bodies. They have no dedicated rendering; HTML stays literal
  text. Fenced code is displayed without syntax highlighting.
- Keep exactly one comparison line in the form `**Full Changelog**: https://...`.
  Use the bare absolute comparison URL, not a Markdown link, to get the dedicated
  changelog footer.

The app shows groups in this order: Breaking changes, New features, Fixes,
Performance, Improvements, Documentation, Reverted, Maintenance. Entries keep
their order within each group. Other Markdown follows the groups in its original
relative order, and the comparison link appears last. A heading such as
"What's Changed" disappears when its entire section was absorbed into groups.
Keep essential upgrade instructions attached to their change rather than relying
on an introductory paragraph appearing first.

Before publishing or editing notes, check the titles, version/tag, PR links,
download links, migration steps and comparison range. Check the result in
Settings → App updates as well as GitHub. The Dev build's labeled release-notes
sample demonstrates the layout; it does not fetch or validate a new release body.
The format is defined by the [release notes parser](../frontend/src/features/updates/releaseNotesModel.ts)
and its [regression tests](../frontend/src/features/updates/releaseNotesModel.test.ts);
update this guidance whenever that format changes.
