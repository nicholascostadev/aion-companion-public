# Bug reports

Reproduce the problem, open **Settings**, and choose **Download bug report**.
Send the downloaded `.aion-diagnostics.json` file to the developer manually with:

- What you were doing and how to reproduce the issue.
- What you expected and what happened instead.
- Approximately when it happened, and a screenshot if useful.

The report is generated locally. Downloading it does not send or upload it.
Export soon after the issue: recent logs replace older entries. A restart retains
recent logs, which can help investigate the previous session. Logs begin with the
version that introduced this feature; earlier sessions cannot be recovered.

## Contents and privacy

The versioned `aion-companion-diagnostics` JSON format contains build channel,
version and revision; OS and architecture; recent native and frontend errors;
capture/decoder counters; group readiness state; selected non-account settings;
window geometry, focus and visibility; basic webview environment details; and the
`crashes` section described under [Unexpected closes](#unexpected-closes).
It can contain game character names and IDs. Review the file before sharing it.

It excludes raw network packets and protocol hex dumps, recordings, saved combat
logs, crash minidumps and environment-variable dumps. It does not read account storage. Local home paths,
External URLs and common credential fields/messages are redacted on a best-effort
basis; packaged script locations are kept to make error stacks useful.
It does not collect screenshots or unrelated files.

Persistent logs live under the app data directory's `diagnostics` folder in
`support.jsonl` and `support.previous.jsonl`. Each file is limited to 512 KiB.
The report includes at most 512 recent persistent/in-memory log entries, plus a
bounded frontend error history. Repeated consecutive errors are coalesced.
Logging runs on a separate writer; disk failures do not prevent the in-memory
report. The report states persistence errors and dropped disk writes.

## Developer notes

`schema_version: 1` reports preserve errors for unavailable sections so one failed
subsystem does not prevent exporting the others. Capture snapshots avoid building
full combat reports or enabling packet tracing. Frontend logs forward into the
shared native journal so errors from the app's separate windows can be included.
Uncaught JavaScript errors, rejected promises, native command failures, capture
retries, storage failures, update errors and alert delivery errors are collected.
This report is useful evidence, but some issues will still need a recording,
screenshot or reproduction steps.

## Unexpected closes

The app keeps evidence for sessions that end without the player quitting. It is
stored locally in the same `diagnostics` folder and never uploaded:

- `session.json` marks the running session and is refreshed every 30 seconds
  with the time and the process's memory use. A normal exit records why the app
  quit: Quit in the app or tray, a launcher save-and-quit request, an update or
  backup restart, or the last window closing.
- `crashes/crash-<time>-panic.txt` is written before a Rust panic unwinds or
  aborts. It contains the panic message, source location and backtrace.
- `crashes/crash-<time>-native.txt` and `.dmp` are written for native faults such
  as access violations, stack overflows or heap corruption. The text report names
  the exception and the faulting module and offset; open the minidump in WinDbg
  or Visual Studio. The newest 10 crashes are kept.

On the next launch after an unclean exit, an error entry in the support log
summarizes the previous session: when it was last seen running, its memory use,
any crash reports, whether Windows restarted in the meantime, and matching
Windows event log records (Application Error, Application Hang and low-memory
warnings). If the app wrote no crash report and Windows recorded nothing,
something outside the app most likely ended the process, such as Task Manager or
security software.

**Download bug report** includes all of this in the same file: the support log
entries, plus a `crashes` section with the current and previous session markers,
the summary of how the previous session ended, and the newest 5 crash reports
(up to 200 lines each, sanitized line by line like the logs). Minidumps are not
included because they are binary and can contain process memory; each report
says whether its minidump is still on disk, so it can be requested separately.

Panic, crash and exit entries are written to disk before the app continues, not
through the background writer. A crash inside the webview's own processes does
not close the app, so it is not covered here.
