import { ArrowUp, ArrowUpRight, Bot } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AIRCRAFT, RULES_FACTS, SHIPS, WEAPONS } from "@/lib/battle/units";
import { answerQuestion, SUGGESTIONS, type QaLive } from "@/lib/market/askqa";
import { useBattle, type HudSnapshot } from "@/lib/market/store";
import { track } from "@/lib/analytics";
import { UnitList, shortRange } from "./Units";

const GUIDE = [
  "The vertical line in the middle is the last traded BTC price on Binance Futures. Resting buy liquidity waits on the left; sell liquidity on the right.",
  "Left/right = price. Front/back = how long that liquidity has been resting: the older it is, the further back its ship sits. Bigger ship = more resting liquidity. A ship is many orders in one price bucket, not one order.",
  "Ships are makers. Every shot is a real taker trade launched from the attacking fleet; the ship at that price loses what was filled. A fully traded ship sinks and the front line moves.",
  "Big liquidity that disappears before anyone trades into it dives as a submarine. If it pops up at another price, the submarine surfaces there. If more trades hit a price than was showing, a hidden submarine was there (possible iceberg).",
  "Bombers are liquidations, labelled Long or Short liquidated (sampled by Binance: max 1 per second).",
  `Each battle lasts ${RULES_FACTS.battleMinutes} minutes. Sink the enemy flagship and push the line to win.`,
];
const DETAILS = [
  `Ships group the full order book into price buckets of ${RULES_FACTS.bucket} of the price, within ±${RULES_FACTS.range}.`,
  `Tiers by rolling percentile of bucket size: ${SHIPS.map((u) => `${u.name} ${u.rule}`).join("; ")}.`,
  `Weapons by trade-size rank: ${WEAPONS.map((u) => `${u.name} ${u.rule}`).join("; ")}. Fighter: ${AIRCRAFT[0]!.rule}.`,
  "Inferred events (repair, relocate, hidden) are guesses from book changes; Binance does not publish order identities. Fighters aggregate same-side aggressive trades within 0.3 s, which may come from several takers.",
  "Data: Binance USD-M public streams (diff depth 100ms + REST snapshot, aggTrade, forceOrder, markPrice) and open interest polled every 30s.",
  "Longs/shorts in the banner come from open interest change with price direction, never from the order book.",
];

/** Live numbers the answers may quote, read from the throttled HUD snapshot. */
function liveFrom(h: HudSnapshot, now: number): QaLive {
  return {
    now,
    last: h.last,
    mark: h.mark,
    spread: h.spread,
    funding: h.funding,
    nextFundingTime: h.nextFundingTime,
    oiChangePct: h.oiChangePct,
    cvd5m: h.cvd5m,
    depth1: h.depth1,
    liq1h: h.liq1h,
    walls: h.walls,
    flags: {
      bid: h.flags.bid ? { price: h.flags.bid.price, notional: h.flags.bid.notional } : null,
      ask: h.flags.ask ? { price: h.flags.ask.price, notional: h.flags.ask.notional } : null,
    },
    range: (id) =>
      id === "battleship" || id === "fighter" || id === "bomber" ? "" : shortRange(id),
  };
}

function ReadingGuide() {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(localStorage.getItem("nms-more") === "1"), []);
  return (
    <div className="mt-2">
      <ul className="space-y-1.5 text-xs leading-snug text-foreground/90">
        {GUIDE.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
      <button
        className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-primary"
        onClick={() =>
          setMore((v) => {
            localStorage.setItem("nms-more", v ? "0" : "1");
            return !v;
          })
        }
      >
        {more ? "Fewer details −" : "More details +"}
      </button>
      {more && (
        <ul className="mt-1.5 space-y-1 text-[11px] leading-snug text-muted-foreground">
          {DETAILS.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
      <h3 className="mt-3 font-display text-xs font-semibold uppercase tracking-widest text-primary">
        Units
      </h3>
      <UnitList items={[...SHIPS, ...WEAPONS, ...AIRCRAFT]} compact explainSides />
      <button
        onClick={() => useBattle.setState({ helpOpen: true })}
        className="mt-2 text-[11px] font-semibold text-primary underline underline-offset-2"
      >
        All units and events
      </button>
    </div>
  );
}

/**
 * "Ask the map": type or pick a question about the battlefield and get a plain answer that
 * quotes the live numbers on screen. Answers come from askqa.ts (no model, no network), and
 * stay live: the same question is re-answered as the HUD updates.
 */
export function AskPanel() {
  const hud = useBattle((s) => s.hud);
  const [question, setQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => setGuideOpen(localStorage.getItem("nms-guide-open") === "1"), []);

  const answer = useMemo(
    () => (question ? answerQuestion(question, liveFrom(hud, Date.now())) : null),
    [question, hud],
  );
  const suggestions = SUGGESTIONS.filter((s) => s !== question).slice(0, 3);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setQuestion(text);
    setDraft("");
    track("ask_map", answerQuestion(text, liveFrom(useBattle.getState().hud, Date.now())).topic);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };

  return (
    <section id="ask-the-map" className="h-full min-h-0 overflow-auto p-2.5" data-tour="ask">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
        <Bot className="h-[18px] w-[18px] text-primary" aria-hidden />
        Ask the map
      </h2>

      {answer && question ? (
        <div className="mt-2" aria-live="polite">
          <div className="text-sm font-semibold text-primary">{question}</div>
          <p className="mt-1.5 rounded-md border-l-2 border-border bg-black/25 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/90">
            {answer.text}
          </p>
        </div>
      ) : (
        <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
          Ask what anything on the battlefield means. Answers quote the live numbers on screen and
          explain the map only, never where price goes.
        </p>
      )}

      <div className="mt-3 grid gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => ask(s)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background/30 px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span>{s}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about the map..."
          aria-label="Ask about the map"
          maxLength={200}
          className="min-w-0 flex-1 rounded-md border border-border bg-background/40 px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={!draft.trim()}
          className="grid w-11 shrink-0 place-items-center rounded-md border border-border bg-background/40 text-muted-foreground transition-colors enabled:hover:text-foreground disabled:opacity-50"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>

      <button
        onClick={() =>
          setGuideOpen((v) => {
            localStorage.setItem("nms-guide-open", v ? "0" : "1");
            return !v;
          })
        }
        aria-expanded={guideOpen}
        className="mt-4 flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        How to read the map{" "}
        <span className="text-base leading-none text-muted-foreground">
          {guideOpen ? "−" : "+"}
        </span>
      </button>
      {guideOpen && <ReadingGuide />}
    </section>
  );
}
