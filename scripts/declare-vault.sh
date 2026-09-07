#!/bin/sh
set -eu

vow_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$vow_root/.tools/scarb/scarb-v2.17.0-aarch64-apple-darwin/bin:$vow_root/.tools/foundry/starknet-foundry-v0.63.0-aarch64-apple-darwin/bin:$vow_root/.tools/usc/universal-sierra-compiler-v2.10.0-aarch64-apple-darwin/bin:$PATH"
export SCARB_CACHE="$vow_root/.cache/scarb"

expected_class_hash=0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14
accounts_file="$vow_root/.secrets/accounts.json"
account_name="${VOW_ACCOUNT:-vow-owner}"
rpc="${VOW_RPC:-https://api.cartridge.gg/x/starknet/mainnet}"

if [ ! -f "$accounts_file" ]; then
  echo "No accounts file at $accounts_file" >&2
  echo "Import your owner account first. It prompts for the key; nothing is written to shell history:" >&2
  echo "  sncast --accounts-file $accounts_file account import \\" >&2
  echo "    --name $account_name --address 0x5282ba58af3296b7c6bdb51dfb12789cbf4603799e7fc8baef6a9704de1679e \\" >&2
  echo "    --type argent --url $rpc" >&2
  exit 1
fi

built=$(node "$vow_root/scripts/print-vault-class-hash.ts")
if [ "$built" != "$expected_class_hash" ]; then
  echo "Local build hashes to $built but this script expects $expected_class_hash." >&2
  echo "The contract changed. Re-run the fee estimate and update the expected hash before declaring." >&2
  exit 1
fi

echo "VowVault class hash: $built"
echo "Account: $account_name   RPC: $rpc"

if [ "${1:-}" = "--dry-run" ]; then
  exec sncast --accounts-file "$accounts_file" --account "$account_name" \
    declare --contract-name VowVault --url "$rpc" --dry-run --detailed
fi

echo "This SUBMITS a real mainnet declaration and spends STRK. Ctrl-C now to abort."
echo "Type the class hash to continue:"
read -r confirmation
if [ "$confirmation" != "$expected_class_hash" ]; then
  echo "Confirmation did not match. Nothing submitted." >&2
  exit 1
fi

exec sncast --accounts-file "$accounts_file" --account "$account_name" \
  declare --contract-name VowVault --url "$rpc"
