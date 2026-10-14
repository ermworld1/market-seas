/**
 * "Ask the map" questions: plain-English answers about the battlefield, filled with the
 * live numbers on screen. Pure: no React, no sockets, no network, no model call, so every
 * answer is instant, free and unit-testable. It explains the map; it never forecasts price.
 */
import { ALL_UNITS, RULES_FACTS, type UnitDef } from "@/lib/battle/units";
import { fmtPrice, usd } from "./predictions";

export interface QaLive {
  now: number;
  last: number;
  mark: number;
  spread: number;
  funding: number;
  nextFundingTime: number;
  oiChangePct: number;
  cvd5m: number;
  depth1: { bid: number; ask: number };
  liq1h: { longs: number; shorts: number };
  walls: Record<"bid" | "ask", { eaten: number; pulled: number; standing: number }>;
  flags: Record<"bid" | "ask", { price: number; notional: number } | null>;
  /** live size range for a unit id, e.g. "$190K to $1.2M"; "" when not known yet */
  range: (unitId: string) => string;
}

export interface QaAnswer {
  /** the topic that answered, for analytics and tests */
  topic: string;
  text: string;
}

const pct = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const has = (n: number) => Number.isFinite(n) && n !== 0;
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

function fundingLine(l: QaLive) {
  if (!has(l.funding) && !has(l.nextFundingTime)) return "";
  const rate = `${(l.funding * 100).toFixed(4)}%`;
  const who = l.funding >= 0 ? "longs pay shorts" : "shorts pay longs";
  const mins = l.nextFundingTime > l.now ? Math.round((l.nextFundingTime - l.now) / 60_000) : 0;
  return `Right now funding is ${rate} (${who})${mins > 0 ? `, next payment in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}` : ""}.`;
}

function flagLine(l: QaLive) {
  const b = l.flags.bid;
  const a = l.flags.ask;
  const parts = [
    b && `Buyers' flagship: ${usd(b.notional)} at ${fmtPrice(b.price)}.`,
    a && `Sellers' flagship: ${usd(a.notional)} at ${fmtPrice(a.price)}.`,
  ];
  return join(...parts);
}

function wallLine(l: QaLive) {
  const w = l.walls;
  const total = w.bid.eaten + w.bid.pulled + w.ask.eaten + w.ask.pulled;
  if (!total) return "";
  return `In the last 30 minutes, $1M+ walls near price: Buyers ${w.bid.eaten} eaten, ${w.bid.pulled} pulled; Sellers ${w.ask.eaten} eaten, ${w.ask.pulled} pulled.`;
}

function unitLine(u: UnitDef, l: QaLive) {
  const live = l.range(u.id);
  // tiers and weapons have percentile rules ("90%–99%"); the live dollar range reads better
  return join(`${u.name}: ${u.text}`, live ? `Right now that means ${live}.` : `Rule: ${u.rule}.`);
}

interface Topic {
  id: string;
  keys: string[];
  say: (l: QaLive) => string;
}

const unit = (id: string) => ALL_UNITS.find((u) => u.id === id)!;

