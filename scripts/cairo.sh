#!/bin/sh
set -eu
vow_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$vow_root/.tools/scarb/scarb-v2.17.0-aarch64-apple-darwin/bin:$vow_root/.tools/foundry/starknet-foundry-v0.63.0-aarch64-apple-darwin/bin:$vow_root/.tools/usc/universal-sierra-compiler-v2.10.0-aarch64-apple-darwin/bin:$PATH"
export SCARB_CACHE="$vow_root/.cache/scarb"
cd "$vow_root/contracts"
exec scarb "$@"
