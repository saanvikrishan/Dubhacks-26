import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildUwSnapshot } from "../src/adapters/uwCatalog.js";
export { buildUwSnapshot } from "../src/adapters/uwCatalog.js";
const dir = new URL("../src/data/uw/", import.meta.url);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = JSON.parse(await readFile(new URL("snapshot.json", dir), "utf8"));
  const reviewed = JSON.parse(await readFile(new URL("reviewed.json", dir), "utf8"));
  // Validate source bytes; edited or corrupted cached files cannot retain verification.
  for (const source of snapshot.sources) {
    const hash = createHash("sha256").update(await readFile(new URL(source.file, dir))).digest("hex");
    if (hash !== source.responseSha256) throw new Error(`Source checksum mismatch: ${source.sourceUrl}`);
  }
  const result = buildUwSnapshot(snapshot, reviewed);
  await writeFile(new URL("catalog.json", dir), JSON.stringify(result, null, 2)+"\n");
  const browser = {snapshot: {...snapshot,
    sources: snapshot.sources.map(({sourceUrl,responseSha256}) => ({sourceUrl,responseSha256})),
    menus: snapshot.menus.map(m => Object.fromEntries(Object.entries(m).filter(([key]) => !["words","pages"].includes(key)))),
    venues: snapshot.venues.map(v => Object.fromEntries(Object.entries(v).filter(([key]) => key!=="rawText")))}, reviewed};
  await writeFile(new URL("browser.json", dir), JSON.stringify(browser)+"\n");
  console.log(JSON.stringify(result.report, null, 2));
}
