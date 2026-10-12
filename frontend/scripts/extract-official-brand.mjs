/** Extract original pixels only. No tracing, recoloring, resizing or generation. */
import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const source = "public/brand/official-guidelines.png";
const regions = {
  "micro.png": { left: 1071, top: 428, width: 66, height: 64 },
  "wordmark.png": { left: 480, top: 116, width: 636, height: 124 },
  "favicon.png": { left: 1357, top: 437, width: 49, height: 50 },
};
for (const [name, region] of Object.entries(regions)) {
  await sharp(source)
    .extract(region)
    .png()
    .toFile("public/brand/" + name);
}
await writeFile(
  "public/brand/provenance.json",
  JSON.stringify(
    {
      source: "REPBrasil_Brand_Kit_Official/assets/brand-guidelines.png",
      sha256: createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
      operation: "Pixel extraction only; no resampling, recoloring or redraw.",
      regions,
    },
    null,
    2,
  ),
);
