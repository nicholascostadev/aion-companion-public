# Deferred publication

An explicit request to ship, push, create a PR, merge or release authorizes that work
to resume after the local publication window opens. A time restriction changes when
the requested operations happen; it preserves their scope. Explaining or configuring
this workflow does not authorize publication.

`AGENTS.md` defines "ship it" as commit, push and PR against `master`. Include merge
or release only when the user requests it. Releases use the local-release skill,
including its checks, exact source commit and recovery procedure.

## Prepare and queue

1. Read the local policy, including `git config --path --get publication.policyFile`,
   and run the publication check for the next requested operation. Continue immediately
   on success. Defer automatically only when the guard explicitly reports its work-hours
   restriction; configuration, validation and access failures require diagnosis.
2. Finish the authorized preparation and required checks. Review and stage only the
   intended files, and prepare the commit message, PR description or release inputs.
   Any step that itself commits or publishes waits for its matching guard to pass.
3. Record the request in Git's common directory under
   `publication-guard/pending/<job-id>.json`. Include a unique job ID, originating
   thread and user request, repository, absolute worktree, branch, base/target branch,
   HEAD, reviewed index tree (`git write-tree`), validation results, authorized steps
   and remaining steps. Record existing PR head/release identifiers where applicable.
   Treat the file as local state; preserve the user's request in the thread as the
   authority for its scope. Include reviewed paths and the relevant state needed to
   recognize unexpected edits. Never store credentials.
4. Recheck the guard after preparation. If now allowed, continue in this turn. Otherwise,
   read the installed `publication-guard/policy.json` from the common directory and
   calculate the next opening plus one minute in its timezone. The installed
   `next-window.cjs` helper prints `allowedNow`, `nextRunAt`, `localTime`, `timeZone`
   and `delayMs`; invoke it with Node. It calculates a wake-up, not permission to publish.
   An absent helper can be replaced by an equivalent read-only calculation from the
   policy using `Intl.DateTimeFormat`; use the current clock and UTC instants.
5. Discover T3's scheduler tools and inspect existing scheduled tasks before creating
   one. Reuse an existing pending job for the same request/worktree instead of creating
   duplicates. Call `schedule_task` with a structured interval object:
   `{ "type": "interval", "everyMs": delayMs }`, `bindToCurrentThread: true`, and
   a stable `clientRequestId` derived from the job ID. Recalculate the delay immediately
   before scheduling. The prompt must identify the job record and require the resume
   procedure below, including disabling the timer before publication.
6. Save the returned `scheduledTaskId` and `nextRunAt` in the record. Verify the returned
   instant is in the intended allowed window, correcting or disabling the task if it is
   not. Report the confirmed date and time in the policy's timezone. If scheduling fails
   or is unavailable, leave the job unscheduled and report that automatic resumption
   is unavailable. Creating a record alone does not queue execution.

The scheduler currently exposes recurring timers. This workflow uses one wake-up and
disables the timer at that wake-up. It does not repeatedly poll a denied publication
check. T3, the workspace and required credentials must be available at execution time;
sleeping or offline hosts can prevent execution at the requested instant.

## Resume once

1. Locate the job's scheduled task and disable it with `update_scheduled_task`
   (`enabled: false`) before any publication. Confirm success; if disabling fails,
   leave publication pending and report the failure. Read the current job record and
   reconcile any operations already completed. Completed, cancelled or superseded jobs
   perform no publication. Claim a pending job exclusively (for example, create its
   `.lock` file with exclusive creation) so duplicate deliveries cannot publish twice.
2. Verify the originating request still authorizes the remaining operations and has not
   been cancelled. Confirm the repository, worktree, branch, prepared tree and expected
   HEAD/PR state. Unexpected edits or replacement commits leave the job pending for
   review. New commits explicitly required by the authorized release workflow remain
   subject to its checks. A stale timer never authorizes publishing unrelated work.
3. Read the current policy and run the real publication check for the next operation.
   A late wake-up in another blocked window may schedule one replacement wake-up at
   the next opening. Other failures leave the job pending with an explanation. Keep
   hooks enabled and use actual commit timestamps.
4. Reuse validations only while their inputs still match. Refresh checks affected by
   authorized changes, base-branch movement or the release skill. Run the matching
   `git publication-check` immediately before each commit, push, PR, merge or release,
   including browser/API operations. Create PRs with `git guarded-pr`; register PRs
   with the thread through T3's `link_pull_request` when available.
   If a requested merge awaits required checks or review, use the available PR watcher
   and save the remaining steps before yielding. A watcher wake-up resumes this same
   job and rechecks the publication window before any further operation.
5. Execute only the remaining authorized steps. Check existing commits, remote branches,
   PRs, tags, drafts and assets before retrying an interrupted step. Save progress and
   resulting SHAs/URLs after each step. Mark the job complete when every requested step
   is verified; keep its timer disabled and report the outcome. On failure, report the
   unfinished step and retain its recovery state. Release failures use the release
   skill's recovery procedure.

## Update or cancel

An explicit request to change a queued action updates its existing job and preparation;
it does not silently broaden an older request. Record any newly authorized steps and
report the revised scope and confirmed wake-up time. A cancellation disables the
scheduled task and marks the job cancelled. Inspect pending records and scheduled tasks
before creating replacements, and remove the exclusive claim when the run ends. A claim
left after interruption requires checking the prior run and remote state before recovery.
