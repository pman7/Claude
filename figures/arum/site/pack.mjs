// Packs the Integra Figures WordPress plugin: copies each figure's embed page into the plugin and zips it.
// node pack.mjs            builds the embed pages first, then packs
// node pack.mjs --no-build packs the embed pages as they are
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = "integra-figures";
// each figure in the plugin, and the embed page it is copied from (build it with that figure's `build.mjs --embed`)
const FIGURES = [{ id: "arum-5x200-finishing", build: "../02-trunnion/build.mjs", from: "../02-trunnion/trunnion-embed.html" }];

const php = readFileSync(join(HERE, PLUGIN, `${PLUGIN}.php`), "utf8");
const version = php.match(/^ \* Version:\s+(\S+)/m)?.[1];
if (!version || !php.includes(`const INTEGRA_FIGURES_VERSION = '${version}';`)) throw new Error("pack: the plugin header's version and INTEGRA_FIGURES_VERSION differ");
if (!readFileSync(join(HERE, PLUGIN, "readme.txt"), "utf8").includes(`Stable tag: ${version}`)) throw new Error("pack: readme.txt's stable tag is not the plugin's version");

mkdirSync(join(HERE, PLUGIN, "figures"), { recursive: true });
for (const figure of FIGURES) {
  if (!php.includes(`'${figure.id}' => array(`)) throw new Error(`pack: the plugin does not list ${figure.id}`);
  if (!process.argv.includes("--no-build")) execFileSync(process.execPath, [join(HERE, figure.build), "--embed"], { stdio: "inherit" });
  const html = readFileSync(join(HERE, figure.from), "utf8");
  // the page must stand alone on the site: no request to anywhere else
  const outside = html.match(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
  if (outside) throw new Error(`pack: ${figure.from} asks another host for something (${outside[0]})`);
  copyFileSync(join(HERE, figure.from), join(HERE, PLUGIN, "figures", `${figure.id}.html`));
}

mkdirSync(join(HERE, "dist"), { recursive: true });
const zip = join(HERE, "dist", `${PLUGIN}-${version}.zip`);
rmSync(zip, { force: true });
// -X leaves out extra file attributes, so the same files always make the same archive listing
execFileSync("zip", ["-r", "-X", "-q", zip, PLUGIN, "-x", "*.DS_Store"], { cwd: HERE, stdio: "inherit" });
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
console.log(`wrote ${zip} · ${(statSync(zip).size / 1024).toFixed(0)} KB · sha256 ${sha256}`);
