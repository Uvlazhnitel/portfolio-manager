import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("PWA foundation", () => {
  it("exposes an installable standalone manifest", () => {
    expect(manifest()).toMatchObject({
      id: "/",
      name: "Portfolio Manager",
      short_name: "Portfolio",
      start_url: "/portfolio",
      scope: "/",
      display: "standalone",
      background_color: "#0f1117",
      theme_color: "#0f1117",
    });

    expect(manifest().icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ src: "/icons/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
    ]));
  });

  it.each([
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
    ["icon-maskable-512.png", 512, 512],
    ["apple-touch-icon.png", 180, 180],
  ])("ships %s with the declared dimensions", async (fileName, width, height) => {
    const image = await readFile(path.join(projectRoot, "public/icons", fileName));
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(image.readUInt32BE(16)).toBe(width);
    expect(image.readUInt32BE(20)).toBe(height);
  });

  it("keeps financial pages and APIs outside the service worker cache", async () => {
    const serviceWorker = await readFile(path.join(projectRoot, "public/sw.js"), "utf8");
    const precacheBlock = serviceWorker.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/)?.[1] ?? "";

    expect(serviceWorker).toContain('const OFFLINE_URL = "/offline"');
    expect(precacheBlock).toContain("OFFLINE_URL");
    expect(precacheBlock).toContain('"/manifest.webmanifest"');
    expect(precacheBlock).not.toMatch(/dashboard|portfolio|assistant|scenarios|\/api/);
    expect(serviceWorker).toContain('url.pathname.startsWith("/_next/static/")');
    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).not.toContain("caches.put(request)");
  });
});
