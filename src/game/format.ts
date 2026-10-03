import type { SplitKind } from "./types.ts";

export function localIsoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatPop(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatPopShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString("en-US");
}

export function formatPct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

export function splitLabel(kind: SplitKind): string {
  if (kind === "halves") return "Halves";
  if (kind === "thirds") return "Thirds";
  return "Quarters";
}

export function scaleLabel(scale: "country" | "subregion" | "zoom" | "state"): string {
  if (scale === "country") return "Country";
  if (scale === "subregion") return "Region";
  if (scale === "state") return "State";
  return "Close-up";
}

export function roundTitle(name: string, detail: string | null): string {
  return detail ? `${name} — ${detail}` : name;
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

export function scoreBlocks(score: number): string {
  const full = Math.floor(Math.max(0, Math.min(100, score)) / 20);
  const remainder = score - full * 20;
  let blocks = "";
  for (let i = 0; i < 5; i++) {
    if (i < full) blocks += "🟩";
    else if (i === full && remainder >= 8) blocks += "🟨";
    else blocks += "⬜";
  }
  return blocks;
}

export function shareText(date: string, mode: string, scores: number[]): string {
  const total = scores.reduce((sum, score) => sum + score, 0);
  const head = `PopSplit ${date} ${mode} ${scores.join(" / ")} (${total}/${scores.length * 100})`;
  return `${head}\n${scores.map((score) => scoreBlocks(score)).join("\n")}`;
}
