import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initialCut, toPixels } from "../game/evaluate.ts";
import { frameOfFit, osmViewFor } from "../game/mapFrame.ts";
import type { Cut, HalvesCut, Round, ScreenCell, SplitKind, ThirdsCut } from "../game/types.ts";

export const PIECE_COLORS = ["#e4533a", "#1f8a7a", "#d89a09", "#6d63d6"];

export type MapSnapshot = {
  cells: ScreenCell[];
  cut: Cut;
  width: number;
  height: number;
};

type Drag =
  | { kind: "point"; key: "a" | "b" | "center" }
  | { kind: "line"; ax: number; ay: number; bx: number; by: number; x: number; y: number }
  | { kind: "spoke"; index: number }
  | { kind: "rotate"; opposite: boolean };

export function mountMap(
  stage: HTMLElement,
  round: Round,
  split: SplitKind,
  onResize: () => void,
): { getSnapshot: () => MapSnapshot; showResult: (pieceOf: number[] | null, ideal: Cut | null) => void; exportPng: (title: string, score: number) => void; destroy: () => void } {
  stage.replaceChildren();
  const host = document.createElement("div");
  host.className = "basemap";
  const canvas = document.createElement("canvas");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("overlay");
  const credit = document.createElement("p");
  credit.className = "map-credit";
  credit.innerHTML = `<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>`;
  stage.append(host, canvas, svg, credit);

  const map = L.map(host, {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    fadeAnimation: false,
    zoomAnimation: false,
  });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    crossOrigin: "anonymous",
  }).addTo(map);
  const frame = frameOfFit(round.fit, round.cells, round.draw);

  let cut = initialCut(split);
  let ideal: Cut | null = null;
  let locked = false;
  let width = 0;
  let height = 0;
  let drag: Drag | null = null;

  const redraw = () => {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (width < 20 || height < 20) return;
    map.invalidateSize(false);
    const view = osmViewFor(frame, width, height);
    map.setView([view.lat, view.lon], view.zoom, { animate: false });
    paintCanvas();
    paintSvg();
  };

  const frameRect = () => {
    const east = frame.wraps ? frame.east + 360 : frame.east;
    const corners = [
      map.latLngToContainerPoint([frame.south, frame.west]),
      map.latLngToContainerPoint([frame.south, east]),
      map.latLngToContainerPoint([frame.north, frame.west]),
      map.latLngToContainerPoint([frame.north, east]),
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };

  const paintCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const box = frameRect();
    if (box.w > 2 && box.h > 2) {
      ctx.strokeStyle = "rgba(255,252,246,0.95)";
      ctx.lineWidth = 7;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = "#16324a";
      ctx.lineWidth = 2.75;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }
  };

  const paintSvg = () => {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const pixel = toPixels(cut, width, height);
    const lines = cutLines(pixel, width, height);
    const idealLines = ideal ? cutLines(ideal, width, height) : [];
    const handles = locked ? [] : handleMarks(pixel, width, height);
    svg.innerHTML = `${lines
      .map(
        (line) =>
          `<line x1="${line[0]}" y1="${line[1]}" x2="${line[2]}" y2="${line[3]}" stroke="var(--ink)" stroke-width="7" stroke-linecap="round" opacity="0.28"/>
           <line x1="${line[0]}" y1="${line[1]}" x2="${line[2]}" y2="${line[3]}" stroke="var(--card)" stroke-width="3" stroke-linecap="round"/>`,
      )
      .join("")}
      ${idealLines
        .map(
          (line) =>
            `<line x1="${line[0]}" y1="${line[1]}" x2="${line[2]}" y2="${line[3]}" stroke="var(--ideal)" stroke-width="3" stroke-dasharray="8 7" stroke-linecap="round"/>`,
        )
        .join("")}
      ${handles
        .map(
          (handle) =>
            `<circle cx="${handle.x}" cy="${handle.y}" r="${handle.key === "center" ? 15 : 12}" fill="var(--card)" stroke="var(--ink)" stroke-width="2.5"/>`,
        )
        .join("")}`;
  };

  const projectCells = (): ScreenCell[] => {
    const cells: ScreenCell[] = [];
    for (const cell of round.cells) {
      const point = map.latLngToContainerPoint([cell.lat, cell.lon]);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      cells.push({ x: point.x, y: point.y, pop: cell.pop });
    }
    return cells;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (locked || width < 20) return;
    const point = local(event);
    const hit = hitTest(point.x, point.y);
    if (!hit) return;
    drag = hit;
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || locked) return;
    const point = local(event);
    applyDrag(point.x, point.y);
    paintSvg();
  };

  const onPointerUp = (event: PointerEvent) => {
    drag = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };

  const applyDrag = (x: number, y: number) => {
    if (!drag) return;
    if (cut.kind === "halves" && drag.kind === "point") {
      if (drag.key === "a") {
        cut = { ...cut, ax: x / width, ay: y / height };
      } else {
        cut = { ...cut, bx: x / width, by: y / height };
      }
      const halves = cut as HalvesCut;
      if (Math.hypot(halves.bx - halves.ax, halves.by - halves.ay) < 0.05) {
        cut = { ...halves, bx: halves.ax + 0.08, by: halves.ay };
      }
    } else if (cut.kind === "halves" && drag.kind === "line") {
      cut = {
        kind: "halves",
        ax: drag.ax + (x - drag.x) / width,
        ay: drag.ay + (y - drag.y) / height,
        bx: drag.bx + (x - drag.x) / width,
        by: drag.by + (y - drag.y) / height,
      };
    } else if ((cut.kind === "thirds" || cut.kind === "quarters") && drag.kind === "point") {
      cut = { ...cut, cx: clamp(x / width, 0.08, 0.92), cy: clamp(y / height, 0.08, 0.92) };
    } else if (cut.kind === "thirds" && drag.kind === "spoke") {
      const angles = [...cut.angles] as [number, number, number];
      const next = Math.atan2(y - cut.cy * height, x - cut.cx * width);
      angles[drag.index] = clampSpoke(angles, drag.index, next);
      cut = { ...cut, angles };
    } else if (cut.kind === "quarters" && drag.kind === "rotate") {
      let angle = Math.atan2(y - cut.cy * height, x - cut.cx * width);
      if (drag.opposite) angle -= Math.PI;
      cut = { ...cut, angle };
    }
  };

  const hitTest = (x: number, y: number): Drag | null => {
    const pixel = toPixels(cut, width, height);
    const handles = handleMarks(pixel, width, height);
    const handle = handles.find((item) => Math.hypot(item.x - x, item.y - y) <= 28);
    if (handle?.key === "a" || handle?.key === "b" || handle?.key === "center") return { kind: "point", key: handle.key };
    if (handle?.key.startsWith("spoke-")) return { kind: "spoke", index: Number(handle.key.slice(6)) };
    if (handle?.key === "rot-a") return { kind: "rotate", opposite: false };
    if (handle?.key === "rot-b") return { kind: "rotate", opposite: true };
    if (cut.kind === "halves") {
      const segment = cutLines(pixel, width, height)[0];
      if (segment && distanceToSegment(x, y, segment) <= 18) {
        const halves = cut as HalvesCut;
        return { kind: "line", ax: halves.ax, ay: halves.ay, bx: halves.bx, by: halves.by, x, y };
      }
    }
    return null;
  };

  const local = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const observer = new ResizeObserver(() => {
    redraw();
    if (locked) onResize();
  });
  observer.observe(stage);
  const onTheme = () => redraw();
  window.addEventListener("popsplit-theme", onTheme);
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  redraw();

  return {
    getSnapshot: () => ({ cells: projectCells(), cut: toPixels(cut, width, height), width, height }),
    showResult: (nextPieces, nextIdeal) => {
      ideal = nextIdeal;
      locked = nextPieces != null;
      paintCanvas();
      paintSvg();
    },
    exportPng: (title, score) => {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) return;
      const dpr = canvas.width / Math.max(1, width);
      ctx.fillStyle = "#aad3df";
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      paintTiles(ctx, host, dpr);
      ctx.drawImage(canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pixel = toPixels(cut, width, height);
      strokeLines(ctx, cutLines(pixel, width, height), "#17241e", 4);
      if (ideal) strokeLines(ctx, cutLines(ideal, width, height), "#0f8f4e", 3, [8, 7]);
      ctx.fillStyle = "rgba(23, 36, 30, 0.88)";
      ctx.fillRect(0, height - 54, width, 54);
      ctx.fillStyle = "#f7f4ec";
      ctx.font = "600 18px Fraunces, Georgia, serif";
      ctx.fillText(title, 16, height - 30);
      ctx.font = "500 12px Outfit, sans-serif";
      ctx.fillText("© OpenStreetMap", 16, height - 12);
      ctx.font = "500 16px Outfit, sans-serif";
      ctx.fillText(String(score), width - 56, height - 30);
      exportCanvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "popsplit-round.png";
        link.click();
        URL.revokeObjectURL(url);
      });
    },
    destroy: () => {
      observer.disconnect();
      window.removeEventListener("popsplit-theme", onTheme);
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      map.remove();
    },
  };
}

