import { useId } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { AtlasMap } from './atlas';

/** The maps to browse, the one shown pressed and the one you are on marked as yours. */
export function MapChooser({
  choices,
  shown,
  here,
  onChoose,
}: {
  choices: readonly AtlasMap[];
  /** Id of the map on screen. */
  shown: string;
  /** Id of the map you are on; null when not known. */
  here: string | null;
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation('maps');
  const id = useId();
  return (
    <div>
      <h3 className="m-0 mb-1.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase" id={id}>
        {t(($) => $.map.chooser)}
      </h3>
      <ul aria-labelledby={id} className="m-0 flex list-none flex-col gap-0.5 p-0">
        {choices.map((m) => {
          const on = m.id === shown;
          return (
            <li key={m.id}>
              <Pressable
                aria-pressed={on}
                className={selectableRow(
                  on,
                  'flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-sm',
                )}
                onClick={() => onChoose(m.id)}
              >
                <Icon
                  name="map"
                  size={14}
                  className={cn('shrink-0', on ? 'text-accent' : 'text-ink-3')}
                />
                <span className={cn('min-w-0 flex-1 truncate', on ? 'text-ink' : 'text-ink-2')}>
                  {m.name}
                </span>
                {m.id === here && (
                  <Badge tone="accent" shape="tag" dot="live">
                    {t(($) => $.map.here)}
                  </Badge>
                )}
              </Pressable>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
