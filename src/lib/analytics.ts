/** Device-local analytics events (feed the /stats page). Never leave the device. */
export type AnalyticsName = "page_view" | "tour_done" | "sound_on" | "first_kill_seen" | "battle_watched_to_end" | "prediction_made" | "session_end";
export interface AnalyticsEvent {
  n: AnalyticsName;
  t: number;
  v?: number | string;
}
const KEY = "nms-analytics-v1";
export function track(n: AnalyticsName, v?: number | string) {
  try {
    const list: AnalyticsEvent[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    list.push(v === undefined ? { n, t: Date.now() } : { n, t: Date.now(), v });
    if (list.length > 3000) list.splice(0, list.length - 3000);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
export function readAnalytics(): AnalyticsEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
