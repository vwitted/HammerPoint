import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import {
  assertPublicHttpUrl,
  fetchPublicUrl,
  isPublicAddress,
  readBodyWithLimit,
  UnsafeUrlError,
} from "../server/safeFetch.ts";

describe("isPublicAddress", () => {
  it("rejects loopback, private, link-local and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it("rejects loopback, unique-local, link-local and IPv4-mapped private IPv6", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it("accepts public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });

  it("rejects things that are not IP addresses", () => {
    assert.equal(isPublicAddress("localhost"), false);
    assert.equal(isPublicAddress(""), false);
  });
});

describe("assertPublicHttpUrl", () => {
  const rejects = (url: string) => assert.rejects(assertPublicHttpUrl(url), UnsafeUrlError, url);

  it("rejects non-http schemes and malformed URLs", async () => {
    await rejects("file:///etc/passwd");
    await rejects("ftp://example.com/x.jpg");
    await rejects("not a url");
  });

  it("rejects internal hosts in their various spellings", async () => {
    await rejects("http://127.0.0.1/");
    await rejects("http://localhost:3000/api/auctions");
    await rejects("http://169.254.169.254/latest/meta-data/");
    await rejects("http://[::1]/");
    await rejects("http://[::ffff:127.0.0.1]/");
    await rejects("http://2130706433/"); // decimal form of 127.0.0.1
    await rejects("http://0x7f.0.0.1/");
  });

  it("rejects URLs with embedded credentials", async () => {
    await rejects("http://user:pass@8.8.8.8/");
  });

  it("accepts a public IP literal without a DNS lookup", async () => {
    const url = await assertPublicHttpUrl("https://8.8.8.8/image.jpg");
    assert.equal(url.hostname, "8.8.8.8");
  });
});

describe("fetchPublicUrl", () => {
  const listen = async (handler: http.RequestListener) => {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };

  it("rejects an internal starting URL", async () => {
    const { server, origin } = await listen((_req, res) => res.end("secret"));
    try {
      await assert.rejects(fetchPublicUrl(`${origin}/`), UnsafeUrlError);
    } finally {
      server.close();
    }
  });

  it("re-checks each redirect target instead of letting fetch follow it", async () => {
    // "internal" stands in for a private service; "entry" is treated as public by the test
    // validator and redirects to it. The redirect must be refused before "internal" is contacted.
    let internalHits = 0;
    const internal = await listen((_req, res) => {
      internalHits++;
      res.end("secret");
    });
    const entry = await listen((_req, res) => {
      res.writeHead(302, { Location: `${internal.origin}/metadata` });
      res.end();
    });
    const validate = async (raw: string) => {
      if (raw.startsWith(entry.origin)) return new URL(raw);
      return assertPublicHttpUrl(raw);
    };

    try {
      await assert.rejects(fetchPublicUrl(`${entry.origin}/image.jpg`, {}, validate), UnsafeUrlError);
      assert.equal(internalHits, 0);
    } finally {
      entry.server.close();
      internal.server.close();
    }
  });

  it("follows redirects that pass validation", async () => {
    const target = await listen((_req, res) => res.end("image-bytes"));
    const entry = await listen((_req, res) => {
      res.writeHead(302, { Location: `${target.origin}/final.jpg` });
      res.end();
    });
    const allowLocal = async (raw: string) => new URL(raw);

    try {
      const res = await fetchPublicUrl(`${entry.origin}/start.jpg`, {}, allowLocal);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "image-bytes");
    } finally {
      entry.server.close();
      target.server.close();
    }
  });
});

describe("readBodyWithLimit", () => {
  it("returns the body when under the limit", async () => {
    const body = await readBodyWithLimit(new Response("hello"), 10);
    assert.equal(body.toString(), "hello");
  });

  it("rejects a body over the limit even without a content-length header", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    await assert.rejects(readBodyWithLimit(new Response(stream), 10), UnsafeUrlError);
  });

  it("rejects early when content-length already exceeds the limit", async () => {
    const res = new Response("x", { headers: { "content-length": "999" } });
    await assert.rejects(readBodyWithLimit(res, 10), UnsafeUrlError);
  });
});