const TOPICS: Topic[] = [
  {
    id: "advice",
    keys: [
      "should i",
      "buy now",
      "sell now",
      "long or short",
      "go long",
      "go short",
      "will btc",
      "will price",
      "price go",
      "predict",
      "target price",
      "moon",
    ],
    say: (l) =>
      join(
        "I only explain what the map shows, not where price goes next, and nothing here is financial advice.",
        has(l.cvd5m) &&
          `What it shows now: aggressive flow over 5 minutes is ${l.cvd5m >= 0 ? "net buying" : "net selling"} (${usd(Math.abs(l.cvd5m))}).`,
        has(l.depth1.bid + l.depth1.ask) &&
          `Resting liquidity within 1%: Buyers ${usd(l.depth1.bid)}, Sellers ${usd(l.depth1.ask)}.`,
      ),
  },
  {
    id: "read",
    keys: [
      "how do i read",
      "how to read",
      "read this",
      "read the map",
      "how does this work",
      "how it works",
      "explain",
      "what am i looking at",
      "basics",
      "start",
      "help",
    ],
    say: () =>
      "The buoyed line in the middle is the last traded BTC price on Binance Futures. Green ships on the left are resting buy liquidity, red ships on the right are resting sell liquidity; a ship's left/right position is its price and its size is the money resting there. Every shot is a real taker trade hitting the other side. When a ship is fully traded it sinks and the line moves through it.",
  },
  {
    id: "line",
    keys: [
      "price line",
      "line",
      "buoy",
      "strait",
      "front line",
      "middle",
      "last price",
      "mark price",
      "mark",
    ],
    say: (l) =>
      join(
        "The line is the last traded price. Buyers lifting the offer push it right into the Sellers' fleet; sellers hitting the bid push it left into the Buyers'.",
        has(l.last) && `Last trade: ${fmtPrice(l.last)}.`,
        has(l.mark) && `Mark price (used for liquidations): ${fmtPrice(l.mark)}.`,
      ),
  },
  {
    id: "flagship",
    keys: ["flagship", "battleship", "biggest", "largest", "boss", "hp bar"],
    say: (l) =>
      join(
        "Each side's flagship is its largest resting wall inside the battle range. Its health bar is its remaining size. Sink the enemy flagship (trade through all of it) to swing the battle.",
        flagLine(l),
      ),
  },
  {
    id: "ships",
    keys: [
      "ship",
      "boat",
      "fleet",
      "size",
      "tier",
      "patrol",
      "destroyer",
      "frigate",
      "cruiser",
      "liquidity",
      "order book",
      "orders",
    ],
    say: (l) => {
      const r = ["patrol", "destroyer", "frigate", "cruiser"]
        .map((id) => [unit(id).name, l.range(id)] as const)
        .filter(([, v]) => v);
      return join(
        `A ship is resting liquidity at one price bucket (${RULES_FACTS.bucket} of the price), usually many orders together, never one order.`,
        "Green decks are Buyers, red decks are Sellers. The further back a ship sits, the longer that liquidity has been resting.",
        r.length > 0 &&
          `Sizes right now: ${r.map(([n, v]) => `${n} ${v}`).join(", ")}; the largest on each side is the flagship.`,
      );
    },
  },
  {
    id: "shots",
    keys: [
      "shot",
      "shoot",
      "fire at",
      "bullet",
      "gun",
      "weapon",
      "trade",
      "taker",
      "machine gun",
      "deck gun",
      "torpedo",
      "broadside",
      "cannon",
    ],
    say: (l) => {
      const r = ["mg", "gun", "torpedo", "broadside"]
        .map((id) => [unit(id).name, l.range(id)] as const)
        .filter(([, v]) => v);
      return join(
        "Every shot is a real taker trade on Binance, fired by the attacking side at the ship resting at that price. The ship loses exactly what was filled.",
        r.length > 0
          ? `Weapon by trade size right now: ${r.map(([n, v]) => `${n} ${v}`).join(", ")}.`
          : "Bigger trade, bigger weapon: machine gun, deck gun, torpedo, broadside.",
      );
    },
  },
  {
    id: "fighter",
    keys: ["fighter", "plane", "jet", "aircraft", "spitfire", "strafe", "sweep"],
    say: (l) =>
      join(
        unitLine(unit("fighter"), l),
        "Several takers can be behind one wave; Binance does not publish who traded.",
      ),
  },
  {
    id: "bomber",
    keys: ["bomber", "liquidation", "liquidated", "liq", "rekt", "cascade", "siren"],
    say: (l) =>
      join(
        "Bombers are real Binance liquidations. A long liquidation is a forced sell, so it bombs the Buyers' side; a short liquidation is a forced buy and bombs the Sellers'. Binance sends at most one liquidation per second, so totals are a lower bound.",
        has(l.liq1h.longs + l.liq1h.shorts) &&
          `Last hour: ${[has(l.liq1h.longs) ? `longs ${usd(l.liq1h.longs)}` : "no longs", has(l.liq1h.shorts) ? `shorts ${usd(l.liq1h.shorts)}` : "no shorts"].join(", ")} liquidated.`,
      ),
  },
  {
    id: "submarine",
    keys: [
      "submarine",
      "sub",
      "dive",
      "pulled",
      "pull",
      "spoof",
      "fake",
      "cancel",
      "disappear",
      "vanish",
      "fled",
      "surface",
      "relocate",
    ],
    say: (l) =>
      join(
        "A submarine dive means big liquidity was cancelled before any trade reached it. If the same size reappears at another price soon after, the submarine surfaces there. Walls that keep diving as price approaches are often not meant to be filled.",
        wallLine(l),
      ),
  },
  {
    id: "iceberg",
    keys: ["iceberg", "hidden", "more traded"],
    say: (l) =>
      unitLine(unit("hidden"), l) +
      " It is inferred from the numbers; Binance does not mark iceberg orders.",
  },
  {
    id: "damage",
    keys: ["smoke", "fire", "burn", "damage", "flame", "hit"],
    say: () =>
      "Fire and smoke mean a ship was partly filled: trades took some of its size and it is burning until it is refilled or sunk. A thin smoke screen with no fire is different: smaller liquidity was pulled and the ship slipped away.",
  },
  {
    id: "sink",
    keys: ["sink", "sunk", "sinking", "destroyed", "kill"],
    say: () =>
      "A ship sinks when its whole displayed size is traded. The price line then moves through that price, which is how the front line advances.",
  },
  {
    id: "repair",
    keys: ["repair", "reinforce", "refill", "grow", "added"],
    say: (l) => join(unitLine(unit("reinforce"), l), unitLine(unit("repair"), l)),
  },
  {
    id: "splash",
    keys: ["splash", "miss", "water"],
    say: () =>
      "A splash is a real trade that printed at a price where no ship was showing, so it hit open water.",
  },
  {
    id: "funding",
    keys: ["funding", "tanker", "oil"],
    say: (l) =>
      join(
        "The oil tanker is neutral: funding is paid between longs and shorts, not between the buy and sell fleets.",
        fundingLine(l),
      ),
  },
  {
    id: "oi",
    keys: ["open interest", "oi", "convoy", "transport"],
    say: (l) =>
      join(
        "The convoy on the horizon is open interest, which has no side. It sails in when open interest rises over 5 minutes and out when it falls.",
        has(l.oiChangePct) && `Open interest change (5m): ${pct(l.oiChangePct)}.`,
      ),
  },
  {
    id: "storm",
    keys: ["storm", "rain", "weather", "wave", "volatility"],
    say: () =>
      "The sea gets rougher and the rain heavier when realised volatility is high and the battle phase escalates. It is mood, not data you trade on.",
  },
  {
    id: "depth",
    keys: ["front", "back", "behind", "far", "depth", "age", "old", "lane", "row"],
    say: () =>
      "Left/right is price. Front/back is how long the liquidity has been resting: new liquidity sits near the front, older liquidity further back.",
  },
  {
    id: "colors",
    keys: ["green", "red", "colour", "color", "buyers", "sellers", "bid", "ask", "side"],
    say: () =>
      "Green ships are Buyers (resting bids, left of the line). Red ships are Sellers (resting asks, right of the line). Shots take the colour of the side firing them.",
  },
  {
    id: "battle",
    keys: ["battle", "win", "score", "clock", "round", "who wins", "points"],
    say: () =>
      `Each battle lasts ${RULES_FACTS.battleMinutes} minutes. The side that moves the price line its way wins the round; sinking the enemy flagship is the big swing. The daily score sits next to the clock.`,
  },
  {
    id: "stats",
    keys: ["spread", "cvd", "delta", "stat", "strip", "numbers", "walls eaten"],
    say: (l) =>
      join(
        "The strip under the header: spread, resting depth within 0.5% and 1% each side, CVD (net aggressive buying minus selling) over 1 and 5 minutes, liquidations in the last hour, funding and $1M wall statistics.",
        has(l.spread) && `Spread now: ${fmtPrice(l.spread)}.`,
        wallLine(l),
      ),
  },
  {
    id: "data",
    keys: ["real", "data", "source", "delay", "latency", "simulated", "binance", "accurate"],
    say: () =>
      "Everything comes from Binance USD-M public market data: the full order book (snapshot plus 100ms updates), every aggregated trade, liquidations and mark price, with open interest polled every 30 seconds. Nothing on the battlefield is simulated. Repairs, relocations and icebergs are inferred and labelled that way.",
  },
  {
    id: "sound",
    keys: ["sound", "audio", "radio", "voice", "music", "mute"],
    say: () =>
      "Sound follows the same data: gun size follows trade size, engines mean aircraft, and the radio only calls out events you can see. Use the speaker button at the top to mute or change volume.",
  },
  {
    id: "rankings",
    keys: ["rank", "leaderboard", "xp", "prediction", "streak", "join", "sign in", "login"],
    say: () =>
      "Ranks shows predictions made during battles: pick a side before a battle ends and it is scored from Binance data after it closes. Join with email to keep your streak and appear on the board.",
  },
];

