import { useTranslation } from '../../i18n/provider';
import { HOTKEY_ACTIONS, hotkeyLabel } from '../offline/settingsModel';
import type { SearchEntry } from './categories';

/**
 * Every Settings section with the names of the settings inside it, in the interface
 * language, for Settings search. Only one category is on screen at a time, so search reads
 * this list rather than the page.
 */
export function useSettingsSearch(): SearchEntry[] {
  const { t } = useTranslation(['settings', 'setup', 'backups', 'updates', 'diagnostics']);
  return [
    {
      key: 'region',
      title: t(($) => $.region.title),
      terms: [
        t(($) => $.language.label),
        t(($) => $.region.gameRegion),
        t(($) => $.region.global),
        t(($) => $.region.twkr),
      ],
    },
    {
      key: 'privacy',
      title: t(($) => $.privacy.title),
      terms: [t(($) => $.privacy.hideNames), t(($) => $.privacy.copyLive)],
    },
    {
      key: 'meter',
      title: t(($) => $.meter.title),
      terms: [
        t(($) => $.meter.dpsShown),
        t(($) => $.meter.encounter),
        t(($) => $.meter.active),
        t(($) => $.meter.targets),
        t(($) => $.meter.bosses),
        t(($) => $.meter.partyOnly),
        t(($) => $.meter.idleTimeout),
        t(($) => $.meter.refresh),
      ],
    },
    {
      key: 'dummy',
      title: t(($) => $.dummy.title),
      terms: [t(($) => $.dummy.length), t(($) => $.dummy.cooldown)],
    },
    {
      key: 'appearance',
      title: t(($) => $.appearance.title),
      terms: [
        t(($) => $.appearance.opacity),
        t(($) => $.appearance.scale),
        t(($) => $.appearance.fadeAfter),
        t(($) => $.appearance.fadeOpacity),
        t(($) => $.appearance.compactStrip),
      ],
    },
    {
      key: 'hotkeys',
      title: t(($) => $.hotkeysSection.title),
      terms: HOTKEY_ACTIONS.map((action) => hotkeyLabel(t, action)),
    },
    {
      key: 'library',
      title: t(($) => $.library.title),
      terms: [
        t(($) => $.library.autoSave),
        t(($) => $.library.save),
        t(($) => $.library.reset),
        t(($) => $.library.openFolder),
        t(($) => $.library.clear),
      ],
    },
    {
      key: 'catalogue',
      title: t(($) => $.catalogue.title),
      terms: [t(($) => $.catalogue.import)],
    },
    {
      key: 'backups',
      title: t(($) => $.backup.title, { ns: 'backups' }),
      terms: [
        t(($) => $.title, { ns: 'backups' }),
        t(($) => $.groups.settings, { ns: 'backups' }),
        t(($) => $.groups.pets, { ns: 'backups' }),
        t(($) => $.groups.logs, { ns: 'backups' }),
      ],
    },
    {
      key: 'restore',
      title: t(($) => $.restore.title, { ns: 'backups' }),
      terms: [t(($) => $.title, { ns: 'backups' })],
    },
    {
      key: 'setup',
      title: t(($) => $.title, { ns: 'setup' }),
      terms: [
        t(($) => $.windows.name, { ns: 'setup' }),
        t(($) => $.webview2.name, { ns: 'setup' }),
        t(($) => $.npcap.name, { ns: 'setup' }),
        t(($) => $.githubCli.name, { ns: 'setup' }),
      ],
    },
    {
      key: 'updates',
      title: t(($) => $.title, { ns: 'updates' }),
      terms: [t(($) => $.check, { ns: 'updates' }), t(($) => $.access.title, { ns: 'updates' })],
    },
    {
      key: 'diagnostics',
      title: t(($) => $.panel.title, { ns: 'diagnostics' }),
      terms: [t(($) => $.steps.download, { ns: 'diagnostics' })],
    },
    {
      key: 'capabilities',
      title: t(($) => $.capabilities.title),
      terms: [],
    },
  ];
}
