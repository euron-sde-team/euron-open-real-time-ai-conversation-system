/**
 * Copies the MediaPipe vision WebAssembly runtime from node_modules into
 * public/mediapipe/wasm, so face proctoring loads it from this origin instead of a CDN.
 * Runs before `next dev` and `next build`. The face detector model
 * (public/mediapipe/blaze_face_short_range.tflite, Apache-2.0) is committed.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The package exports no package.json; find its folder from the main entry.
const pkg = path.dirname(require.resolve("@mediapipe/tasks-vision"));
const from = path.join(pkg, "wasm");
const to = path.join(here, "..", "public", "mediapipe", "wasm");
mkdirSync(to, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  const src = path.join(from, f);
  const dst = path.join(to, f);
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue;
  copyFileSync(src, dst);
}
