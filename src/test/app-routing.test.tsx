import { createMemoryHistory, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { getRouter } from "@/router";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it.each(["/sea/", "/sea/stats", "/sea/reset-password", "/sea/api/public/settle"])("matches %s beneath /sea", (path) => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: [path] }) });
    const matches = router.matchRoutes(router.latestLocation.pathname);

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
  it("prefixes internal navigation without losing symbol parameters", () => {
    const location = getRouter().buildLocation({ to: "/", search: { symbol: "BTCUSDT" } });
    expect(location.publicHref).toBe('/sea/?symbol=BTCUSDT');
    expect(location.search).toEqual({ symbol: "BTCUSDT" });
  });
});
