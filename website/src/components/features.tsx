import {
  BellRing,
  Compass,
  PanelsTopLeft,
  PawPrint,
  ScrollText,
  Swords,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FeatureId } from '@/i18n/en';

/** The icon for each feature; the words live in the dictionaries (src/i18n). */
export const FEATURE_ICONS: Record<FeatureId, LucideIcon> = {
  live: Swords,
  reports: ScrollText,
  group: Users,
  alerts: BellRing,
  pets: PawPrint,
  explore: Compass,
  windows: PanelsTopLeft,
};
