import { invoke } from '@tauri-apps/api/core';
import type { ShugoProfile } from '../lib/shugo';

/** Opens one character's Shugo.gg profile in the browser; native builds the address. */
export const openShugoProfile = ({ name, serverId }: ShugoProfile): Promise<void> =>
  invoke<unknown>('shugo_open_profile', { serverId, name }).then(() => undefined);

/** Copies one character's Shugo.gg profile address; native builds and copies it. */
export const copyShugoProfileLink = ({ name, serverId }: ShugoProfile): Promise<string> =>
  invoke<unknown>('shugo_copy_profile_link', { serverId, name }).then(String);
