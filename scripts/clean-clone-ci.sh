#!/bin/sh
set -eu
vow_ci_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
vow_ci_tmp=$(mktemp -d "${TMPDIR:-/tmp}/vow-clean-clone.XXXXXX")
vow_ci_clone="$vow_ci_tmp/repository"
cleanup() {
  rm -rf -- "$vow_ci_tmp"
}
trap cleanup EXIT HUP INT TERM
git clone --quiet --local --no-hardlinks "$vow_ci_root" "$vow_ci_clone"
cd "$vow_ci_clone"
test -z "$(git status --porcelain)"
npm ci --ignore-scripts
if [ -n "${VOW_CAIRO_ARCHIVE_CACHE:-}" ]; then
  mkdir -p .tools
  for vow_ci_archive in scarb foundry usc; do
    cp "$VOW_CAIRO_ARCHIVE_CACHE/$vow_ci_archive.tar.gz" ".tools/$vow_ci_archive.tar.gz"
  done
fi
python3 scripts/install-cairo.py
npm run build:workbench
sh scripts/cairo.sh test
npm test
npm run evidence:verify
printf 'T-020 clean-clone release gate passed for %s.\n' "$(git rev-parse HEAD)"
