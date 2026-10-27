import { useEffect, useMemo, useRef } from 'react';
import { Card } from '../../components/ui/Panel';
import { useTranslation } from '../../i18n/provider';
import type { Recording, Snapshot } from '../../types/companion';

/** Reads a design token from the canvas's computed style, so the drawing follows the theme. */
const token = (element: Element, name: string) =>
  getComputedStyle(element).getPropertyValue(name).trim();

export function PositionReplay({
  recording,
  positions,
}: {
  recording: Recording | null;
  positions: Snapshot['positions'];
}) {
  const { t } = useTranslation('recordings');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo<[number, number, number, number]>(() => {
    const samples = recording?.events.filter((event) => event.kind === 'position') ?? [];
    return samples.length
      ? samples.reduce<[number, number, number, number]>(
          (result, sample) => [
            Math.min(result[0], sample.x),
            Math.min(result[1], sample.y),
            Math.max(result[2], sample.x),
            Math.max(result[3], sample.y),
          ],
          [Infinity, Infinity, -Infinity, -Infinity],
        )
      : [0, 0, 100, 100];
  }, [recording]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const colors = {
      grid: token(canvas, '--color-line-soft'),
      actor: token(canvas, '--color-accent'),
      boss: token(canvas, '--color-ember-ink'),
      halo: token(canvas, '--color-sunken'),
      ink: token(canvas, '--color-ink'),
    };
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = colors.grid;
    for (let x = 0; x < canvas.width; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    context.font = `500 12px ${token(canvas, '--font-sans')}`;
    const [minX, minY, maxX, maxY] = bounds;
    const scale = Math.min(430 / Math.max(1, maxX - minX), 250 / Math.max(1, maxY - minY));
    for (const [actor, [x, y]] of Object.entries(positions)) {
      const positionX = 25 + (x - minX) * scale;
      const positionY = 25 + (y - minY) * scale;
      // A dot ringed by the ground, so overlapping actors stay separate.
      context.fillStyle = colors.halo;
      context.beginPath();
      context.arc(positionX, positionY, 8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = actor === 'Boss' ? colors.boss : colors.actor;
      context.beginPath();
      context.arc(positionX, positionY, 6, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = colors.ink;
      context.fillText(actor, Math.min(positionX + 11, 400), positionY + 4);
    }
  }, [bounds, positions]);
  return (
    <Card title={t(($) => $.positions.title)} level={3} className="mb-0">
      <canvas
        ref={canvasRef}
        width="480"
        height="300"
        aria-label={t(($) => $.positions.label)}
        className="block h-auto w-full rounded-lg border border-line-soft bg-sunken"
      />
      <p className="mt-3 mb-0 text-xs text-ink-3">{t(($) => $.positions.hint)}</p>
    </Card>
  );
}
