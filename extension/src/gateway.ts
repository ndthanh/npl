import http from "node:http";
import fs from "node:fs/promises";
import { timingSafeEqual, createHash } from "node:crypto";
type Options = {
  token: string;
  port: number;
  receiptFile: string;
  snapshot: () => any;
  propose: (body: any) => Promise<void>;
  send: (body: any) => Promise<void>;
  clients: Set<http.ServerResponse>;
};
export async function startGateway(options: Options) {
  let receipts: Record<string, any> = {};
  try {
    receipts = JSON.parse(await fs.readFile(options.receiptFile, "utf8"));
    for (const r of Object.values(receipts))
      if (r.status === "accepted" || r.status === "running")
        r.status = "unconfirmed";
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  let saving = Promise.resolve();
  const persist = () => {
    const data = JSON.stringify(receipts);
    saving = saving.then(async () => {
      await fs.writeFile(options.receiptFile + ".tmp", data);
      await fs.rename(options.receiptFile + ".tmp", options.receiptFile);
    });
    return saving;
  };
  const server = http.createServer(async (req, res) => {
    const a = Buffer.from(req.headers.authorization ?? ""),
      b = Buffer.from("Bearer " + options.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.writeHead(401);
      res.end();
      return;
    }
    const reply = (status: number, value: any) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.origin) {
        reply(403, { error: "Browser-origin requests are not supported" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(
          "data: " +
            JSON.stringify({
              event: { type: "STATE_SNAPSHOT", snapshot: options.snapshot() },
            }) +
            "\n\n",
        );
        options.clients.add(res);
        const timer = setInterval(() => res.write(": keepalive\n\n"), 15000);
        timer.unref();
        res.on("close", () => {
          clearInterval(timer);
          options.clients.delete(res);
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/state") {
        reply(200, options.snapshot());
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/capabilities") {
        reply(200, {
          version: 1,
          actions: ["messages", "propose"],
          approvals: "VS Code UI only",
          tools: [
            "web.read",
            "browser.open",
            "browser.snapshot",
            "browser.click",
            "browser.fill",
            "browser.screenshot",
          ],
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/v1/requests/")) {
        const r = receipts[url.pathname.slice("/v1/requests/".length)];
        reply(r ? 200 : 404, r ?? {});
        return;
      }
      if (
        req.method === "POST" &&
        ["/v1/messages", "/v1/propose"].includes(url.pathname)
      ) {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 1024 * 1024)
            throw Error("Body too large");
        }
        const body = JSON.parse(text);
        if (url.pathname === "/v1/propose") {
          await options.propose(body);
          reply(200, { accepted: true, requiresApproval: true });
          return;
        }
        if (
          !/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId ?? "") ||
          typeof body.text !== "string" ||
          !body.text.trim() ||
          body.text.length > 100000 ||
          body.text.trim().startsWith("/") ||
          typeof body.conversationId !== "string"
        )
          throw Error("Use requestId, conversationId and ordinary prompt text");
        const inputHash = createHash("sha256")
          .update(JSON.stringify([body.conversationId, body.text]))
          .digest("hex");
        const prior = receipts[body.requestId];
        if (prior) {
          reply(
            prior.inputHash === inputHash ? 200 : 409,
            prior.inputHash === inputHash
              ? prior
              : { error: "requestId was used for another input" },
          );
          return;
        }
        if (Object.keys(receipts).length >= 1000)
          throw Error("Gateway receipt limit reached; no request was sent");
        const receipt: any = (receipts[body.requestId] = {
          requestId: body.requestId,
          conversationId: body.conversationId,
          inputHash,
          status: "accepted",
          createdAt: new Date().toISOString(),
        });
        await persist();
        reply(202, receipt);
        void (async () => {
          try {
            receipt.status = "running";
            await persist();
            await options.send(body);
            receipt.status = "completed";
          } catch (e) {
            receipt.status = "failed";
            receipt.error = String(e);
          } finally {
            await persist();
          }
        })();
        return;
      }
      reply(404, {});
    } catch (e) {
      if (!res.headersSent) reply(400, { error: String(e) });
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  return server;
}
