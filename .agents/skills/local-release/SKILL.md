---
name: local-release
description: Build, validate and publish a new stable Aion Companion GitHub release from this Windows computer. Use for $local-release, "release from my computer", "publish a new GitHub release locally", or resuming a failed local publication. This publishes a release; ordinary Dev builds and "ship it" PR work use their existing workflows.
---

# Local release

Publish a tested stable installer and portable assets to this repository's GitHub
releases, using local Windows builds. A bare invocation requests a patch release.
Honor an explicit minor or major request. Invocation authorizes the necessary
release version commit, tag, push, asset upload and final publication; proceed
through those steps once verified unless the user requested a preview or draft.

## Read the project contract

Resolve paths from the repository root, including when this file is reached via
the Claude discovery entry. Read:

- `AGENTS.md` and `docs/AGENT_WORKFLOW.md` for branch, commit and shell rules.
- `docs/RELEASING.md`, especially **Publish from a local computer**, **Local
  packaging** and the signing requirements.
- `docs/RELEASING.md#commits-pull-requests-and-release-notes` before composing notes.

Use Git Bash and `bash dev.sh`; run `bash dev.sh doctor` if tools are missing.
The release procedure in `docs/RELEASING.md` is the source of truth. Read the
current scripts and workflow before executing rather than relying on cached flags.

## Execute the local publication

1. Confirm the GitHub repository, access, visibility, latest stable release,
   remote tags and release-workflow activity. Use the latest fetched
   `origin/master` as the source unless the user names another source. Preserve
   the caller's worktree by building in a separate clean release worktree. An
   unmerged feature branch or dirty worktree is not silently included. If the
   requested source needs a merge, resolve that choice with the user; a release
   request does not authorize merging a PR.
2. Record the fetched master SHA, chosen source SHA, bump, version, tag, release SHA and artifact paths for
   retry. Use `scripts/release-version.mjs` to synchronize app versions, inspect
   the staged version-only diff and commit as `chore(release): vX.Y.Z`. Validate
   every commit subject that will be pushed. Keep the remote unchanged until
   this exact commit has passed the documented checks and local packaging.
3. Run the complete **Local packaging** sequence with the environment provided
   by `bash dev.sh exec --`. Use stable `custom-protocol` build flags and the
   release-profile tests for both identities. Package through `bash dev.sh package`
   into a new output directory. Verify every packaged checksum and the
   expected installer, executable, ZIP, notices and requirements files. Preserve
   configured signing failures rather than producing an unsigned fallback.
4. Recheck the remote, then atomically push the tested version commit to
   `master` and its matching tag as described in the local publication procedure.
   A concurrent update requires a fresh source/version and rebuild, not a force
   push or moved tag. Use the local route only; dispatching **Release Windows**
   would ask CI to reserve and build another version.
5. Prepare the installation prefix from the release workflow and generate notes
   for the exact new tag from the previous published stable tag. Follow the release-note
   renderer contract, preserving Conventional Commit PR titles, attribution,
   migration details and the full comparison link. For a first release omit the
   previous-tag argument and do not invent a comparison range.
6. Create or resume a draft for this tag, upload the verified assets and review
   its body and asset hashes. Publish it as a non-draft, non-prerelease, latest
   release once complete. Preserve repository visibility: a published release in
   a private repository is still private. Report that access limitation clearly;
   making the repository public requires a separate explicit instruction.
7. Read back the release and remote tag. Verify the tag resolves to the tested
   SHA, all expected assets match the local hashes and the release is published
   with the intended stable/latest status. Report the release URL, version/tag,
   source and release SHAs, validation, signing status and access restrictions.

## Failures and retries

Stop publication on a failed check, packaging error, hash mismatch, authentication
failure or conflicting remote state, and report the failed step. Keep the release
worktree and artifacts for recovery. After a lost push/upload/publish response,
query GitHub before retrying: resume a matching tag/draft, upload only missing
assets, and treat an already-published matching release as complete. An existing
tag or asset with different content is a conflict to resolve, not an overwrite.
Keep a bounded retry; if a concurrent release wins again, report the conflict.

For a preview request, perform only the requested read-only planning/preflight
and explain the commands and expected output. Do not create commits, tags, drafts
or releases as part of a preview or a skill evaluation.
