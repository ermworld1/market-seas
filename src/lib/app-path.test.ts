import { describe, expect, it } from "vitest";
import { appPath, rootRedirect } from "./app-path";
import { bankUrls } from "./audio/bank";

describe("/sea deployment URLs", () => {
  it.each(["models/patrol.glb", "sfx/gun/1.mp3", "music/manifest.json", "legend/patrol-bid.png", "icon.svg", "favicon.ico", "apple-touch-icon.png", "robots.txt", "api/public/settle", "_serverFn/id"])("prefixes %s once", (path) => {
    expect(appPath(path)).toBe(`/sea/${path}`);
    expect(appPath(`/${path}`)).toBe(`/sea/${path}`);
  });
  it("prefixes recorded sample URLs while keeping the cache version", () => {
    expect(bankUrls("gun")[0]).toBe("/sea/sfx/gun/1.mp3?v=21");
  });
  it("redirects only the bare deployment root with 302 and preserves the symbol", () => {
    const response = rootRedirect(new Request("https://market-seas.vercel.app/?symbol=BTCUSDT"));
    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/sea/?symbol=BTCUSDT");
  });
  it.each(["/sea/", "/sea/api/public/settle", "/sea/_serverFn/id", "/land"])("does not redirect %s", (path) => {
    expect(rootRedirect(new Request(`https://donotdie.live${path}`))).toBeNull();
  });
});