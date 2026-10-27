const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js 22.12+ is required; found ${process.versions.node}.`);
  process.exitCode = 1;
}
