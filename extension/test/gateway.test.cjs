const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { startGateway } = require("../dist/gateway.js");
let server,
  endpoint,
  directory,
  sends = 0,
  proposals = 0;
const clients = new Set();
const headers = {
  Authorization: "Bearer test-token",
  "Content-Type": "application/json",
};
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-gateway-"));
  server = await startGateway({
    token: "test-token",
    port: 0,
    receiptFile: path.join(directory, "requests.json"),
    snapshot: () => ({ conversation: { id: "test" }, busy: false }),
    clients,
    propose: async (body) => {
      assert.equal(body.conversationId, "test");
      proposals++;
    },
    send: async () => {
      sends++;
    },
  });
  endpoint = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  for (const c of clients) c.end();
  await new Promise((resolve) => server.close(resolve));
});
test("gateway binds only loopback and rejects missing tokens/browser origins", async () => {
  assert.equal(server.address().address, "127.0.0.1");
  assert.equal((await fetch(endpoint + "/v1/state")).status, 401);
  assert.equal(
    (
      await fetch(endpoint + "/v1/state", {
        headers: { ...headers, Origin: "https://example.com" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(endpoint + "/v1/state", { headers })).status, 200);
});
test("same request ID cannot send a prompt twice or be reused for other text", async () => {
  const body = {
    requestId: "request-1",
    conversationId: "test",
    text: "hello",
  };
  let r = await fetch(endpoint + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 202);
  await r.json();
  r = await fetch(endpoint + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  for (let i = 0; i < 50; i++) {
    const receipt = await (
      await fetch(endpoint + "/v1/requests/request-1", { headers })
    ).json();
    if (receipt.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(sends, 1);
  r = await fetch(endpoint + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, text: "different" }),
  });
  assert.equal(r.status, 409);
  assert.equal(sends, 1);
});
test("gateway stages proposals and has no approve or execute endpoint", async () => {
  assert.equal(
    (
      await fetch(endpoint + "/v1/propose", {
        method: "POST",
        headers,
        body: JSON.stringify({
          conversationId: "test",
          proposal: { type: "run_plan" },
        }),
      })
    ).status,
    200,
  );
  assert.equal(proposals, 1);
  for (const route of ["/v1/approve", "/v1/exec", "/v1/evaluate"])
    assert.equal(
      (await fetch(endpoint + route, { method: "POST", headers, body: "{}" }))
        .status,
      404,
    );
});
test("SSE stays subscribed after the GET request and receives live events", async () => {
  const abort = new AbortController();
  const response = await fetch(endpoint + "/v1/events", {
    headers,
    signal: abort.signal,
  });
  const reader = response.body.getReader();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /STATE_SNAPSHOT/,
  );
  assert.equal(clients.size, 1);
  for (const client of clients)
    client.write('data: {"event":{"type":"CUSTOM","name":"proof"}}\n\n');
  assert.match(new TextDecoder().decode((await reader.read()).value), /proof/);
  abort.abort();
});
test("gateway reload marks in-flight receipts unconfirmed rather than resending", async () => {
  const file = path.join(directory, "restart.json");
  await fs.writeFile(
    file,
    JSON.stringify({
      old: { requestId: "old", inputHash: "old-hash", status: "running" },
    }),
  );
  const s = await startGateway({
    token: "token",
    port: 0,
    receiptFile: file,
    snapshot: () => ({}),
    clients: new Set(),
    send: async () => {
      throw Error("must not execute");
    },
    propose: async () => {},
  });
  try {
    const result = await (
      await fetch("http://127.0.0.1:" + s.address().port + "/v1/requests/old", {
        headers: { Authorization: "Bearer token" },
      })
    ).json();
    assert.equal(result.status, "unconfirmed");
  } finally {
    await new Promise((resolve) => s.close(resolve));
  }
});
