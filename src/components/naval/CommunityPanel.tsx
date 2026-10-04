import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { getLeaderboards, getMyHistory, getMyProfile, saveProfile, settleMine } from "@/lib/market/community.functions";
import { Button } from "@/components/ui/button";

type Board = { leaders: { nickname: string; side: string; xp: number; accuracy: number; best_streak: number }[]; sides: { side: string; accuracy: number; settled: number }[] };
type Hist = { rows: { id: string; round_kind: string; choice: string; outcome: string | null; correct: boolean | null; xp_awarded: number; settled_at: string | null }[]; streak: number };

function EmailAuth() {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  const go = async () => {
    setMsg("");
    if (mode === "reset") { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }); setMsg(error ? error.message : "Check your inbox for a reset link."); return; }
    const { error } = mode === "up" ? await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin } }) : await supabase.auth.signInWithPassword({ email, password: pw });
    setMsg(error ? error.message : mode === "up" ? "Check your inbox to confirm your email." : "");
  };
  return <div className="space-y-1">
    <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded border border-input bg-background px-2 py-1" />
    {mode !== "reset" && <input aria-label="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password (min 6)" className="w-full rounded border border-input bg-background px-2 py-1" />}
    <Button className="w-full" variant="secondary" onClick={() => void go()}>{mode === "up" ? "Sign up with email" : mode === "in" ? "Sign in with email" : "Send reset link"}</Button>
    <div className="flex justify-between text-muted-foreground">
      <button onClick={() => setMode(mode === "up" ? "in" : "up")}>{mode === "up" ? "Have an account? Sign in" : "New? Sign up"}</button>
      <button onClick={() => setMode("reset")}>Forgot password?</button>
    </div>
    {msg && <p role="status" className="text-muted-foreground">{msg}</p>}
  </div>;
}

export function CommunityPanel() {
  const boardFn = useServerFn(getLeaderboards); const profileFn = useServerFn(getMyProfile); const saveFn = useServerFn(saveProfile); const histFn = useServerFn(getMyHistory); const settleFn = useServerFn(settleMine);
  const [user, setUser] = useState(false); const [period, setPeriod] = useState<"today" | "week" | "season">("today"); const [board, setBoard] = useState<Board | null>(null);
  const [nickname, setNickname] = useState(""); const [savedNick, setSavedNick] = useState(""); const [side, setSide] = useState<"buyers" | "sellers">("buyers"); const [hist, setHist] = useState<Hist | null>(null); const [saveMsg, setSaveMsg] = useState("");
  const refresh = useCallback(async (signed: boolean) => {
    if (signed) { try { await settleFn(); } catch { /* retried next tick */ } histFn().then(setHist).catch(() => {}); }
    boardFn({ data: { period } }).then(setBoard).catch(() => setBoard(null));
  }, [boardFn, histFn, settleFn, period]);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => { setUser(!!data.user); if (data.user) void profileFn().then((p) => { if (p) { setNickname(p.nickname); setSavedNick(p.nickname); setSide(p.side === "sellers" ? "sellers" : "buyers"); } }); });
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (e === "SIGNED_IN" || e === "SIGNED_OUT") setUser(!!s?.user); });
    return () => data.subscription.unsubscribe();
  }, [profileFn]);
  useEffect(() => { void refresh(user); const t = setInterval(() => void refresh(user), 20_000); return () => clearInterval(t); }, [refresh, user]);
  const myRank = savedNick ? (board?.leaders.findIndex((r) => r.nickname === savedNick) ?? -1) : -1;
  const sideLine = (s: string) => { const r = board?.sides.find((x) => x.side === s); return r ? `${Number(r.accuracy)}%` : "—"; };
  return <div className="min-h-0 space-y-3 overflow-auto p-2 text-xs">
    {!user ? <div className="space-y-2"><Button className="w-full" onClick={() => void lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })}>Join with Google</Button><EmailAuth /></div>
      : <div className="grid grid-cols-[1fr_auto] gap-2"><input aria-label="Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname" className="rounded border border-input bg-background px-2" /><select aria-label="Side" value={side} onChange={(e) => setSide(e.target.value === "sellers" ? "sellers" : "buyers")} className="rounded border border-input bg-background px-2"><option value="buyers">Buyers</option><option value="sellers">Sellers</option></select><Button className="col-span-2" onClick={() => void saveFn({ data: { nickname, side } }).then(() => { setSavedNick(nickname); setSaveMsg("Saved"); }).catch(() => setSaveMsg("Nickname taken or invalid"))}>Save profile</Button>{saveMsg && <span className="col-span-2 text-muted-foreground">{saveMsg}</span>}<button className="col-span-2 text-left text-muted-foreground" onClick={() => void supabase.auth.signOut()}>Sign out</button></div>}
    <p className="font-mono">Buyers fans {sideLine("buyers")} · Sellers fans {sideLine("sellers")} {period === "season" ? "this season" : period === "week" ? "this week" : "today"}</p>
    {user && <p className="font-mono">Streak {hist?.streak ?? 0} · Rank {myRank >= 0 ? `#${myRank + 1}` : "unranked"}</p>}
    <div className="flex gap-1">{(["today", "week", "season"] as const).map((p) => <Button key={p} size="sm" variant={period === p ? "default" : "secondary"} onClick={() => setPeriod(p)}>{p}</Button>)}</div>
    <ol className="space-y-1 font-mono">{board?.leaders.map((r, i) => <li key={`${r.nickname}-${i}`} className={`grid grid-cols-[2rem_1fr_auto] border-b border-border py-1 ${r.nickname === savedNick ? "text-primary" : ""}`}><span>{i + 1}</span><span>{r.nickname} · {r.side}</span><span>{r.xp} XP · {r.accuracy}% · 🔥{r.best_streak}</span></li>)}</ol>
    {!board?.leaders.length && <p className="text-muted-foreground">No settled predictions in this period yet.</p>}
    {user && <div><h3 className="mb-1 font-semibold">My predictions</h3><ul className="space-y-1 font-mono">{hist?.rows.map((r) => <li key={r.id} className="flex justify-between border-b border-border py-1"><span>{r.round_kind} · {r.choice}</span><span>{r.settled_at ? `${r.outcome}${r.correct === null ? " · void" : r.correct ? ` · +${r.xp_awarded} XP` : " · miss"}` : "pending"}</span></li>)}</ul>{!hist?.rows.length && <p className="text-muted-foreground">No picks yet.</p>}</div>}
  </div>;
}
