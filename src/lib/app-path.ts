/** Vite owns the deployment prefix; route IDs and external gateway links stay unprefixed. */
export const APP_BASE = import.meta.env.BASE_URL;
export const APP_BASEPATH = APP_BASE.replace(/\/$/, "");

export function appPath(path = ""): string {
  return `${APP_BASE}${path.replace(/^\/+/, "")}`;
}

/** Only the deployment's bare root redirects; preserve query parameters. */
export function rootRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== "/") return null;
  return new Response(null, { status: 302, headers: { Location: appPath() + url.search } });
}