import { selectDaily } from "../game/daily.ts";
import { esc, formatDateLong, localIsoDate, splitLabel } from "../game/format.ts";
import { hashString, mulberry32 } from "../game/rng.ts";
import type { GameData } from "../game/load.ts";
import { loadGameData } from "../game/load.ts";
import type { CountryShape, Round, SplitKind } from "../game/types.ts";
import { materialize, randomPoolItem } from "../game/world.ts";
import { mountPlay } from "./play.ts";
import { recordResult, resultFor, summarize } from "./statsStore.ts";
import type { DailyMode } from "./statsStore.ts";
import { initTheme, themeLabel, toggleTheme } from "./theme.ts";

const MODES: Array<{ kind: SplitKind; mode: DailyMode; blurb: string; accent: string }> = [
  { kind: "halves", mode: "Halves", blurb: "One straight line. Aim for the same number of people on each side.", accent: "coral" },
  { kind: "thirds", mode: "Thirds", blurb: "A hub and three spokes. Aim for a third of the people in each wedge.", accent: "teal" },
  { kind: "quarters", mode: "Quarters", blurb: "Two lines locked at a right angle. Aim for a quarter in each piece.", accent: "gold" },
];

export async function startApp(root: HTMLElement): Promise<void> {
  initTheme();
  renderLoading(root, 0.04, "Opening the atlas");
  try {
    const data = await loadGameData((ratio, label) => renderLoading(root, ratio, label));
    let cleanup: (() => void) | null = null;
    const show = (next: () => (() => void) | void) => {
      cleanup?.();
      cleanup = next() ?? null;
    };
    const route = () => show(() => renderRoute(root, data, show));
    window.addEventListener("hashchange", route);
    window.addEventListener("visibilitychange", () => {
      const hash = location.hash;
      if (document.visibilityState === "visible" && (hash === "" || hash === "#/" || hash === "#")) route();
    });
    route();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The maps could not be loaded.";
    root.innerHTML = `<section class="gate"><h1>PopSplit</h1><p>${esc(message)}</p></section>`;
  }
}

function renderRoute(root: HTMLElement, data: GameData, show: (next: () => (() => void) | void) => void): (() => void) | void {
  const hash = location.hash || "#/";
  if (hash === "#/stats") return renderStats(root, data);
  if (hash === "#/country") return renderCountry(root, data, show);
  if (hash === "#/unlimited") return renderUnlimited(root, data, show);
  if (hash === "#/halves") return startDaily(root, data, "halves");
  if (hash === "#/thirds") return startDaily(root, data, "thirds");
  if (hash === "#/quarters") return startDaily(root, data, "quarters");
  renderHome(root, data);
}

function renderHome(root: HTMLElement, data: GameData): void {
  const today = localIsoDate();
  const cards = MODES.map((mode, index) => {
    const saved = resultFor(today, mode.mode);
    return `
      <button class="mode-card accent-${mode.accent}" type="button" data-go="#/${mode.kind}">
        <span class="index">0${index + 1}</span>
        <span>
          <span class="mode-kicker">Daily · ${esc(today)}</span>
          <strong>${mode.mode}</strong>
          <em>${mode.blurb}</em>
        </span>
        <span class="mode-meta">${saved ? `${saved.total}/300 saved` : "3 rounds"}</span>
      </button>
    `;
  }).join("");
  root.innerHTML = `
    <section class="home">
      ${topBar("Stats")}
      <p class="dateline">${esc(formatDateLong(today))}</p>
      <h1>Split the population.</h1>
      <p class="lede">A new trio of maps at your local midnight. Drag a cut, lock it in, and see how evenly the people fall.</p>
      <h2>Today</h2>
      <div class="mode-list">${cards}</div>
      <h2>Practice</h2>
      <div class="mode-list">
        <button class="mode-card accent-ink" type="button" data-go="#/unlimited">
          <span class="index">∞</span>
          <span>
            <span class="mode-kicker">Any split</span>
            <strong>Unlimited</strong>
            <em>A fresh map every time. Countries, regions, and close-ups, in whatever cut you pick.</em>
          </span>
          <span class="mode-meta">Practice</span>
        </button>
        <button class="mode-card accent-iris" type="button" data-go="#/country">
          <span class="index">A–Z</span>
          <span>
            <span class="mode-kicker">Pick a place</span>
            <strong>Country</strong>
            <em>Search the atlas or deal a country at random. The cut starts as halves.</em>
          </span>
          <span class="mode-meta">${data.countries.length} places</span>
        </button>
      </div>
      <p class="footnote">Map tiles © OpenStreetMap contributors, via Leaflet. Scored coastlines are Natural Earth. ${esc(data.header.sourceDetail)}</p>
    </section>
  `;
  bindChrome(root);
  root.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((button) => {
    button.onclick = () => go(button.dataset.go ?? "#/");
  });
}

