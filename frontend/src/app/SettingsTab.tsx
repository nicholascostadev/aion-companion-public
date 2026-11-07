import { BackupsPanel } from '../features/backups/BackupsPanel';
import { DiagnosticsPanel } from '../features/diagnostics/DiagnosticsPanel';
import {
  EngineCapabilities,
  SettingsPanel,
  useCatalogueImport,
  type DraftCategory,
} from '../features/offline/SettingsPanel';
import type { SettingsDraft } from '../features/offline/settingsModel';
import { draftStates, type SettingsCategory } from '../features/settings/categories';
import { SettingsView, type CategoryMark } from '../features/settings/SettingsView';
import { SetupPanel } from '../features/setup/SetupPanel';
import { UpdatesPanel } from '../features/updates/UpdatesPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { BackupsState } from '../types/backups';
import type { DiagnosticsReport } from '../types/diagnostics';
import type {
  CatalogueSummary,
  OfflineActionName,
  OfflineSettings,
  PolledOfflineStatus,
} from '../types/offline';
import type { SetupDistribution, SetupState } from '../types/setup';
import type { UpdateAccessState } from '../types/updateAccess';
import type { UpdatesState } from '../types/updates';

/** The width at which the category rail stands beside the page (matches its layout). */
const WIDE = '(min-width: 960px)';

/**
 * The Settings tab: one category of settings at a time beside the category rail. The saved
 * settings draft spans the first categories; Data, Setup, Updates and Diagnostics act at
 * once. A category with unsaved changes, a field to fix, setup to do or an update waiting
 * says so in the rail.
 */
export function SettingsTab({
  category,
  onCategoryChange,
  onOpenSection,
  native,
  status,
  saved,
  draft,
  busy,
  onAction,
  onImportCatalogue,
  onCopySummary,
  setup,
  distribution,
  backups,
  updates,
  updateAccess,
  diagnostics,
}: {
  category: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  onOpenSection: (id: string) => void;
  native: boolean;
  status: PolledOfflineStatus | null;
  /** The settings native holds, which the draft is compared against. */
  saved: OfflineSettings | null;
  draft: SettingsDraft;
  busy: boolean;
  onAction: (action: OfflineActionName) => Promise<boolean>;
  onImportCatalogue: (json: string) => Promise<CatalogueSummary>;
  onCopySummary: (multiline: boolean) => Promise<void>;
  setup: SetupState;
  distribution: SetupDistribution | undefined;
  backups: BackupsState;
  updates: UpdatesState;
  /** GitHub access for private release updates, when this copy needs it. */
  updateAccess: UpdateAccessState | undefined;
  diagnostics: DiagnosticsReport;
}) {
  const wide = useMediaQuery(WIDE);
  const catalogueImport = useCatalogueImport(onImportCatalogue);
  // A restart would lose unsaved settings, so restore and update wait for them.
  const restartBlocked = draft.dirty || draft.saving;
  const draftPage = (c: DraftCategory) => (
    <SettingsPanel
      category={c}
      status={status}
      draft={draft}
      native={native}
      busy={busy}
      onAction={onAction}
      catalogueImport={catalogueImport}
      onCopySummary={onCopySummary}
    />
  );

  const marks: Partial<Record<SettingsCategory, CategoryMark>> = draftStates(
    draft.draft,
    saved,
    draft.errors,
  );
  const probe = setup.status;
  if (
    probe?.platform_supported &&
    (!probe.webview2_ready ||
      probe.npcap.state === 'missing' ||
      probe.npcap.state === 'unavailable')
  )
    marks.setup = 'attention';
  const phase = updates.status?.phase;
  if (phase === 'available' || phase === 'downloading' || phase === 'ready')
    marks.updates = 'update';

  return (
    <SettingsView
      category={category}
      onCategoryChange={onCategoryChange}
      onOpenSection={onOpenSection}
      marks={marks}
      wide={wide}
      pages={{
        general: draftPage('general'),
        meter: draftPage('meter'),
        appearance: draftPage('appearance'),
        hotkeys: draftPage('hotkeys'),
        data: (
          <>
            {draftPage('data')}
            <BackupsPanel native={native} backups={backups} restartBlocked={restartBlocked} />
          </>
        ),
        setup: <SetupPanel native={native} setup={setup} distribution={distribution} />,
        updates: (
          <UpdatesPanel
            native={native}
            updates={updates}
            restartBlocked={restartBlocked}
            distribution={distribution ?? 'private'}
            onOpenLink={setup.open}
            access={updateAccess}
          />
        ),
        diagnostics: (
          <>
            <DiagnosticsPanel native={native} report={diagnostics} />
            <EngineCapabilities status={status} />
          </>
        ),
      }}
    />
  );
}
