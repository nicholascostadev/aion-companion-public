# Native backup format and recovery

The backup center uses this app's `.aion-backup.json` format. It does not read any
other application's state. No compression, cloud account or new dependency is
required. SHA-256 comes from the existing desktop dependency; hashes detect
corruption and are not signatures or proof of who created a file.

## Included state

The user chooses three categories independently:

| Category          | Allowed entries                                                           |
| ----------------- | ------------------------------------------------------------------------- |
| Settings          | `offline/settings.json`, including locale, trackers and hotkeys           |
| Pets              | `offline/pets.json`, including collections, pins, goals and legacy routes |
| Saved combat logs | `offline/logs/<native-log-id>.json`                                       |

Missing files are omitted. Selecting logs includes all currently saved native log
files within the limits; no logs are silently truncated. An invalid selected file
fails the export instead of making an incomplete backup look successful.

The active encounter checkpoint, derived library index, catalogue overrides,
native alert settings/history, custom sounds, window geometry, replay recordings,
diagnostics and temporary files are excluded. This is a selected-state backup,
not a full clone of the application data directory. Existing individual native
log and recording exports remain available independently.

Current limits are 1,000 entries, 32 MiB per entry, 64 MiB of original file
contents and 128 MiB for the serialized backup. The backend reports these limits
to the interface. Existing native log inspection still supports its separate
256 MiB limit. A large library may need individual log exports in addition to a
backup of preferences and progress.

## Schema 1

The top-level object has exactly `kind`, `schema_version`, `channel`, `created_ms`,
`app_version` and `entries`. The kind is `aion-companion-backup`; the schema
version is `1`; channel is the source build's `stable` or `development` channel.
Creation time is Unix milliseconds and app version is a semantic version.

Every entry has exactly `path`, `bytes`, `sha256` and `contents`. Contents are the
original UTF-8 JSON text, retained byte-for-byte after decoding the container's
JSON string. The size and lowercase SHA-256 digest cover those original bytes.
The app checks sizes, hashes, case-insensitive duplicate paths, the fixed path
allowlist and each native file's supported schema/structure before any restore.
Log IDs must match their file names. Device names, links/junctions inside the
profile and paths outside the allowlist are rejected. Future backup schemas and
cross-channel restores are refused. A file from a newer app version can be used
only when this build understands the backup schema and every included native
file; the version string alone is not a compatibility guarantee.

Native log versions 0 and 1 are supported explicitly with legacy optional-field
defaults. Validation also bounds arrays, strings, coordinates, timestamps and
the total event amount to avoid report arithmetic overflow. A bare object is
not treated as an empty log. The reset checkpoint has a separate explicit
empty-log case and is never portable backup content.

Older schema-1 backups may include `checklist.json`. Its size and checksum are
verified, then the retired entry is omitted from preview and restore. A backup
containing only retired entries reports that there is no supported data to restore.
Existing local checklist files are left untouched. Recovery journals created by
older builds can still roll back checklist files after an interrupted restore.

## Snapshot and export

The desktop command drains prepared capture/storage work, then takes the shared
durable-file snapshot barrier. The barrier covers settings/log/pet atomic writes,
and log removals. It is held only while the selected files are
copied into a bounded owned snapshot; hashing, JSON validation, serialization,
the destination-space check and the final export happen after it is released.
Capture keeps running; it is not stopped or reset for export.

The Windows Save dialog selects the destination. The app checks available space
for the temporary output and writes/syncs a unique sibling temporary file before
replacing the selected destination. Export cannot target the active profile's
data directory. An OS write or replacement failure is reported; previous output
is retained when replacement did not succeed.

## Preview and restart transaction

Opening a backup validates it and caches its exact contents in native memory.
The preview lists every destination and whether it currently exists. Choosing
another file invalidates the previous token even when the second dialog is
cancelled or its file is invalid. Export/preview/restore operations are serialized.
Only the current preview token can stage a restore. Selected settings' shortcuts
are parsed and checked for duplicates as part of validation.

The explicit restore action stages the validated input under
`recovery/<transaction-id>/incoming.json` and writes `recovery/pending.json`.
It launches a hidden instance of the current executable that waits for the old
PID to exit before acquiring the capture guard. The old process uses the existing
save-and-quit transaction. If shutdown saving fails, the helper is stopped and
the pending pointer is cancelled, leaving the old process available.

Before loading durable state on the next start:

1. Validate the staged backup again and check space for incoming replacements,
   rollback copies and temporary files.
2. Copy the current selected destinations byte-for-byte into the transaction's
   `rollback` directory, recording which destinations did not exist. Existing
   invalid bytes are still preserved for rollback.
3. Sync a `prepared` journal before replacing any selected file. Apply the whole
   batch using atomic per-file replacement. If logs are restored, include the
   original derived index in rollback and invalidate it for rebuilding.
4. Mark the journal `applied`. Load application state and set up the desktop.
   Commit only when that setup succeeds; automatic capture starts afterwards.
5. Retain rollback copies and the journal locally; remove the pending pointer.

A write failure rolls back all selected destinations, removes newly added files
and restores the old derived index. A process interruption after preparation is
rolled back on the next launch instead of resuming a half-applied restore. A
startup/setup failure also requests rollback. Unselected files, including logs
absent from the backup, are not deleted. A committed journal is not rolled back
merely because the pointer cleanup was interrupted.

Preparation failures before a journal exists cancel that attempt and expose a
failed result while the original profile remains available. If an existing
journal or rollback copy is corrupt, or rollback itself cannot write, startup
stops with the recovery material preserved; it never guesses which mixed state
to accept. `recovery/result.json` supplies the last outcome to the localized UI.
Rollback copies are not an automatic retention or cloud-backup service.

## Startup corruption handling

Offline settings, catalogue overrides, the active checkpoint and the derived
index use bounded reads and structural checks. Invalid originals are moved to
unique sibling `.invalid-<timestamp>` files before defaults or a rebuilt index
are used, with a reported explanation. Supported legacy optional fields are
preserved deliberately. Alerts and Pets retain their existing
preserve/read-only behavior.

## Verification

Native regression fixtures cover byte-for-byte snapshot/export roundtrips,
explicit selection, bad checksums and sizes, future schemas, channel mismatch,
duplicate/traversal/device paths, interrupted recovery, an injected replacement
failure after the first write, setup failure, unselected-log preservation,
derived-index rollback, missing/corrupt staged input, shortcut conflicts and
operation serialization. Core validation tests cover legacy records, invalid
startup-state preservation and arithmetic/time bounds. Browser mocks verify UI
and IPC behavior; they do not establish Windows dialog or live-gameplay behavior.
