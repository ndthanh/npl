import { build } from "esbuild";
import fs from "node:fs/promises";
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: true,
});
await build({
  entryPoints: ["src/chat-ui.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/webview.js",
});
await build({
  entryPoints: ["src/core.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/core.js",
});
await build({
  entryPoints: ["src/events.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/events.js",
});
await build({
  entryPoints: ["src/gateway.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/gateway.js",
});
await build({
  entryPoints: ["src/autocomplete.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/autocomplete.js",
});
for (const name of ["codicon.css", "codicon.ttf"]) {
  await fs.copyFile(
    "node_modules/@vscode/codicons/dist/" + name,
    "dist/" + name,
  );
}
await build({
  entryPoints: ["src/queue.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/queue.js",
});
await import("./scripts/notices.mjs");
await build({
  entryPoints: ["src/archive.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/archive.js",
});
await build({
  entryPoints: ["src/voice.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/voice.js",
});
