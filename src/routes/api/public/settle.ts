import { createFileRoute } from "@tanstack/react-router";

// Scheduled settlement (pg_cron → every minute). Takes no input; outcomes come only from
// Binance REST and updates are idempotent, so the caller just needs the project's public key.
export const Route = createFileRoute("/api/public/settle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
        if (!key || !expected || key !== expected) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { settleDue } = await import("@/lib/market/settle.server");
        const settled = await settleDue(supabaseAdmin, { graceMs: 60_000, limit: 100 });
        return Response.json({ settled });
      },
    },
  },
});
