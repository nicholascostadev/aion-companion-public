import manifest from '../../data/pet-map-art.json';
import type { PetMap, PetMapArt } from '../../types/pets';

/*
 * The game's own world maps for any feature that draws on them, built straight from the
 * bundled manifest of original map textures and their calibration
 * (`frontend/src/data/pet-map-art.json`), so a window never loads the pet catalogue just
 * to show a map. Tiles and overviews are the same files the catalogue serves.
 */

export const VERTERON = 'World/World_L/World_L_A';
export const ALTGARD = 'World/World_D/World_D_A';
export const RESHANTA = 'Intersever/Abyss/Abyss_Reshanta_A';

/** A world map with its original art; `zone_ids` stay empty (the manifest has none). */
export interface AtlasMap extends PetMap {
  art: PetMapArt;
}

const FOLDER = '/pet-map-art/';

function build(): ReadonlyMap<string, AtlasMap> {
  const maps = new Map<string, AtlasMap>();
  for (const m of manifest.maps) {
    const tiles = manifest.images
      .filter((image) => image.map_ids.includes(m.id))
      .map((image) => ({
        file: FOLDER + image.file,
        x: image.column * m.tile_size,
        y: image.row * m.tile_size,
        width: image.width,
        height: image.height,
      }));
    if (!tiles.length) continue;
    const overview = manifest.overviews.find((o) => o.map_id === m.id);
    const half = m.world_size / 2;
    maps.set(m.id, {
      id: m.id,
      name: m.title,
      zone_ids: [],
      bounds: [-half, -half, half, half],
      art: {
        width: m.width,
        height: m.height,
        scale: m.scale,
        offset_x: m.offset_x,
        offset_y: m.offset_y,
        tiles,
        overview: overview
          ? {
              file: FOLDER + overview.file,
              width: overview.width,
              height: overview.height,
            }
          : null,
        approximate: m.calibration !== 'verified',
      },
    });
  }
  return maps;
}

/** Every map with original art, by catalogue id. */
export const ATLAS = build();

/** The map with this catalogue id; null for an unknown or missing id. */
export const atlasMap = (id: string | null | undefined): AtlasMap | null =>
  (id && ATLAS.get(id)) || null;
