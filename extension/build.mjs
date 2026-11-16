import { build } from "esbuild";
import fs from "node:fs/promises";
await build({
  entryPoints: ["src/local-model-panel.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/local-model-panel-test.js",
});
for (const name of ["local-model", "local-tools", "goal"])
  await build({
    entryPoints: ["src/" + name + ".ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/" + name + "-test.js",
  });
await build({
  entryPoints: ["src/local-model-ui.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/local-model-ui.js",
});
await build({
  entryPoints: ["src/migration-ui.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/migration-ui.js",
});
await build({
  entryPoints: ["src/migration.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/migration-test.js",
});
for (const name of ["decimen", "workspace-zip"])
  await build({
    entryPoints: ["src/" + name + ".ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/" + name + "-test.js",
  });
await build({
  entryPoints: ["src/development.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/development-test.js",
});
await build({
  entryPoints: ["src/project-context.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/project-context.js",
});
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
  entryPoints: ["src/data-ui.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/data-ui.js",
});
await build({
  entryPoints: ["src/onboarding.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/onboarding.js",
});
await build({
  entryPoints: ["src/changes.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/changes.js",
});
await build({
  entryPoints: ["src/database.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/database-test.js",
});
await build({
  entryPoints: ["src/sidecar.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/sidecar-test.js",
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
