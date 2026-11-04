import { useTranslation } from '../../i18n/provider';

/** Slot names the service uses, in the app's words; numbered slots keep their number. */
const SLOTS = [
  'MainHand',
  'SubHand',
  'Helmet',
  'Shoulder',
  'Torso',
  'Pants',
  'Gloves',
  'Boots',
  'Cape',
  'Necklace',
  'Earring',
  'Ring',
  'Bracelet',
  'Belt',
  'Amulet',
  'Rune',
  'Arcana',
] as const;
type Slot = (typeof SLOTS)[number];

const isSlot = (name: string): name is Slot => (SLOTS as readonly string[]).includes(name);

/**
 * `Ring2` → "Ring 2", `EarringL` → "Earring (left)". A slot the app has no word for (an
 * appearance slot named after a weapon type, a new slot) keeps the service's name.
 */
export function useSlotName() {
  const { t } = useTranslation('profile');
  return (slotName: string) => {
    const match = /^([A-Za-z]+?)(\d+|L|R)?$/.exec(slotName);
    const base = match?.[1] ?? slotName;
    const suffix = match?.[2];
    if (!isSlot(base)) return slotName;
    const word = t(($) => $.slots[base]);
    if (suffix === 'L') return t(($) => $.slots.left, { slot: word });
    if (suffix === 'R') return t(($) => $.slots.right, { slot: word });
    return suffix ? `${word} ${suffix}` : word;
  };
}
