/*
 * Which characters can be opened in the character profile window: an observed name on a
 * Global server. Native validates the same two facts (`src-tauri/src/profile_identity.rs`)
 * before reading NCSOFT's official service; the window's optional Shugo.gg link is built
 * from them too (`src-tauri/src/shugo.rs`). This side only decides whether to offer a link.
 */

/** A character observed by name together with the Global server it was seen on. */
export interface ShugoProfile {
  name: string;
  serverId: number;
}

/**
 * Global server ids are `[faction 1-2][sub-region 1-5][index]`. Korean and Taiwanese ids
 * (`10xx`, `20xx`) cannot tell those regions apart, so they get no link.
 */
const GLOBAL_SERVER = /^[12][1-5]\d\d$/;
/** No separators, controls or URL syntax: a placeholder like `Player #12` is never a name. */
const NAME = /^[^\s/\\?#%&+\p{Cc}]{1,32}$/u;

/** The profile to offer, or null when the name or server was not observed or is not Global. */
export function shugoProfile(
  name: string | null | undefined,
  serverId: number | null | undefined,
): ShugoProfile | null {
  if (typeof serverId !== 'number' || !GLOBAL_SERVER.test(String(serverId))) return null;
  if (!name || !NAME.test(name)) return null;
  return { name, serverId };
}
