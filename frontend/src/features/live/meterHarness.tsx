import { DpsOverlay } from './DpsOverlay';
import { useMeter, type MeterSources } from './meterState';

type ViewProps = Omit<Parameters<typeof DpsOverlay>[0], 'meter'>;

export type MeterProps = Omit<MeterSources, 'copyText'> &
  ViewProps & {
    /** Copies text to the clipboard; the meter copies exactly what it shows. */
    onCopyText?: (text: string) => Promise<void>;
  };

/**
 * The DPS meter as `OverlayApp` composes it, `useMeter` feeding `DpsOverlay`, for render
 * tests that need its wiring, DOM, words or accessibility. Decisions about what it shows are
 * tested at `meterState` instead.
 */
export function Meter({
  status,
  overlay,
  error,
  busy,
  offline,
  group,
  library,
  onCopyText,
  ...view
}: MeterProps) {
  const meter = useMeter({
    status,
    overlay,
    error,
    busy,
    offline,
    group,
    library,
    copyText: onCopyText,
  });
  return <DpsOverlay meter={meter} {...view} />;
}
