import { describe, it, expect, afterEach, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpServer, startHttpServer, type HttpServerOptions } from "./http.js";
import type { McpEndpoint } from "./mcp-endpoint.js";

const stubEndpoint: McpEndpoint = {
  fetch: async () => new Response(null, { status: 202 }),
  close: async () => {},
};

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const name of ["GT_AUTH_TOKEN", "GT_HTTP_HOST", "GT_HTTP_ALLOWED_HOSTS", "GT_CACHE_DIR"]) delete process.env[name];
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function listen(options?: HttpServerOptions, create = createHttpServer): Promise<number> {
  const server = create(stubEndpoint, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
}

/** node:http lets a test send any Host header; fetch always derives it from the URL. */
function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("DNS-rebinding protection", () => {
  it("rejects a foreign Host header with 403 by default", async () => {
    const port = await listen();
    expect((await get(port, "/health", { host: `rebind.attacker.example:${port}` })).status).toBe(403);
  });

  it("accepts loopback Host headers on any port", async () => {
    const port = await listen();
    expect((await get(port, "/health", { host: `localhost:${port}` })).status).toBe(200);
    expect((await get(port, "/health", { host: `127.0.0.1:${port}` })).status).toBe(200);
  });

  it("rejects a foreign Origin and accepts a loopback one", async () => {
    const port = await listen();
    expect((await get(port, "/health", { origin: "http://rebind.attacker.example" })).status).toBe(403);
    expect((await get(port, "/health", { origin: "null" })).status).toBe(403);
    expect((await get(port, "/health", { origin: "http://localhost:5173" })).status).toBe(200);
  });

  it("accepts configured hostnames for Host and Origin, plus loopback", async () => {
    const port = await listen({ allowedHosts: ["mcp.example.com"] });
    expect((await get(port, "/health", { host: "mcp.example.com" })).status).toBe(200);
    expect((await get(port, "/health", { origin: "https://mcp.example.com" })).status).toBe(200);
    expect((await get(port, "/health", { host: "127.0.0.1" })).status).toBe(200);
    expect((await get(port, "/health", { host: "evil.example" })).status).toBe(403);
  });

  it("skips the Host check when disabled but still rejects foreign browser origins", async () => {
    const port = await listen({ allowedHosts: null });
    expect((await get(port, "/health", { host: "10.0.0.5:3100" })).status).toBe(200);
    expect((await get(port, "/health", { origin: "http://evil.example" })).status).toBe(403);
  });
});

describe("bearer auth", () => {
  it("answers 401 with a WWW-Authenticate challenge", async () => {
    process.env.GT_AUTH_TOKEN = "s3cret-token";
    const port = await listen();
    const res = await get(port, "/health", { authorization: "Bearer nope" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect((await get(port, "/health", { authorization: "Bearer s3cret-token" })).status).toBe(200);
  });
});

describe("/health disk check", () => {
  it("reports the disk cache as unavailable and status degraded when the cache dir cannot be created", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "gt-health-")), "not-a-dir");
    writeFileSync(file, "x");
    process.env.GT_CACHE_DIR = join(file, "cache");
    vi.resetModules();
    const fresh = await import("./http.js");
    const port = await listen(undefined, fresh.createHttpServer);
    const body = JSON.parse((await get(port, "/health")).body) as { status: string; cache: { diskInitialized: boolean } };
    expect(body.cache.diskInitialized).toBe(false);
    expect(body.status).toBe("degraded");
  });

  it("reports a writable disk cache as initialized", async () => {
    process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-health-ok-"));
    vi.resetModules();
    const fresh = await import("./http.js");
    const port = await listen(undefined, fresh.createHttpServer);
    const body = JSON.parse((await get(port, "/health")).body) as { status: string; cache: { diskInitialized: boolean } };
    expect(body.cache.diskInitialized).toBe(true);
    expect(body.status).toBe("ok");
  });
});

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("startHttpServer bind address", () => {
  it("binds 127.0.0.1 by default", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const port = await freePort();
    const handle = startHttpServer(String(port));
    closers.push(() => handle.close());
    await vi.waitFor(() => expect(spy.mock.calls.flat().join("\n")).toContain(`127.0.0.1:${port}`));
    expect((await get(port, "/health")).status).toBe(200);
  });

  it("refuses to start on a non-loopback address without GT_AUTH_TOKEN", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    process.env.GT_HTTP_HOST = "0.0.0.0";
    const port = await freePort();
    expect(() => startHttpServer(String(port))).toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(spy.mock.calls.flat().join("\n")).toMatch(/\[error\].*0\.0\.0\.0.*GT_AUTH_TOKEN/);
    await expect(get(port, "/health")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("starts on a non-loopback address when GT_AUTH_TOKEN is set", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.GT_HTTP_HOST = "0.0.0.0";
    process.env.GT_AUTH_TOKEN = "s3cret-token";
    const port = await freePort();
    const handle = startHttpServer(String(port));
    closers.push(() => handle.close());
    await vi.waitFor(() => expect(spy.mock.calls.flat().join("\n")).toContain(`0.0.0.0:${port}`));
    expect((await get(port, "/health", { authorization: "Bearer s3cret-token" })).status).toBe(200);
  });
});
