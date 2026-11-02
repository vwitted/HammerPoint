// The HTTP/2 client (server/lib/http2.ts), against a local cleartext HTTP/2 server.
// Nothing here leaves the machine.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { http2Client } from "../server/lib/http2.ts";

describe("http2Client", () => {
  let server: http2.Http2Server;
  let origin = "";
  let connections = 0;
  const seen: http2.IncomingHttpHeaders[] = [];

  before(async () => {
    server = http2.createServer();
    server.on("connection", () => { connections++; });
    server.on("stream", (stream, headers) => {
      seen.push(headers);
      if (headers[":path"] === "/slow") return; // never answers
      let body = "";
      stream.setEncoding("utf8");
      stream.on("data", (c) => { body += c; });
      stream.on("end", () => {
        stream.respond({ ":status": headers[":path"] === "/blocked" ? 403 : 200, "content-type": "text/plain", "cf-mitigated": "challenge" });
        stream.end(`${headers[":method"]} ${headers[":path"]} ${body}`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("sends requests over one connection and returns fetch-style responses", async () => {
    connections = 0;
    const session = http2Client.openSession(origin, { connectTimeoutMs: 2000 });
    try {
      const [a, b, c] = await Promise.all([
        session.fetch(`${origin}/a?x=1`, { method: "POST", body: "data=1", headers: { "Content-Type": "application/x-www-form-urlencoded", Connection: "close" } }),
        session.fetch(`${origin}/b`, { method: "POST", body: "data=2" }),
        session.fetch(`${origin}/blocked`, {}),
      ]);
      assert.equal(a.status, 200);
      assert.equal(await a.text(), "POST /a?x=1 data=1");
      assert.equal(await b.text(), "POST /b data=2");
      assert.equal(c.status, 403);
      assert.equal(c.headers.get("cf-mitigated"), "challenge");
      assert.equal(connections, 1);
      // HTTP/2 forbids connection-level headers; they're dropped rather than failing the request.
      const sentA = seen.find((h) => h[":path"] === "/a?x=1")!;
      assert.equal(sentA["connection"], undefined);
      assert.equal(sentA["content-type"], "application/x-www-form-urlencoded");
    } finally {
      session.close();
    }
  });

  it("aborts a request when its signal fires", async () => {
    const session = http2Client.openSession(origin, { connectTimeoutMs: 2000 });
    try {
      await assert.rejects(session.fetch(`${origin}/slow`, { signal: AbortSignal.timeout(100) }));
    } finally {
      session.close();
    }
  });

  it("fails pending requests when the session's signal aborts", async () => {
    const controller = new AbortController();
    const session = http2Client.openSession(origin, { connectTimeoutMs: 2000, signal: controller.signal });
    const pending = session.fetch(`${origin}/slow`, {});
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending);
    session.close();
  });

  it("rejects, rather than crashing, when the server can't be reached", async () => {
    // Port 1 on localhost: nothing listens there, so the connection is refused at once.
    const session = http2Client.openSession(`http://127.0.0.1:1`, { connectTimeoutMs: 2000 });
    await assert.rejects(session.fetch(`http://127.0.0.1:1/`, {}));
    session.close();
  });

  it("refuses URLs on another origin", async () => {
    const session = http2Client.openSession(origin, { connectTimeoutMs: 2000 });
    try {
      await assert.rejects(session.fetch("https://example.com/", {}), /can't fetch/);
    } finally {
      session.close();
    }
  });
});
