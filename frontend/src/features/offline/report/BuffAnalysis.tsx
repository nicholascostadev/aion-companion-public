import { Button } from '../../../components/ui/Button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from '../../../components/ui/Dialog';
import { Icon } from '../../../components/ui/Icon';
import { useTranslation } from '../../../i18n/provider';
import { BuffsView } from './BuffsView';
import { useReport } from './context';

/**
 * The full buff analysis, opened from the uptime panel beside the skills: the buff timeline,
 * the buffs on the boss and the party, the uptime summary and the buffs per skill. A sheet
 * over Combat details, so the player, the time window and the opened skill beneath stay as
 * they were; it shares that player and window, and Escape or its close button returns there.
 */
export function BuffAnalysis() {
  const { details, setDetails, player, names } = useReport();
  const { t } = useTranslation('reports');
  return (
    <Dialog open={details.buffs} onOpenChange={(open) => setDetails({ buffs: open })}>
      <DialogPopup className="h-[min(58rem,100%)] max-w-report">
        <header className="flex flex-none items-center gap-3 border-b border-line-soft px-5 py-3 max-[760px]:px-3.5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="m-0 text-md font-semibold tracking-tight">
              {player
                ? t(($) => $.buffs.analysis.titleFor, { name: names.entity(player.id) })
                : t(($) => $.buffs.analysis.title)}
            </DialogTitle>
            <DialogDescription className="m-0 text-xs text-ink-3">
              {t(($) => $.buffs.analysis.description)}
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="close" size={14} />}
                title={t(($) => $.buffs.analysis.closeTitle)}
              />
            }
          >
            {t(($) => $.buffs.analysis.close)}
          </DialogClose>
        </header>
        <div
          data-ui="buff-analysis"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-[760px]:px-3.5"
        >
          <BuffsView />
        </div>
      </DialogPopup>
    </Dialog>
  );
}
