// Minimal HTTP/2 client for sites that refuse HTTP/1.1 requests.
//
// Node's built-in fetch only speaks HTTP/1.1. Some sites behind Cloudflare (e.g. Easy Live's
// bid endpoint) answer HTTP/1.1 with a 403 "Just a moment..." page but serve HTTP/2, which every
// browser uses, normally. A session holds one connection and multiplexes requests over it, so a
// batch of lookups costs one TLS handshake.
import http2 from "node:http2";

export interface Http2Session {
  // Same shape as fetch, for requests to the session's origin.
  fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Response>;
  close(): void;
}

export interface Http2SessionOptions {
  // How long to wait for the connection before failing every request.
  connectTimeoutMs: number;
  // Closes the connection and fails pending requests when aborted.
  signal?: AbortSignal;
}

function openSession(origin: string, options: Http2SessionOptions): Http2Session {
  const client = http2.connect(origin);
  // Without a listener, a connection error would crash the process.
  let connectError: Error | null = null;
  client.on("error", (err) => { connectError = err; });

  const connectTimer = setTimeout(() => {
    if (!client.connecting) return;
    connectError = new Error(`HTTP/2 connection to ${origin} timed out`);
    client.destroy(connectError);
  }, options.connectTimeoutMs);
  client.once("connect", () => clearTimeout(connectTimer));
  client.once("close", () => clearTimeout(connectTimer));

  const onAbort = () => client.destroy();
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    fetch(url, init) {
      return new Promise<Response>((resolve, reject) => {
        const target = new URL(url);
        if (target.origin !== new URL(origin).origin) {
          reject(new Error(`HTTP/2 session for ${origin} can't fetch ${target.origin}`));
          return;
        }
        if (init.signal?.aborted || client.destroyed || client.closed) {
          reject(connectError || new DOMException("This operation was aborted", "AbortError"));
          return;
        }

        const headers: http2.OutgoingHttpHeaders = {
          ":method": init.method || "GET",
          ":path": target.pathname + target.search,
        };
        for (const [name, value] of Object.entries(init.headers || {})) {
          const lower = name.toLowerCase();
          // Connection-level headers are not allowed in HTTP/2, and bodies are returned as sent,
          // so don't ask for compression this client won't undo.
          if (["connection", "keep-alive", "transfer-encoding", "accept-encoding"].includes(lower)) continue;
          headers[lower] = value;
        }

        const stream = client.request(headers, { signal: init.signal });
        let status = 0;
        const responseHeaders = new Headers();
        const chunks: Buffer[] = [];
        stream.on("response", (h) => {
          status = Number(h[":status"]);
          for (const [name, value] of Object.entries(h)) {
            if (name.startsWith(":") || value == null) continue;
            responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : String(value));
          }
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          // A stream cut off by the connection closing ends without ever getting a response.
          if (!status) {
            reject(connectError || new Error("HTTP/2 stream closed without a response"));
            return;
          }
          resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers: responseHeaders }));
        });
        stream.on("error", (err) => reject(connectError || err));
        // Covers a stream closed with no "end" or "error" (e.g. the session was destroyed).
        stream.on("close", () => reject(connectError || new Error("HTTP/2 stream closed without a response")));
        stream.end(init.body);
      });
    },
    close() {
      clearTimeout(connectTimer);
      options.signal?.removeEventListener("abort", onAbort);
      client.close();
    },
  };
}

// Indirection so tests can replay recorded responses instead of reaching the network.
export const http2Client = { openSession };
