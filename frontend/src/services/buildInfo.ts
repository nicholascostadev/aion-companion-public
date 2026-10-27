import { invoke } from '@tauri-apps/api/core';
import type { AppBuildInfo } from '../types/buildInfo';

/** Native owns the channel; a Vite build alone cannot identify a standalone dev app. */
export async function readAppBuildInfo(): Promise<AppBuildInfo> {
  const raw = await invoke<AppBuildInfo>('app_build_info');
  if (!raw || (raw.channel !== 'development' && raw.channel !== 'stable'))
    throw new Error('Native returned no build channel');
  return raw;
}