function paintTiles(ctx: CanvasRenderingContext2D, host: HTMLElement, dpr: number) {
  const origin = host.getBoundingClientRect();
  const tiles = host.querySelectorAll<HTMLImageElement>("img.leaflet-tile");
  for (const img of tiles) {
    if (!img.complete || img.naturalWidth === 0) continue;
    const rect = img.getBoundingClientRect();
    try {
      ctx.drawImage(
        img,
        (rect.left - origin.left) * dpr,
        (rect.top - origin.top) * dpr,
        rect.width * dpr,
        rect.height * dpr,
      );
    } catch {
      /* a tile that is not readable yet is skipped */
    }
  }
}

function handleMarks(cut: Cut, width: number, height: number): Array<{ x: number; y: number; key: string }> {
  if (cut.kind === "halves") {
    return [
      { x: cut.ax, y: cut.ay, key: "a" },
      { x: cut.bx, y: cut.by, key: "b" },
    ];
  }
  const marks = [{ x: cut.cx, y: cut.cy, key: "center" }];
  if (cut.kind === "thirds") {
    cut.angles.forEach((angle, index) => {
      const point = pointAlong(cut.cx, cut.cy, angle, width, height);
      marks.push({ x: point[0], y: point[1], key: `spoke-${index}` });
    });
  } else {
    const a = pointAlong(cut.cx, cut.cy, cut.angle, width, height);
    const b = pointAlong(cut.cx, cut.cy, cut.angle + Math.PI, width, height);
    marks.push({ x: a[0], y: a[1], key: "rot-a" }, { x: b[0], y: b[1], key: "rot-b" });
  }
  return marks;
}

