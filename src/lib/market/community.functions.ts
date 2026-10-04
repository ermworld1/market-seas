import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { battleWindow } from "@/lib/battle/round";
import { PICK_WINDOW_MS } from "./predictions";

const profileSchema = z.object({ nickname: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9 _-]+$/), side: z.enum(["buyers", "sellers"]) });
const predictionSchema = z.object({ roundKey: z.string().min(3).max(100), roundKind: z.enum(["winner", "flagship"]), battleId: z.number().int(), choice: z.enum(["buyers", "sellers", "sunk", "dive", "hold"]), side: z.enum(["bid", "ask"]).optional(), bucket: z.number().int().optional(), price: z.number().positive().optional(), startsAt: z.number().int(), endsAt: z.number().int() });
const periodSchema = z.object({ period: z.enum(["today", "week", "season"]) });

export const saveProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v) => profileSchema.parse(v)).handler(async ({ data, context }) => {
  const { error } = await context.supabase.from("player_profiles").upsert({ user_id: context.userId, nickname: data.nickname, side: data.side, updated_at: new Date().toISOString() });
  if (error) throw new Error("Could not save profile");
  return { ok: true };
});

export const getMyProfile = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.from("player_profiles").select("nickname,side").eq("user_id", context.userId).maybeSingle();
  return data;
});

export function validatePredictionWindow(input: z.infer<typeof predictionSchema>, now: number) {
  const w = battleWindow(now);
  if (input.roundKind === "winner") return input.battleId === w.id && now <= w.start + PICK_WINDOW_MS && input.endsAt === w.end;
  return input.battleId === w.id && input.endsAt === input.startsAt + 60_000 && now >= input.startsAt - 2_000 && now <= input.startsAt + 15_000;
}

export const submitPrediction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v) => predictionSchema.parse(v)).handler(async ({ data, context }) => {
  const now = Date.now();
  if (!validatePredictionWindow(data, now)) throw new Error("This prediction window is closed");
  const minuteAgo = new Date(now - 60_000).toISOString();
  const { count } = await context.supabase.from("predictions").select("id", { count: "exact", head: true }).eq("user_id", context.userId).gte("submitted_at", minuteAgo);
  if ((count ?? 0) >= 6) throw new Error("Prediction limit reached. Try again shortly.");
  let startSize: number | null = null;
  if (data.roundKind === "flagship") {
    if (!data.side || !data.price) throw new Error("Flagship pick needs a target");
    const { bucketSize } = await import("./settle.server");
    try { startSize = await bucketSize(data.side, data.price); } catch { throw new Error("Order book unavailable, try again"); }
  }
  const { error } = await context.supabase.from("predictions").insert({ user_id: context.userId, round_key: data.roundKey, round_kind: data.roundKind, battle_id: data.battleId, choice: data.choice, side: data.side ?? null, bucket: data.bucket ?? null, price: data.price ?? null, start_size: startSize, starts_at: new Date(data.roundKind === "winner" ? battleWindow(now).start : data.startsAt).toISOString(), locks_at: new Date(data.roundKind === "winner" ? battleWindow(now).start + PICK_WINDOW_MS : data.startsAt + 15_000).toISOString(), ends_at: new Date(data.endsAt).toISOString() });
  if (error) throw new Error(error.code === "23505" ? "Prediction already locked" : "Could not lock prediction");
  return { ok: true, submittedAt: now };
});

/** Client calls this after observing a round end; the server recomputes outcomes from Binance. */
export const settleMine = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { settleDue } = await import("./settle.server");
  return { settled: await settleDue(supabaseAdmin, { userId: context.userId, graceMs: 2_000, limit: 20 }) };
});

export const getMyHistory = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.from("predictions").select("id,round_kind,choice,outcome,correct,xp_awarded,ends_at,settled_at").eq("user_id", context.userId).order("ends_at", { ascending: false }).limit(30);
  const rows = data ?? [];
  const { currentStreak } = await import("./settlement");
  const settled = rows.filter((r) => r.settled_at).sort((a, b) => Date.parse(a.settled_at!) - Date.parse(b.settled_at!));
  return { rows, streak: currentStreak(settled.map((r) => r.correct)) };
});

export const getLeaderboards = createServerFn({ method: "GET" }).inputValidator((v) => periodSchema.parse(v)).handler(async ({ data }) => {
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(input, { ...init, headers: h }); } } });
  const [leaders, sides] = await Promise.all([sb.rpc("leaderboard_snapshot", { period_key: data.period }), sb.rpc("side_standings", { period_key: data.period })]);
  if (leaders.error || sides.error) throw new Error("Rankings are temporarily unavailable");
  return { leaders: leaders.data ?? [], sides: sides.data ?? [] };
});