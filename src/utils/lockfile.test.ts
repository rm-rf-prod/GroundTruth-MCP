import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectVersionFromLockfile, detectAllVersions } from "./lockfile.js";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "fs/promises";

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  mockReadFile.mockReset();
});

describe("detectVersionFromLockfile", () => {
  it("reads version from package-lock.json (lockfileVersion 2/3)", async () => {
    const lockContent = JSON.stringify({
      packages: {
        "node_modules/react": { version: "19.1.0" },
        "node_modules/@types/node": { version: "22.6.0" },
      },
    });
    mockReadFile.mockResolvedValueOnce(lockContent);

    const result = await detectVersionFromLockfile("/project", "react");
    expect(result).toBe("19.1.0");
  });

  it("reads scoped package from package-lock.json", async () => {
    const lockContent = JSON.stringify({
      packages: {
        "node_modules/@types/node": { version: "22.6.0" },
      },
    });
    mockReadFile.mockResolvedValueOnce(lockContent);

    const result = await detectVersionFromLockfile("/project", "@types/node");
    expect(result).toBe("22.6.0");
  });

  it("falls back to dependencies field (lockfileVersion 1)", async () => {
    const lockContent = JSON.stringify({
      dependencies: {
        express: { version: "4.21.0" },
      },
    });
    mockReadFile.mockResolvedValueOnce(lockContent);

    const result = await detectVersionFromLockfile("/project", "express");
    expect(result).toBe("4.21.0");
  });

  it("reads version from pnpm-lock.yaml", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT")); // no package-lock
    const pnpmContent = `lockfileVersion: '9.0'
packages:
  'react@19.1.0':
    resolution: {integrity: sha256-abc}
`;
    mockReadFile.mockResolvedValueOnce(pnpmContent);

    const result = await detectVersionFromLockfile("/project", "react");
    expect(result).toBe("19.1.0");
  });

  it("reads version from yarn.lock", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT")); // no package-lock
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT")); // no pnpm-lock
    const yarnContent = `"react@^19.0.0":
  version "19.1.0"
  resolved "https://registry.yarnpkg.com/react/-/react-19.1.0.tgz"
`;
    mockReadFile.mockResolvedValueOnce(yarnContent);

    const result = await detectVersionFromLockfile("/project", "react");
    expect(result).toBe("19.1.0");
  });

  it("reads version from Cargo.lock", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT")); // no package-lock
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT")); // no pnpm-lock
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT")); // no yarn.lock
    const cargoContent = `[[package]]
name = "serde"
version = "1.0.210"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
    mockReadFile.mockResolvedValueOnce(cargoContent);

    const result = await detectVersionFromLockfile("/project", "serde");
    expect(result).toBe("1.0.210");
  });

  it("returns null when no lockfile exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await detectVersionFromLockfile("/project", "react");
    expect(result).toBeNull();
  });

  it("returns null when package not found in lockfile", async () => {
    const lockContent = JSON.stringify({
      packages: {
        "node_modules/react": { version: "19.1.0" },
      },
    });
    mockReadFile.mockResolvedValueOnce(lockContent);

    const result = await detectVersionFromLockfile("/project", "vue");
    expect(result).toBeNull();
  });
});

describe("detectAllVersions", () => {
  it("returns versions for multiple packages", async () => {
    const lockContent = JSON.stringify({
      packages: {
        "node_modules/react": { version: "19.1.0" },
        "node_modules/zod": { version: "3.23.0" },
      },
    });
    mockReadFile.mockImplementation(async (path: unknown) => {
      if (typeof path === "string" && path.endsWith("package-lock.json")) {
        return lockContent;
      }
      throw new Error("ENOENT");
    });

    const result = await detectAllVersions("/project", ["react", "zod", "missing-pkg"]);
    expect(result.get("react")).toBe("19.1.0");
    expect(result.get("zod")).toBe("3.23.0");
    expect(result.has("missing-pkg")).toBe(false);
  });

  it("returns empty map when no lockfiles exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await detectAllVersions("/project", ["react"]);
    expect(result.size).toBe(0);
  });
});
