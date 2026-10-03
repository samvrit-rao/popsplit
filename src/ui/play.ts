import { evaluate, idealCaption, idealCut } from "../game/evaluate.ts";
import { esc, formatPct, formatPop, formatPopShort, roundTitle, scaleLabel, shareText, splitLabel } from "../game/format.ts";
import type { Round, SplitKind } from "../game/types.ts";
import { PIECE_COLORS, mountMap } from "./mapView.ts";
import type { ModeResult } from "./statsStore.ts";
import { toggleTheme } from "./theme.ts";

type Options = {
  split: SplitKind;
  rounds: Round[];
  endless: boolean;
  /** Home-mode name shown in the round header, such as States. */
  lead?: string;
  date: string | null;
  practice: boolean;
  saved: ModeResult | null;
  nextRound?: () => Round | null;
  onExit: () => void;
  onFinish?: (scores: number[], regions: string[]) => void;
};

export function mountPlay(root: HTMLElement, options: Options): () => void {
  const scores: number[] = [];
  const names: string[] = [];
  let index = 0;
  let finished = false;
  let map: ReturnType<typeof mountMap> | null = null;
  let showing = false;

  root.innerHTML = `
    <section class="play">
      <header class="play-bar">
        <button class="icon-btn" type="button" data-exit aria-label="Back">←</button>
        <div class="play-copy">
          <p class="kicker" data-kicker></p>
          <h1 data-title></h1>
        </div>
        <div class="play-tools">
          <p class="pop-pill" data-pop></p>
          <button class="icon-btn" type="button" data-theme aria-label="Toggle color theme">◐</button>
        </div>
      </header>
      <div class="stage" data-stage></div>
      <div class="dock">
        <p data-hint></p>
        <button class="lock" type="button" data-lock>Lock in</button>
      </div>
      <div class="sheet" data-sheet></div>
    </section>
  `;

  const kicker = root.querySelector<HTMLElement>("[data-kicker]")!;
  const title = root.querySelector<HTMLElement>("[data-title]")!;
  const pop = root.querySelector<HTMLElement>("[data-pop]")!;
  const hint = root.querySelector<HTMLElement>("[data-hint]")!;
  const stage = root.querySelector<HTMLElement>("[data-stage]")!;
  const sheet = root.querySelector<HTMLElement>("[data-sheet]")!;
  const lock = root.querySelector<HTMLButtonElement>("[data-lock]")!;
  const dock = root.querySelector<HTMLElement>(".dock")!;

  const hints: Record<SplitKind, string> = {
    halves: "Drag either end or the line. The frame is the region you split. No percentages until you lock in.",
    thirds: "Move the hub, then swing each spoke. The frame is the region you split. No percentages until you lock in.",
    quarters: "Drag the hub, then turn the cross. The arms stay perpendicular. The frame is the region you split. No percentages until you lock in.",
  };

  const renderRound = () => {
    const round = options.rounds[index];
    if (!round) return;
    showing = false;
    sheet.classList.remove("open");
    sheet.innerHTML = "";
    dock.classList.remove("away");
    lock.disabled = false;
    map?.destroy();
    const total = options.endless ? null : options.rounds.length;
    const soFar = scores.reduce((sum, score) => sum + score, 0);
    kicker.textContent = [
      options.date ? splitLabel(options.split) : options.endless ? "Unlimited" : (options.lead ?? "Country"),
      total ? `Round ${index + 1} of ${total}` : splitLabel(options.split),
      scaleLabel(round.scale),
      scores.length ? `${soFar} so far` : "",
    ].filter(Boolean).join(" · ");
    title.textContent = roundTitle(round.name, round.detail);
    pop.textContent = formatPopShort(round.cells.reduce((sum, cell) => sum + cell.pop, 0));
    hint.textContent = hints[options.split];
    map = mountMap(stage, round, options.split, () => {
      if (showing) reveal(false);
    });
  };

  const reveal = (fresh: boolean) => {
    if (!map) return;
    const round = options.rounds[index];
    if (!round) return;
    const snapshot = map.getSnapshot();
    if (snapshot.cells.length === 0 || snapshot.width < 20) return;
    const result = evaluate(snapshot.cells, snapshot.cut);
    const ideal = idealCut(snapshot.cells, snapshot.cut, snapshot.width, snapshot.height);
    const idealResult = evaluate(snapshot.cells, ideal);
    map.showResult(result.pieceOf, ideal);
    if (fresh) {
      scores[index] = result.score;
      names[index] = roundTitle(round.name, round.detail);
    }
    showing = true;
    dock.classList.add("away");
    const last = !options.endless && index === options.rounds.length - 1;
    const nextLabel = options.endless ? "New map" : last ? (options.rounds.length > 1 ? "See total" : "Done") : "Next round";
    const rows = result.labels.map((label, piece) => `
      <li>
        <span class="swatch" style="background:${PIECE_COLORS[piece]}"></span>
        <span>${esc(label)}</span>
        <strong>${formatPct(result.shares[piece] ?? 0)}</strong>
        <em>${formatPop(result.pops[piece] ?? 0)}</em>
      </li>
    `).join("");
    sheet.innerHTML = `
      <div class="sheet-card">
        <div class="score-row">
          <p class="score ${result.score >= 90 ? "great" : result.score >= 60 ? "ok" : "low"}">${result.score}</p>
          <div>
            <p class="kicker">Round score</p>
            <p>${esc(roundTitle(round.name, round.detail))}</p>
          </div>
        </div>
        <ul class="pieces">${rows}</ul>
        <p class="ideal-note">${esc(idealCaption(options.split))} That line would score ${idealResult.score}.</p>
        <div class="sheet-actions">
          <button type="button" class="lock" data-next>${nextLabel}</button>
          <button type="button" class="ghost" data-save>Save map</button>
        </div>
      </div>
    `;
    sheet.classList.add("open");
    sheet.querySelector<HTMLButtonElement>("[data-next]")!.onclick = () => advance();
    sheet.querySelector<HTMLButtonElement>("[data-save]")!.onclick = () => {
      map?.exportPng(`${roundTitle(round.name, round.detail)} · ${splitLabel(options.split)}`, result.score);
    };
  };

  const advance = () => {
    if (options.endless) {
      const extra = options.nextRound?.();
      if (!extra) return;
      options.rounds.push(extra);
      index += 1;
      renderRound();
      return;
    }
    if (index < options.rounds.length - 1) {
      index += 1;
      renderRound();
      return;
    }
    finished = true;
    if (options.onFinish) options.onFinish(scores.slice(), names.slice());
    showSummary();
  };

  const showSummary = () => {
    map?.destroy();
    map = null;
    const total = scores.reduce((sum, score) => sum + score, 0);
    const mode = splitLabel(options.split);
    const official = options.practice && options.saved ? options.saved.scores : scores;
    const text = shareText(options.date ?? new Date().toISOString().slice(0, 10), mode, official);
    root.innerHTML = `
      <section class="summary">
        <p class="kicker">${esc(mode)}${options.date ? ` · ${esc(options.date)}` : ""}</p>
        <h1>${total}<span> / ${scores.length * 100}</span></h1>
        ${options.practice && options.saved ? `<p class="practice">Practice round. Today's saved total stays ${options.saved.total}.</p>` : ""}
        <ol class="summary-list">
          ${scores.map((score, i) => `<li><span>${esc(names[i] ?? "Round")}</span><strong>${score}</strong></li>`).join("")}
        </ol>
        <pre class="share-preview">${esc(text)}</pre>
        <div class="sheet-actions">
          <button type="button" class="lock" data-share>${options.practice ? "Copy saved result" : "Copy result"}</button>
          <button type="button" class="ghost" data-home>Home</button>
        </div>
        <p class="copy-note" data-note></p>
      </section>
    `;
    const note = root.querySelector<HTMLElement>("[data-note]")!;
    root.querySelector<HTMLButtonElement>("[data-share]")!.onclick = async () => {
      const ok = await copyText(text);
      note.textContent = ok ? "Copied." : text;
    };
    root.querySelector<HTMLButtonElement>("[data-home]")!.onclick = () => options.onExit();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") options.onExit();
    if ((event.key === "Enter" || event.key === "l" || event.key === "L") && !showing && !finished) reveal(true);
  };

  lock.onclick = () => reveal(true);
  root.querySelector<HTMLButtonElement>("[data-exit]")!.onclick = () => options.onExit();
  root.querySelector<HTMLButtonElement>("[data-theme]")!.onclick = () => toggleTheme();
  window.addEventListener("keydown", onKey);
  renderRound();

  return () => {
    map?.destroy();
    window.removeEventListener("keydown", onKey);
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
