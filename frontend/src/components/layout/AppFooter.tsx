import { useTranslation } from '../../i18n/provider';

export function AppFooter() {
  const { t } = useTranslation('workspace');
  return (
    <footer className="mx-auto max-w-workspace px-7 pt-2 pb-7 text-xs text-ink-4 max-[720px]:px-4">
      {t(($) => $.footer)}
    </footer>
  );
}
