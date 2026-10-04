import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password · No Man's Sea" }, { name: "description", content: "Choose a new password for your No Man's Sea profile." }, { property: "og:title", content: "Reset password · No Man's Sea" }, { property: "og:description", content: "Choose a new password for your No Man's Sea profile." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState(""); const nav = useNavigate();
  return <main className="mx-auto mt-24 max-w-sm space-y-3 p-4">
    <h1 className="text-xl font-semibold">Set a new password</h1>
    <input aria-label="New password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full rounded border border-input bg-background px-2 py-2" />
    <Button className="w-full" onClick={async () => { const { error } = await supabase.auth.updateUser({ password: pw }); if (error) setMsg(error.message); else void nav({ to: "/" }); }}>Save password</Button>
    {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
  </main>;
}