/** Units whose question is better answered by a topic with live numbers. */
const UNIT_TOPIC: Record<string, string> = {
  strait: "line",
  battleship: "flagship",
  tanker: "funding",
  convoy: "oi",
  cascade: "bomber",
  dive: "submarine",
  fled: "submarine",
  relocate: "submarine",
  hidden: "iceberg",
  reinforce: "repair",
};

/** Starter questions shown under the answer box. */
export const SUGGESTIONS = [
  "How do I read this map?",
  "What is the flagship?",
  "What do smoke and fire mean?",
  "Why did a ship dive like a submarine?",
  "What are the bombers?",
  "What does the oil tanker mean?",
];

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9$%. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

/** Answer a free-text question about the map using live numbers. */
export function answerQuestion(question: string, live: QaLive): QaAnswer {
  const q = norm(question);
  if (q.trim().length === 0)
    return {
      topic: "empty",
      text: "Ask anything about the battlefield, for example what a unit means or why a ship just sank.",
    };

  // a named unit wins over the generic topics ("torpedo" → the torpedo, not "weapons"),
  // unless a topic already explains that unit with more live numbers
  for (const u of ALL_UNITS) {
    const name = u.name
      .toLowerCase()
      .replace(/\s*\(.*\)/, "")
      .replace(/,/g, "");
    if (!q.includes(` ${name} `) && !q.includes(` ${name}s `)) continue;
    const topic = TOPICS.find((t) => t.id === (UNIT_TOPIC[u.id] ?? u.id));
    return topic
      ? { topic: topic.id, text: topic.say(live) }
      : { topic: `unit:${u.id}`, text: unitLine(u, live) };
  }

  let best: Topic | null = null;
  let score = 0;
  for (const t of TOPICS) {
    let s = 0;
    for (const k of t.keys)
      if (q.includes(` ${k} `) || q.includes(` ${k}s `) || (k.includes(" ") && q.includes(k)))
        s += k.length;
    if (s > score) {
      score = s;
      best = t;
    }
  }
  if (best) return { topic: best.id, text: best.say(live) };
  return {
    topic: "fallback",
    text: "I don't have an answer for that yet. I can explain ships, shots, the price line, flagships, submarines, bombers, fire and smoke, funding, open interest and the stats strip. Try one of the questions below.",
  };
}
