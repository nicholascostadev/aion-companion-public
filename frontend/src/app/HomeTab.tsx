import { HomePanel, type HomePanelProps } from '../features/home/HomePanel';
import { usePetCatalogue, usePets } from '../hooks/usePets';
import { usePageVisible } from '../hooks/usePageVisible';
import { usePetWindow } from '../hooks/usePetWindow';
import { useRecentLogs } from '../hooks/useRecentLogs';

export type HomeTabProps = Omit<HomePanelProps, 'pets' | 'radar' | 'petIndex' | 'recent'>;

/**
 * Workspace Home tab. It is mounted only while shown, so everything it reads on its own
 * stops with it: pets status every 5 s, the radar window every 2 s, the newest logs when the
 * library count changes, and the large pet catalogue only once there is a pet to name.
 * A minimised workspace pauses both polls.
 */
export function HomeTab(props: HomeTabProps) {
  const { native, libraryCount } = props;
  const paused = !usePageVisible();
  const pets = usePets(native, { intervalMs: 5000, paused });
  const radar = usePetWindow({ intervalMs: 2000, paused });
  const config = pets.status?.config;
  const wantsCatalogue =
    !!config &&
    (!!config.farming_goal || config.pinned_ids.length > 0 || !!pets.status?.gains.length);
  const catalogue = usePetCatalogue(native && wantsCatalogue);
  const recent = useRecentLogs(native, libraryCount);
  return (
    <HomePanel {...props} pets={pets} radar={radar} petIndex={catalogue.index} recent={recent} />
  );
}
