#!/bin/sh
set -eu

vow_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$vow_root/.tools/foundry/starknet-foundry-v0.63.0-aarch64-apple-darwin/bin:$PATH"

accounts_file="$vow_root/.secrets/accounts.json"
account_name="${VOW_ACCOUNT:-vow-owner}"
rpc="${VOW_RPC:-https://api.cartridge.gg/x/starknet/mainnet}"
vault=0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227
token=0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

stage="${1:-}"
if [ "$stage" != "create" ] && [ "$stage" != "fund" ] && [ "$stage" != "reserve" ]; then
  echo "Usage: sh scripts/run-mandate-2.sh create|fund|reserve [TX-B|TX-C]" >&2
  echo "  create   create_mandate for mandate 2 on the live vault" >&2
  echo "  fund     approve 0.02 STRK and fund_mandate 2" >&2
  echo "  reserve  sign and submit one reservation (default TX-B)" >&2
  exit 1
fi

echo "Re-running safety verification before anything is sent..."
if [ "$stage" = "create" ]; then
  node "$vow_root/scripts/verify-mandate-2.ts"
else
  node "$vow_root/scripts/verify-mandate-2.ts" --expect-created
  mandate_owner=$(node "$vow_root/scripts/read-mandate-owner.ts" 2>/dev/null || echo 0x0)
  if [ "$mandate_owner" = "0x0" ]; then
    echo >&2
    echo "Mandate 2 does not exist on chain yet. Run 'sh scripts/run-mandate-2.sh create' first." >&2
    echo "fund_mandate would revert and waste gas. Nothing submitted." >&2
    exit 1
  fi
  echo "Mandate 2 exists on chain with owner $mandate_owner."
fi

send() {
  send_contract="$1"
  send_function="$2"
  send_calldata="$3"
  echo
  echo "About to SUBMIT a real mainnet transaction that spends STRK:"
  echo "  contract $send_contract"
  echo "  function $send_function"
  echo "  calldata $send_calldata"
  echo
  printf 'Type the function name to confirm: '
  read -r confirmation
  if [ "$confirmation" != "$send_function" ]; then
    echo "Confirmation did not match. Nothing submitted." >&2
    exit 1
  fi
  set -f
  set -- $send_calldata
  set +f
  sncast --accounts-file "$accounts_file" --account "$account_name" \
    invoke --url "$rpc" --contract-address "$send_contract" --function "$send_function" --calldata "$@"
}

if [ "$stage" = "reserve" ]; then
  label="${2:-TX-B}"
  echo "Signing the $label reservation authorization with the local operator key..."
  reserve_calldata=$(node "$vow_root/scripts/sign-reserve.ts" "$label")
  echo "Operator signature verified against the committed operator public key."
  send "$vault" reserve "$reserve_calldata"
  exit 0
fi

if [ "$stage" = "create" ]; then
  send "$vault" create_mandate \
    "0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89 0x33e41e7264b4650840f23163c6e5689d7f63a5f297e3fa42179fc097754ded4 0x59a1e65f5e6bd7d0ad2793e997799963bd6d699dfd147869bb6d0612edcb196 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d 0x6aa07689"
else
  send "$token" approve "$vault 0x470de4df820000 0x0"
  send "$vault" fund_mandate "0x2 0x470de4df820000"
fi