function renderStats(root: HTMLElement, data: GameData): void {
  const today = localIsoDate();
  const stats = summarize(today);
  const maxBucket = Math.max(1, ...stats.buckets);
  const bars = stats.buckets.map((count, index) => {
    const label = index === 9 ? "90+" : `${index * 10}`;
    return `<div class="bar-col"><div class="bar" style="height:${Math.max(4, (count / maxBucket) * 120)}px"></div><span>${label}</span></div>`;
  }).join("");
  const recent = stats.recent.length
    ? stats.recent.map((row) => `<li><span>${esc(row.date)} · ${row.mode}</span><strong>${row.result.total}/300</strong></li>`).join("")
    : `<li class="empty">No puzzles finished yet. Play today's Halves to start a streak.</li>`;
  root.innerHTML = `
    <section class="home">
      ${topBar("Home", "#/")}
      <p class="dateline">Your browser only</p>
      <h1>Stats</h1>
      <div class="stat-grid">
        <article><span>Streak</span><strong>${stats.currentStreak}</strong></article>
        <article><span>Best streak</span><strong>${stats.bestStreak}</strong></article>
        <article><span>Puzzles</span><strong>${stats.played}</strong></article>
        <article><span>Avg round</span><strong>${stats.played ? stats.average.toFixed(0) : "–"}</strong></article>
      </div>
      <h2>Round scores</h2>
      ${stats.played ? `<div class="histogram" aria-hidden="true">${bars}</div>` : `<p class="lede">Scores land here after you finish a daily mode.</p>`}
      <h2>Recent</h2>
      <ul class="recent">${recent}</ul>
      <p class="footnote">${esc(data.header.source)}. ${esc(data.header.sourceDetail)}</p>
    </section>
  `;
  bindChrome(root);
}

function renderUnlimited(root: HTMLElement, data: GameData, show: (next: () => (() => void) | void) => void): void {
  let split: SplitKind = "halves";
  const drawPicker = () => {
    root.innerHTML = `
      <section class="home">
        ${topBar("Home", "#/")}
        <p class="dateline">Unlimited</p>
        <h1>Deal a map.</h1>
        <p class="lede">Each map is a new place. Nothing here changes today's puzzle or your streak.</p>
        ${splitPicker(split)}
        <button class="lock wide" type="button" data-deal>Deal a map</button>
      </section>
    `;
    bindChrome(root);
    bindSplit(root, (next) => {
      split = next;
    });
    root.querySelector<HTMLButtonElement>("[data-deal]")!.onclick = () => {
      const first = deal(data, null);
      if (!first) return;
      let previous = first.id;
      show(() => startRounds(root, {
        split,
        rounds: [first],
        endless: true,
        date: null,
        practice: false,
        saved: null,
        nextRound: () => {
          const round = deal(data, previous);
          if (round) previous = round.id;
          return round;
        },
        onExit: () => go("#/"),
      }));
    };
  };
  drawPicker();
}

function renderCountry(root: HTMLElement, data: GameData, show: (next: () => (() => void) | void) => void): void {
  let split: SplitKind = "halves";
  const playable = data.countries.filter((country) => country.cells.length >= 2 && country.pop >= 20_000);
  const draw = () => {
    root.innerHTML = `
      <section class="home picker">
        ${topBar("Home", "#/")}
        <p class="dateline">Country</p>
        <h1>Choose a country.</h1>
        ${splitPicker(split)}
        <div class="search-row">
          <input type="search" placeholder="Search countries" aria-label="Search countries" data-search />
          <button class="ghost" type="button" data-random>Random</button>
        </div>
        <ul class="country-list" data-list></ul>
      </section>
    `;
    bindChrome(root);
    bindSplit(root, (next) => {
      split = next;
    });
    const list = root.querySelector<HTMLElement>("[data-list]")!;
    const input = root.querySelector<HTMLInputElement>("[data-search]")!;
    const fill = () => {
      const query = input.value.trim().toLowerCase();
      const matches = data.countries.filter((country) => {
        const hay = `${country.name} ${country.iso3} ${country.continent}`.toLowerCase();
        return hay.includes(query);
      });
      list.innerHTML = matches.length
        ? matches.map((country) => {
          const ok = country.cells.length >= 2 && country.pop >= 20_000;
          return `<li><button type="button" data-id="${esc(country.id)}" ${ok ? "" : "disabled"}><span>${esc(country.name)}</span><em>${esc(country.continent)}${ok ? "" : " · too few cities"}</em></button></li>`;
        }).join("")
        : `<li class="empty">No country matches that.</li>`;
      list.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((button) => {
        button.onclick = () => {
          const country = data.byId.get(button.dataset.id ?? "");
          if (country) startCountry(root, data, country, split, show);
        };
      });
    };
    input.oninput = fill;
    fill();
    root.querySelector<HTMLButtonElement>("[data-random]")!.onclick = () => {
      const country = playable[Math.floor(Math.random() * playable.length)];
      if (country) startCountry(root, data, country, split, show);
    };
  };
  draw();
}

