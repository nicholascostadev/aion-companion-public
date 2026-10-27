import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Decimal MB. Maps are separate downloads; only compact interface artwork ships here.
export const bundleSizeLimits = {
  maps: 0,
  public: 8_000_000,
  dist: 11_000_000,
  installer: 15_000_000,
};

async function directoryBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in bundled assets: ${file}`);
      return entry.isDirectory() ? directoryBytes(file) : (await stat(file)).size;
    }),
  );
  return sizes.reduce((total, bytes) => total + bytes, 0);
}

export async function checkBundleSize(root, { built = false, limits = bundleSizeLimits } = {}) {
  const directories = [
    ['Map artwork', 'frontend/public/pet-map-art', limits.maps],
    ['All public assets', 'frontend/public', limits.public],
    ...(built ? [['Built frontend', 'dist', limits.dist]] : []),
  ];
  const measurements = await Promise.all(
    directories.map(async ([label, directory, limit]) => ({
      label,
      directory,
      bytes: await directoryBytes(path.join(root, directory)).catch((error) => {
        if (directory === 'frontend/public/pet-map-art' && error.code === 'ENOENT') return 0;
        throw error;
      }),
      limit,
    })),
  );
  return measurements;
}

export async function checkInstallerSize(file, limit = bundleSizeLimits.installer) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('The installer is not a file.');
  return { label: 'Setup installer', directory: file, bytes: info.size, limit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const installer = args.length === 2 && args[0] === '--installer' && !args[1].startsWith('--');
    if (!installer && !(args.length === 0 || (args.length === 1 && args[0] === '--dist')))
      throw new Error('Usage: check-bundle-size.mjs [--dist | --installer FILE]');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const measurements = installer
      ? [await checkInstallerSize(args[1])]
      : await checkBundleSize(root, { built: args.includes('--dist') });
    for (const { label, directory, bytes, limit } of measurements) {
      const exceeded = bytes > limit;
      console.log(
        `${exceeded ? 'FAIL' : 'OK'} ${label}: ${(bytes / 1_000_000).toFixed(2)} MB / ${(limit / 1_000_000).toFixed(0)} MB (${directory})`,
      );
      if (exceeded) process.exitCode = 1;
    }
    if (process.exitCode) {
      console.error(
        'Bundle size budget exceeded. Keep source artwork outside frontend/public and dist; optimize shipped assets before increasing a limit.',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