function pointAlong(cx: number, cy: number, angle: number, width: number, height: number): [number, number] {
  const end = rayEnd(cx, cy, angle, width, height);
  const dist = Math.hypot(end[0] - cx, end[1] - cy);
  const reach = Math.min(Math.max(78, dist * 0.58), Math.max(36, dist - 18));
  return [cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach];
}

function cutLines(cut: Cut, width: number, height: number): number[][] {
  if (cut.kind === "halves") {
    const line = clipInfinite(cut.ax, cut.ay, cut.bx, cut.by, width, height);
    return line ? [line] : [];
  }
  if (cut.kind === "thirds") return spokes(cut, width, height);
  return [
    clipInfinite(cut.cx, cut.cy, cut.cx + Math.cos(cut.angle), cut.cy + Math.sin(cut.angle), width, height),
    clipInfinite(cut.cx, cut.cy, cut.cx + Math.cos(cut.angle + Math.PI / 2), cut.cy + Math.sin(cut.angle + Math.PI / 2), width, height),
  ].filter((line): line is number[] => !!line);
}

function spokes(cut: ThirdsCut, width: number, height: number): number[][] {
  return cut.angles
    .map((angle) => {
      const end = rayEnd(cut.cx, cut.cy, angle, width, height);
      return [cut.cx, cut.cy, end[0], end[1]];
    });
}

function rayEnd(cx: number, cy: number, angle: number, width: number, height: number): [number, number] {
  const line = liangBarsky(cx, cy, cx + Math.cos(angle) * 8000, cy + Math.sin(angle) * 8000, 0, 0, width, height);
  return line ? [line[2], line[3]] : [cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 80];
}

function clipInfinite(x1: number, y1: number, x2: number, y2: number, width: number, height: number): number[] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return liangBarsky(x1 - (dx / len) * 8000, y1 - (dy / len) * 8000, x1 + (dx / len) * 8000, y1 + (dy / len) * 8000, 0, 0, width, height);
}

function liangBarsky(x1: number, y1: number, x2: number, y2: number, xmin: number, ymin: number, xmax: number, ymax: number): number[] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
  let u1 = 0;
  let u2 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i] ?? 0;
    const qi = q[i] ?? 0;
    if (pi === 0) {
      if (qi < 0) return null;
    } else {
      const t = qi / pi;
      if (pi < 0) u1 = Math.max(u1, t);
      else u2 = Math.min(u2, t);
      if (u1 > u2) return null;
    }
  }
  return [x1 + u1 * dx, y1 + u1 * dy, x1 + u2 * dx, y1 + u2 * dy];
}

function distanceToSegment(x: number, y: number, line: number[]): number {
  const x1 = line[0] ?? 0;
  const y1 = line[1] ?? 0;
  const x2 = line[2] ?? 0;
  const y2 = line[3] ?? 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function clampSpoke(angles: [number, number, number], index: number, next: number): number {
  const tau = Math.PI * 2;
  const norm = (angle: number) => {
    const value = angle % tau;
    return value < 0 ? value + tau : value;
  };
  const others = angles.filter((_, i) => i !== index).map(norm).sort((a, b) => a - b);
  const current = norm(angles[index] ?? 0);
  const left = others[0] ?? 0;
  const right = others[1] ?? tau;
  const margin = 0.16;
  const target = norm(next);
  if (current >= left && current <= right) {
    return Math.min(right - margin, Math.max(left + margin, target));
  }
  let wrapped = target < right ? target + tau : target;
  wrapped = Math.min(left + tau - margin, Math.max(right + margin, wrapped));
  return wrapped;
}

function strokeLines(ctx: CanvasRenderingContext2D, lines: number[][], color: string, width: number, dash: number[] = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  for (const line of lines) {
    ctx.beginPath();
    ctx.moveTo(line[0] ?? 0, line[1] ?? 0);
    ctx.lineTo(line[2] ?? 0, line[3] ?? 0);
    ctx.stroke();
  }
  ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
