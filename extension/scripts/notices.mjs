import fs from "node:fs/promises";
import path from "node:path";
const names = [
  "diff",
  "@ag-ui/core",
  "@vscode/codicons",
  "zod",
  "ignore",
  "markdown-it",
  "highlight.js",
  "argparse",
  "entities",
  "linkify-it",
  "mdurl",
  "punycode.js",
  "uc.micro",
];
const directory = "dist/licenses";
const queue = ["codemirror", "@codemirror/lang-sql", "qrcode", "yazl"];
while (queue.length) {
  const name = queue.shift();
  if (names.includes(name)) continue;
  names.push(name);
  const metadata = JSON.parse(
    await fs.readFile(path.join("node_modules", name, "package.json"), "utf8"),
  );
  queue.push(...Object.keys(metadata.dependencies ?? {}));
}
await fs.mkdir(directory, { recursive: true });
const notices = [
  "Third-party components distributed with Nopilot.",
  "Codicons by Microsoft: https://github.com/microsoft/vscode-codicons",
  "Codicons icon artwork is used unmodified under CC BY 4.0; code is MIT. See the included Codicons licenses.",
  "",
];
for (const name of names) {
  const base = path.join("node_modules", name);
  const metadata = JSON.parse(
    await fs.readFile(path.join(base, "package.json"), "utf8"),
  );
  notices.push(
    `${name} ${metadata.version} — ${metadata.license ?? "see license files"}`,
  );
  for (const entry of await fs.readdir(base)) {
    if (
      !/^(licen[sc]e|copying|copyright|notice)/i.test(entry) ||
      (await fs.stat(path.join(base, entry))).isDirectory()
    )
      continue;
    const target = name.replace(/[@/]/g, "_") + "-" + entry + ".txt";
    await fs.copyFile(path.join(base, entry), path.join(directory, target));
  }
}
try {
  await fs.copyFile(
    "third-party/ag-ui-LICENSE.txt",
    path.join(directory, "ag-ui-LICENSE.txt"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await fs.writeFile("dist/THIRD_PARTY_NOTICES.txt", notices.join("\n") + "\n");
