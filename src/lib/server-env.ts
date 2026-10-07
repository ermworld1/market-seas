// Hosts other than Lovable Cloud (e.g. Vercel) don't inject the Supabase settings at runtime.
// URL, project id and publishable key are public values already baked into the build from
// .env (VITE_*), so server code falls back to them. Secrets (service role) are never defaulted.
// (Called explicitly: package.json has "sideEffects": false, so a bare import would be dropped.)
export function applyServerEnvDefaults() {
  const env = typeof process !== "undefined" ? process.env : undefined;
  if (!env) return;
  env["SUPABASE_URL"] ||= import.meta.env["VITE_SUPABASE_URL"];
  env["SUPABASE_PUBLISHABLE_KEY"] ||= import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  env["SUPABASE_PROJECT_ID"] ||= import.meta.env["VITE_SUPABASE_PROJECT_ID"];
}
