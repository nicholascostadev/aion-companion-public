#!/usr/bin/env bash
# Shared by dev.sh and shells that need the checkout's tools.
AION_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)

aion_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -am -- "$1"
  elif [[ $1 == /* ]]; then
    printf '%s\n' "$1"
  else
    printf '%s/%s\n' "$PWD" "$1"
  fi
}

aion_require() {
  command -v "$1" >/dev/null 2>&1 || { printf 'Missing %s. Run bash dev.sh doctor.\n' "$1" >&2; return 1; }
}

# Linked worktrees share ignored tools with the main checkout, not dependencies
# or build outputs. Derive that location from Git instead of a user-specific path.
aion_common=$(git -C "$AION_ROOT" rev-parse --path-format=absolute --git-common-dir)
if command -v cygpath >/dev/null 2>&1; then aion_common=$(cygpath -u "$aion_common"); fi
aion_main=$(dirname -- "$aion_common")
for aion_tools in "$AION_ROOT/.tools" "$aion_main/.tools"; do
  if ! command -v node >/dev/null 2>&1; then
    for aion_node in "$aion_tools"/node/*/node.exe; do
      if [[ -f "$aion_node" ]]; then export PATH="$(dirname -- "$aion_node"):$PATH"; break; fi
    done
  fi
  if ! command -v cargo >/dev/null 2>&1 && [[ -f "$aion_tools/rust/cargo/bin/cargo.exe" ]]; then
    export CARGO_HOME="$(aion_path "$aion_tools/rust/cargo")"
    export RUSTUP_HOME="$(aion_path "$aion_tools/rust/rustup")"
    export PATH="$aion_tools/rust/cargo/bin:$PATH"
  fi
done
if ! command -v cargo >/dev/null 2>&1 && [[ -d "$HOME/.cargo/bin" ]]; then export PATH="$HOME/.cargo/bin:$PATH"; fi
unset aion_common aion_main aion_tools aion_node

# Keep .NET/COM, the Dev-host mutex and Windows shortcut handling in the existing
# adapters. -File passes arguments as data rather than interpolated PowerShell.
aion_windows() {
  aion_require powershell.exe || return
  local script=$1
  shift
  MSYS2_ARG_CONV_EXCL='*' powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$(aion_path "$AION_ROOT/$script")" "$@"
}
