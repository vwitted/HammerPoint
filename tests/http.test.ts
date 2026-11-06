// The provider HTTP transport: sidecar mode (curl_cffi) and the Node fetch fallback.
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { httpFetch } from "../server/lib/http.ts";

const realFetch = globalThis.fetch;
const realSidecarUrl = process.env.SIDECAR_URL;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realSidecarUrl === undefined) delete process.env.SIDECAR_URL;
  else process.env.SIDECAR_URL = realSidecarUrl;
});

describe("httpFetch", () => {
  it("uses the sidecar and strips headers curl_cffi already owns", async () => {
    process.env.SIDECAR_URL = "http://sidecar.test";
    let request: any = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), "http://sidecar.test/fetch");
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "br", "content-length": "11" },
        body: '{"ok":true}',
        final_url: "https://example.com/data",
        error: null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const res = await httpFetch("https://example.com/data", {
      headers: {
        "User-Agent": "a browser UA",
        "Accept-Encoding": "gzip, br",
        "sec-ch-ua": '"Chromium";v="150"',
        "Connection": "close",
        "Accept": "application/json",
        "X-Api-Key": "secret",
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), null, "decoded body has no upstream encoding");
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(request.url, "https://example.com/data");
    assert.equal(request.method, "GET");
    assert.deepEqual(request.headers, { "Accept": "application/json", "X-Api-Key": "secret" });
  });

  it("returns a real Response so noteResponse() and json() work unchanged", async () => {
    process.env.SIDECAR_URL = "http://sidecar.test";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: 403,
      headers: { "cf-mitigated": "challenge" },
      body: "Just a moment...",
      final_url: "https://example.com/",
      error: null,
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    const res = await httpFetch("https://example.com/");
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cf-mitigated"), "challenge");
    assert.equal(await res.text(), "Just a moment...");
  });

  it("falls back to Node fetch when no sidecar is configured", async () => {
    delete process.env.SIDECAR_URL;
    let sentHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      sentHeaders = init?.headers as Record<string, string>;
      return new Response("from node", { status: 200 });
    }) as typeof fetch;

    const res = await httpFetch("https://example.com/");
    assert.equal(await res.text(), "from node");
    assert.match(sentHeaders["User-Agent"], /Chrome/);
  });

  it("surfaces a sidecar error instead of returning an empty 200", async () => {
    process.env.SIDECAR_URL = "http://sidecar.test";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: 0, headers: {}, body: "", final_url: "https://example.com/", error: "connection reset",
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    await assert.rejects(httpFetch("https://example.com/"), /connection reset/);
  });
});
