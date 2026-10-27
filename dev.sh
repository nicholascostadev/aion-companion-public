#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/dev-env.sh"

usage() {
  cat <<'USAGE'
Usage: bash dev.sh <command> [options]
  doctor                         Show checkout, tools and development log locations
  exec -- <command> [arguments]   Run a command with the discovered Node/Rust tools
  build [--test] [--run] [--target-dir PATH]
                                 Build and publish a standalone Dev executable
  dev [--target-dir PATH]         Start native Dev with live reload
  check [--native]                Run frontend checks; optionally all native checks
  install-stable [--version VERSION] [--run]
                                 Install a verified published stable release
  package [--executable PATH] [--output-dir PATH]
                                 Package a stable executable (does not publish)
USAGE
}

doctor() {
  printf 'Checkout: %s\nBranch: %s\nBash: %s\n' "$AION_ROOT" "$(git -C "$AION_ROOT" branch --show-current)" "$BASH_VERSION"
  local tool missing=0
  for tool in git node npm cargo rustc rg powershell.exe; do
    if command -v "$tool" >/dev/null 2>&1; then printf '%s: %s\n' "$tool" "$(command -v "$tool")"
    else printf '%s: MISSING\n' "$tool"; missing=1; fi
  done
  if command -v node >/dev/null 2>&1; then
    node --version
    node "$AION_ROOT/scripts/check-node-version.mjs" || missing=1
  fi
  if command -v cargo >/dev/null 2>&1; then cargo --version || missing=1; fi
  [[ -d "$AION_ROOT/node_modules" ]] || printf 'Dependencies: not installed; run bash dev.sh exec -- npm ci\n'
  printf 'Dev log: %s/AionCompanionDev/development.log\n' "${LOCALAPPDATA:-%LOCALAPPDATA%}"
  printf 'Native builds require Microsoft C++ Build Tools and WebView2; live capture also needs Npcap.\n'
  return "$missing"
}

dependencies() {
  aion_require node
  aion_require npm
  node scripts/check-node-version.mjs
  if [[ ! -d node_modules ]]; then npm ci; fi
}

command_name=${1:-help}
if (( $# )); then shift; fi
cd -- "$AION_ROOT"
case "$command_name" in
  help|--help|-h) usage ;;
  doctor) (( $# == 0 )) || { usage >&2; exit 2; }; doctor ;;
  exec)
    if [[ ${1:-} == -- ]]; then shift; fi
    (( $# )) || { usage >&2; exit 2; }
    exec "$@"
    ;;
  build|dev)
    run=0; test_first=0; target="$AION_ROOT/target/development"
    while (( $# )); do
      case "$1" in
        --run) [[ $command_name == build ]] || { usage >&2; exit 2; }; run=1; shift ;;
        --test) [[ $command_name == build ]] || { usage >&2; exit 2; }; test_first=1; shift ;;
        --target-dir) (( $# >= 2 )) && [[ -n $2 && $2 != --* ]] || { usage >&2; exit 2; }; target=$2; shift 2 ;;
        *) usage >&2; exit 2 ;;
      esac
    done
    aion_require cargo
    dependencies
    target=$(aion_path "$target")
    if [[ $command_name == dev ]]; then
      aion_windows scripts/start-dev.ps1 -TargetDirectory "$target"
    else
      if (( test_first )); then
        npm run check
        cargo test --locked -p companion-core -p companion-capture
      fi
      npm run build
      cargo build --locked -p aion-companion --features custom-protocol,development --target-dir "$target"
      aion_windows scripts/publish-desktop.ps1 -Executable "$target/debug/aion-companion.exe"
      if (( run )); then aion_windows scripts/run-dev.ps1; fi
    fi
    ;;
  check)
    native=0
    if [[ ${1:-} == --native ]]; then native=1; shift; fi
    (( $# == 0 )) || { usage >&2; exit 2; }
    dependencies
    npm run check
    if (( native )); then
      aion_require cargo
      npm run build
      node scripts/release-version.mjs --check
      node --test scripts/release-version.test.mjs
      cargo test --locked -p companion-core -p companion-capture -p aion-companion --features custom-protocol --lib --bins
      cargo test --locked -p aion-companion --features custom-protocol,development --bins
      aion_windows scripts/test-update-launcher.ps1
      aion_windows scripts/test-desktop-channels.ps1
    fi
    ;;
  install-stable)
    args=()
    while (( $# )); do
      case "$1" in
        --run) args+=(-Run); shift ;;
        --version) (( $# >= 2 )) && [[ -n $2 && $2 != --* ]] || { usage >&2; exit 2; }; args+=(-Version "$2"); shift 2 ;;
        *) usage >&2; exit 2 ;;
      esac
    done
    aion_require gh
    aion_windows scripts/install-stable.ps1 "${args[@]}"
    ;;
  package)
    args=()
    while (( $# )); do
      (( $# >= 2 )) && [[ -n $2 && $2 != --* ]] || { usage >&2; exit 2; }
      case "$1" in
        --executable) args+=(-Executable "$(aion_path "$2")") ;;
        --output-dir) args+=(-OutputDirectory "$(aion_path "$2")") ;;
        *) usage >&2; exit 2 ;;
      esac
      shift 2
    done
    aion_require node
    aion_windows scripts/package-release.ps1 "${args[@]}"
    ;;
  *) usage >&2; exit 2 ;;
esac
