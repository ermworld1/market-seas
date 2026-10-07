// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

type NitroOption = Exclude<NonNullable<Parameters<typeof defineConfig>[0]>["nitro"], undefined | boolean>;

export default defineConfig({
  // Vercel only (ignored by the Lovable/Cloudflare build): run server functions in Singapore.
  // Binance blocks US IPs (HTTP 451), and the prediction settlement reads Binance REST server-side.
  // (typed loosely: the Lovable config's nitro type only lists its own Cloudflare keys)
  nitro: { vercel: { functions: { regions: ["sin1"] } } } as unknown as NitroOption,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
