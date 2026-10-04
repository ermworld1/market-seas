import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { getLeaderboards, getMyProfile, saveProfile } from "@/lib/market/community.functions";
import { Button } from "@/components/ui/button";

type Board = { leaders: { nickname: string; side: string; xp: number; accuracy: number }[]; sides: { side: string; accuracy: number; settled: number }[] };
export function CommunityPanel() {
  const boardFn = useServerFn(getLeaderboards); const profileFn = useServerFn(getMyProfile); const saveFn = useServerFn(saveProfile);
  const [user, setUser] = useState(false); const [period, setPeriod] = useState<"today" | "week" | "season">("today"); const [board, setBoard] = useState<Board | null>(null); const [nickname, setNickname] = useState(""); const [side, setSide] = useState<"buyers" | "sellers">("buyers");
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => { setUser(!!data.user); if (data.user) void profileFn().then((p) => { if (p) { setNickname(p.nickname); setSide(p.side); } }); }); const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(!!s?.user)); return () => data.subscription.unsubscribe(); }, [profileFn]);
  useEffect(() => { void boardFn({ data: { period } }).then(setBoard).catch(() => setBoard(null)); }, [boardFn, period]);
  return <div className="min-h-0 overflow-auto p-2 text-xs">
    {!user ? <Button className="w-full" onClick={() => void lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })}>Join with Google</Button> : <div className="mb-3 grid grid-cols-[1fr_auto] gap-2"><input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname" className="rounded border border-input bg-background px-2" /><select value={side} onChange={(e) => setSide(e.target.value as typeof side)} className="rounded border border-input bg-background px-2"><option value="buyers">Buyers</option><option value="sellers">Sellers</option></select><Button className="col-span-2" onClick={() => void saveFn({ data: { nickname, side } })}>Save profile</Button></div>}
    <div className="mb-2 flex gap-1">{(["today", "week", "season"] as const).map((p) => <Button key={p} size="sm" variant={period === p ? "default" : "secondary"} onClick={() => setPeriod(p)}>{p}</Button>)}</div>
    <ol className="space-y-1 font-mono">{board?.leaders.map((r, i) => <li key={`${r.nickname}-${i}`} className="grid grid-cols-[2rem_1fr_auto] border-b border-border py-1"><span>{i + 1}</span><span>{r.nickname} · {r.side}</span><span>{r.xp} XP · {r.accuracy}%</span></li>)}</ol>
    {!board?.leaders.length && <p className="py-3 text-muted-foreground">No settled predictions in this period yet.</p>}
  </div>;
}