function startCountry(root: HTMLElement, data: GameData, country: CountryShape, split: SplitKind, show: (next: () => (() => void) | void) => void): void {
  const round = materialize({
    id: `country-play-${country.id}`,
    name: country.name,
    detail: country.trimmed ? "Main landmass" : null,
    continent: country.continent,
    scale: "country",
    countryIds: [country.id],
    window: null,
  }, data.byId);
  if (!round) return;
  show(() => startRounds(root, {
    split,
    rounds: [round],
    endless: false,
    date: null,
    practice: false,
    saved: null,
    onExit: () => go("#/country"),
  }));
}

function startDaily(root: HTMLElement, data: GameData, kind: SplitKind): () => void {
  const date = localIsoDate();
  const mode = splitLabel(kind) as DailyMode;
  const saved = resultFor(date, mode);
  const picked = selectDaily(data.pool, mulberry32(hashString(`${date}|${mode}`)));
  const rounds = picked.map((item) => materialize(item, data.byId)).filter((round): round is Round => !!round);
  return startRounds(root, {
    split: kind,
    rounds,
    endless: false,
    date,
    practice: !!saved,
    saved,
    onExit: () => go("#/"),
    onFinish: (scores, regions) => recordResult(date, mode, scores, regions),
  });
}

function startRounds(root: HTMLElement, options: Parameters<typeof mountPlay>[1]): () => void {
  return mountPlay(root, options);
}

function deal(data: GameData, avoid: string | null): Round | null {
  for (let i = 0; i < 12; i++) {
    const item = randomPoolItem(data.pool);
    if (!item || item.id === avoid) continue;
    const round = materialize(item, data.byId);
    if (round) return round;
  }
  const fallback = data.pool[0];
  return fallback ? materialize(fallback, data.byId) : null;
}

function splitPicker(selected: SplitKind): string {
  const options: SplitKind[] = ["halves", "thirds", "quarters"];
  return `<div class="segment" role="radiogroup" aria-label="Split">${options.map((kind) =>
    `<button type="button" role="radio" data-split="${kind}" aria-checked="${kind === selected}">${splitLabel(kind)}</button>`,
  ).join("")}</div>`;
}

function bindSplit(root: HTMLElement, onChange: (kind: SplitKind) => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-split]").forEach((button) => {
    button.onclick = () => {
      const kind = button.dataset.split as SplitKind;
      onChange(kind);
      root.querySelectorAll<HTMLButtonElement>("[data-split]").forEach((other) => {
        other.setAttribute("aria-checked", other === button ? "true" : "false");
      });
    };
  });
}

function topBar(linkLabel: string, hash = "#/stats"): string {
  return `
    <header class="bar">
      <a class="brand" href="#/">Pop<span>Split</span></a>
      <nav>
        <a href="${hash}">${linkLabel}</a>
        <button type="button" data-theme>${themeLabel()}</button>
      </nav>
    </header>
  `;
}

function bindChrome(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-theme]")?.addEventListener("click", () => {
    toggleTheme();
    const button = root.querySelector<HTMLButtonElement>("[data-theme]");
    if (button) button.textContent = themeLabel();
  });
}

function renderLoading(root: HTMLElement, ratio: number, label: string): void {
  root.innerHTML = `
    <section class="gate">
      <p class="brand">Pop<span>Split</span></p>
      <h1>Counting people.</h1>
      <p>${esc(label)}</p>
      <div class="meter"><span style="width:${Math.round(ratio * 100)}%"></span></div>
    </section>
  `;
}

function go(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}
