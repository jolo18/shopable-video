// Bundles the storefront TypeScript into theme app extension assets.
import { build } from "esbuild";
import { existsSync } from "node:fs";

const entries = [
  { in: "extensions/sv-theme/src/loader.ts", out: "extensions/sv-theme/assets/sv-loader.js" },
  { in: "extensions/sv-theme/src/player.ts", out: "extensions/sv-theme/assets/sv-player.js" },
  { in: "extensions/sv-theme/src/embed.ts", out: "extensions/sv-embed-snippet.js", optional: true },
];

for (const e of entries) {
  if (!existsSync(e.in)) {
    if (!e.optional) console.log(`skip ${e.in} (not present)`);
    continue;
  }
  await build({
    entryPoints: [e.in],
    outfile: e.out,
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020", "safari14"],
    legalComments: "none",
  });
  console.log(`built ${e.out}`);
}
