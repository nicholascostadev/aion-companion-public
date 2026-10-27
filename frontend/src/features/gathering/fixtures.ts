import { ALTGARD, VERTERON } from '../maps/atlas';

/*
 * TEST ONLY. Synthetic gathering data in the bundled file's shape: invented ids and points
 * (names and icon keys only so the art lookup is exercised), never production locations.
 */

export const NOW = 1_800_000_000_000;

/** Your sample position on Verteron, near the synthetic places. */
export const HERE = { x: 20_000, y: 150_000 };

export const SPOTS_FILE = {
  version: 1,
  resources: [
    {
      id: 10,
      category: 'ore',
      name: { en: 'Orichalcum', 'pt-BR': 'Orichalcum' },
      icon_key: 'Icon_Item_Gather_Ore_A_c_002',
      item_id: 100,
    },
    {
      id: 20,
      category: 'ore',
      name: { en: 'Orichalcum', 'pt-BR': 'Orichalcum' },
      icon_key: 'Icon_Item_Gather_Ore_A_c_002',
      item_id: 100,
    },
    {
      id: 11,
      category: 'food',
      name: { en: 'Cypri', 'pt-BR': 'Cypri' },
      icon_key: 'Icon_Item_Gather_Food_L_c_006',
      item_id: 200,
    },
    // A second native resource yielding the same item: one Cypri in every list.
    {
      id: 12,
      category: 'food',
      name: { en: 'Cypri', 'pt-BR': 'Cypri' },
      icon_key: 'Icon_Item_Gather_Food_L_c_006',
      item_id: 200,
    },
    // No verified art: its written label stands in.
    {
      id: 13,
      category: 'food',
      name: { en: 'Kukuru', 'pt-BR': 'Kukuru' },
      icon_key: null,
      item_id: 300,
    },
    {
      id: 14,
      category: 'gemstone',
      name: { en: 'Ruby', 'pt-BR': 'Rubi' },
      icon_key: 'Icon_Item_Gather_Gemstone_A_c_004',
      item_id: 400,
    },
    {
      id: 24,
      category: 'gemstone',
      name: { en: 'Ruby', 'pt-BR': 'Rubi' },
      icon_key: 'Icon_Item_Gather_Gemstone_A_c_004',
      item_id: 400,
    },
    {
      id: 15,
      category: 'herb',
      name: { en: 'Aria', 'pt-BR': 'Aria' },
      icon_key: 'Icon_Item_Gather_Herb_L_c_001',
      item_id: 500,
    },
    // Skipped: an unknown category and a missing name.
    {
      id: 16,
      category: 'fish',
      name: { en: 'Trout', 'pt-BR': 'Truta' },
      icon_key: null,
    },
    { id: 17, category: 'ore', name: {}, icon_key: null, item_id: 900 },
  ],
  maps: [
    {
      map_id: VERTERON,
      groups: [
        {
          id: 'ore_a',
          env_object_ids: [10],
          points: [
            [20_500, 150_000, 0],
            [20_520, 150_010, 0],
            [40_000, 160_000, 0],
          ],
        },
        { id: 'food_a', env_object_ids: [11], points: [[21_500, 150_000, 0]] },
        { id: 'food_b', env_object_ids: [12], points: [[22_500, 151_000, 0]] },
        { id: 'food_c', env_object_ids: [13], points: [[19_000, 149_000, 0]] },
        { id: 'gem_a', env_object_ids: [14], points: [[30_000, 150_000, 0]] },
        { id: 'herb_a', env_object_ids: [15], points: [[20_000, 155_000, 0]] },
        // Skipped: two resources in one group, an unknown resource, no finite points.
        { id: 'mixed', env_object_ids: [10, 11], points: [[0, 0, 0]] },
        { id: 'unknown', env_object_ids: [99], points: [[0, 0, 0]] },
        {
          id: 'empty',
          env_object_ids: [10],
          points: [
            [Number.NaN, 0, 0],
            ['x', 1],
          ],
        },
      ],
    },
    {
      map_id: ALTGARD,
      groups: [
        {
          id: 'ore_d',
          env_object_ids: [20],
          points: [
            [-140_000, -70_000, 0],
            [-139_000, -71_000, 0],
          ],
        },
        { id: 'gem_d', env_object_ids: [24], points: [[-130_000, -60_000, 0]] },
      ],
    },
    // Skipped: no original art for this map.
    {
      map_id: 'World/Nowhere',
      groups: [{ id: 'x', env_object_ids: [10], points: [[0, 0, 0]] }],
    },
  ],
} as const;
