export type BuildChannel = 'development' | 'stable';

export interface AppBuildInfo {
  channel: BuildChannel;
  version: string;
  branch: string;
  revision: string;
  live_reload: boolean;
}
