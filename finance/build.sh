#!/usr/bin/env bash
set -euo pipefail
module=$(cd -- "$(dirname -- "$0")" && pwd)
gcc=$(realpath -- "${1:?GPU Control Center directory required}")
output=$(realpath -m -- "${2:?Output directory required}")
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
cp "$module"/{index.html,main.tsx,page.css,run-rate.tsx,purchase.tsx,monthly.tsx,capital-evolution.tsx} "$build/"
mkdir "$build/web"
cp "$gcc"/web/{Finance.tsx,api.ts,style.css,finance.css} "$build/web/"
python3 "$module/attach-capital-history.py" "$build/web/Finance.tsx"
ln -s "$gcc/node_modules" "$build/node_modules"
printf '%s\n' 'export default { esbuild: { jsx: "automatic" } };' > "$build/vite.config.mjs"
mkdir "$build/public"
cp "$module/../public/navigation.css" "$build/public/"
cd "$build"
"${PEARL_NODE:-node}" "$gcc/node_modules/vite/bin/vite.js" build --base /finance/ --outDir "$output"
