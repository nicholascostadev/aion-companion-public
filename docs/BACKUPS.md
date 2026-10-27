# Backup and restore

AION Companion can copy its own saved data into one backup file and bring it back later, on
the same computer or another one. Everything happens on this computer: there are no accounts
and nothing is uploaded. Backups use the app's own native format (`*.aion-backup.json`); no
other app's files are read or written.

## What a backup holds

A backup is not a copy of the whole app folder. You choose which parts to include:

| Part        | Files                    | Default | Holds                                                   |
| ----------- | ------------------------ | ------- | ------------------------------------------------------- |
| Settings    | `offline/settings.json`  | On      | Meter, trackers, hotkeys, language and privacy settings |
| Pet farming | `offline/pets.json`      | On      | Farming goals, pins and collection progress             |
| Saved logs  | `offline/logs/<id>.json` | Off     | Fights in your log library (can be large)               |

Left out on purpose: alert settings, alert history and custom alert sounds, the fight in
progress (its checkpoint) and the log index, the skill and NPC catalogue, window positions,
replay recordings, bug-report logs and temporary files.

Backups made by the stable app restore only into the stable app, and Development backups only
into a Development build.

Older backups that include Checklist can still restore their settings, pets and
logs. Retired checklist entries are skipped; existing local checklist files stay
untouched. A backup containing only retired entries has nothing to restore.

## Making a backup

Settings → **Backup and restore** → **Back up**.

1. Tick the parts to include. The size beside each part, and the line below ("About 50 kB in
   3 files"), are an estimate of the files as they are now. Capture keeps running while the
   backup is written; saving to these files only waits a moment while they are copied.
2. One backup holds at most the limits shown under the estimate (1,000 files, 64 MB in all,
   32 MB per file). A selection over a limit says which one and cannot be backed up; leave
   out saved logs, or export the logs you want to keep one by one from Logs.
3. Press **Back up…** and choose where to save in the Windows Save dialog. The backup must be
   saved outside the app's own data folder. When it is written, the panel shows where it went,
   how many files it holds and its size. Cancelling the dialog writes nothing.

Only one backup or restore step runs at a time; the other buttons wait until it finishes.

## Restoring

Settings → **Backup and restore** → **Restore**.

1. Press **Choose backup file…** and pick a backup in the Windows Open dialog. The app checks
   the whole file first (format, channel, version, every file's size and checksum). Nothing is
   restored by choosing a file. Cancelling the dialog changes nothing; choosing another file
   always clears the previous one first.
2. A checked backup shows when it was made, the app version and channel that made it, and
   every file it holds, grouped by part. Each file says whether it **Replaces** a file that is
   here now or **Adds** one that is not.
3. A backup is a snapshot: restoring a file brings it back as it was then, so anything saved
   to it since (new pickups, goals or settings) is lost. Only the files listed are written;
   anything here that is not listed, such as other saved logs, stays as it is.
4. **Restore and restart…** asks once more. **Apply and restart** saves collected results
   and closes the app; it opens again with the backup applied before capture starts.
   **Keep current data** (or Escape) closes the question; **Discard** forgets the file.
   Save or discard unsaved settings changes first: Apply waits until there are none.

A copy of every file a restore replaces is kept in the app's recovery folder. If the restore
cannot finish, those copies are put back, and the next start says so at the top of Backup and
restore; the native detail is under **Technical details**.

## For developers

- The file format, validation limits and the restart transaction are described in
  [BACKUP_FORMAT.md](BACKUP_FORMAT.md).

- Frontend: `frontend/src/features/backups` (panel and pure helpers), `hooks/useBackups.ts`
  (one step at a time, stale estimates dropped, a restore only ever applies the preview on
  screen), `services/backups.ts` (strict normalisers: a reply that cannot be read in full is
  an error, never a partial preview), `types/backups.ts`. Messages live in the `backups`
  namespace.
- Native commands: `backups_status`, `backups_plan`, `backups_export`, `backups_preview`,
  `backups_restore`, `backups_cancel`. `src-tauri/src/backup_dialog.rs` opens the Windows Save
  and Open dialogs owned by the main window; a cancelled dialog is `null`, not an error.
- Preview it with `npm run dev` and `/?mock` (Settings). `?mock=backup-restored` and
  `?mock=backup-rolled-back` start after a restore, `?mock=backup-cancel` cancels every
  dialog, `?mock=backup-large` exceeds the file limit and `?mock=failing` refuses the chosen
  file. The mock never quits.
