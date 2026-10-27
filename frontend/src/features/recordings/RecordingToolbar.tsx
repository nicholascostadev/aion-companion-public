import { Button, buttonClasses } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';

interface RecordingToolbarProps {
  disabled: boolean;
  canSave: boolean;
  onDemo: () => void;
  onImport: (file: File | undefined) => void;
  onSave: () => void;
}

export function RecordingToolbar({
  disabled,
  canSave,
  onDemo,
  onImport,
  onSave,
}: RecordingToolbarProps) {
  const { t } = useTranslation('recordings');
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" icon={<Icon name="demo" size={13} />} disabled={disabled} onClick={onDemo}>
        {t(($) => $.toolbar.demo)}
      </Button>
      <label className={buttonClasses({ size: 'sm' })} aria-disabled={disabled}>
        <Icon name="fileUp" size={13} />
        {t(($) => $.toolbar.import)}
        <input
          type="file"
          accept=".json"
          hidden
          disabled={disabled}
          onChange={(event) => {
            onImport(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      <Button
        size="sm"
        icon={<Icon name="save" size={13} />}
        disabled={disabled || !canSave}
        onClick={onSave}
      >
        {t(($) => $.toolbar.save)}
      </Button>
    </div>
  );
}
