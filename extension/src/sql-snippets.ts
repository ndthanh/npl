import MarkdownIt from "markdown-it";
export function isSqlFence(info: string) {
  return /^(sql|tsql|t-sql|plsql|pgsql|postgresql|mysql|sqlite|sparksql|databricks)$/i.test(
    info.trim().split(/\s+/)[0],
  );
}
const markdown = new MarkdownIt({ html: false });
export function sqlSnippets(text: string) {
  return markdown
    .parse(text, {})
    .filter((token) => token.type === "fence" && isSqlFence(token.info))
    .map((token) => token.content);
}
