import common from './locales/en/common.json';
import diagnostics from './locales/en/diagnostics.json';
import { createBundledI18n } from './bundled';

/**
 * The crash screen's English messages are packaged with the entry point, so a window whose
 * translation engine failed to start can still explain what happened and export a report.
 */
export const createCrashI18n = () => createBundledI18n({ en: { common, diagnostics } });
