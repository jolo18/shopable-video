// Speed budget (plan, feature 73): the loader stays under 10 KB compressed.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgets = [
  ["extensions/sv-theme/assets/sv-loader.js", 10 * 1024],
  ["extensions/sv-theme/assets/sv-player.js", 40 * 1024],
];
let failed = false;
for (const [file, max] of budgets) {
  if (!existsSync(file)) {
    console.log(`skip ${file}`);
    continue;
  }
  const size = gzipSync(readFileSync(file)).length;
  const ok = size <= max;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${size} B gzip (budget ${max})`);
}
process.exit(failed ? 1 : 0);
