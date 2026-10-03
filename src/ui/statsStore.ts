import { shiftIsoDate } from "../game/format.ts";

export type DailyMode = "Halves" | "Thirds" | "Quarters";

export type ModeResult = {
  scores: number[];
  regions: string[];
  total: number;
};

type Saved = {
  days: Record<string, Partial<Record<DailyMode, ModeResult>>>;
};

const KEY = "popsplit-stats-v1";

export function resultFor(date: string, mode: DailyMode): ModeResult | null {
  return load().days[date]?.[mode] ?? null;
}

export function recordResult(date: string, mode: DailyMode, scores: number[], regions: string[]): boolean {
  const saved = load();
  const day = saved.days[date] ?? {};
  if (day[mode]) return false;
  day[mode] = { scores, regions, total: scores.reduce((sum, score) => sum + score, 0) };
  saved.days[date] = day;
  save(saved);
  return true;
}

export function allResults(): Array<{ date: string; mode: DailyMode; result: ModeResult }> {
  const saved = load();
  const rows: Array<{ date: string; mode: DailyMode; result: ModeResult }> = [];
  for (const date of Object.keys(saved.days).sort()) {
    const day = saved.days[date];
    if (!day) continue;
    for (const mode of ["Halves", "Thirds", "Quarters"] as const) {
      const result = day[mode];
      if (result) rows.push({ date, mode, result });
    }
  }
  return rows;
}

export function summarize(today: string) {
  const rows = allResults();
  const dates = [...new Set(rows.map((row) => row.date))];
  const rounds = rows.flatMap((row) => row.result.scores);
  const buckets = Array.from({ length: 10 }, () => 0);
  for (const score of rounds) buckets[Math.min(9, Math.floor(score / 10))] += 1;
  const average = rounds.length ? rounds.reduce((sum, score) => sum + score, 0) / rounds.length : 0;
  return {
    played: rows.length,
    average,
    currentStreak: currentStreak(dates, today),
    bestStreak: bestStreak(dates),
    buckets,
    recent: rows.slice(-12).reverse(),
  };
}

function currentStreak(dates: string[], today: string): number {
  const played = new Set(dates);
  let cursor = played.has(today) ? today : shiftIsoDate(today, -1);
  if (!played.has(cursor)) return 0;
  let streak = 0;
  while (played.has(cursor)) {
    streak += 1;
    cursor = shiftIsoDate(cursor, -1);
  }
  return streak;
}

function bestStreak(dates: string[]): number {
  const unique = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of unique) {
    run = prev && shiftIsoDate(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return best;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { days: {} };
    const parsed = JSON.parse(raw) as Saved;
    if (!parsed || typeof parsed !== "object" || !parsed.days) return { days: {} };
    return parsed;
  } catch {
    return { days: {} };
  }
}

function save(saved: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* private mode or a full disk should not break the round */
  }
}
