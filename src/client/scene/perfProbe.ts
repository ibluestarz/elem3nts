import type { ClashKind, Engine, EngineElement, EngineQuality } from './engine.js';
import type { FlashResult, FrameStats, ProbeReport, QualityResult } from './perfReport.ts';
import './perfProbe.css';

/**
 * Sonde de temps d'image (PFC-021), **développement seulement** : chargée par `useSceneHost` quand
 * `import.meta.env.DEV` et `?perf` sont réunis, absente du build de production (branche morte éliminée).
 * Elle pilote le moteur réel, qualité par qualité, au repos puis pendant les chorégraphies, et mesure
 * l'intervalle entre deux images (`requestAnimationFrame`), grandeur que surveille le chien de garde (D33).
 * Résultats affichés dans un panneau (texte sélectionnable : le presse-papier exige un contexte sécurisé,
 * absent sur http://<ip-du-poste>) et exposés sur `window.__elem3ntsPerf` pour `scripts/measure-scene.ts`.
 */

const QUALITIES: readonly EngineQuality[] = ['low', 'medium', 'high'];

/** Chorégraphies mesurées : éléments révélés, effet et place gagnante. */
const CLASHES: readonly (readonly [EngineElement, EngineElement, ClashKind, 0 | 1])[] = [
  ['fire', 'plant', 'burn', 0],
  ['water', 'fire', 'wave', 0],
  ['plant', 'water', 'grow', 0],
  ['fire', 'fire', 'flare', 0],
  ['water', 'water', 'siphon', 0],
  ['plant', 'plant', 'thrive', 0],
];

const SETTLE_MS = 1000;
const IDLE_MS = 3000;
const CLASH_MS = 2600;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

/** Intervalles entre images pendant `ms` millisecondes. */
function sampleFrames(ms: number): Promise<number[]> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last: number | null = null;
    let start: number | null = null;
    const tick = (time: number) => {
      if (last !== null) intervals.push(time - last);
      last = time;
      start ??= time;
      if (time - start < ms) requestAnimationFrame(tick);
      else resolve(intervals);
    };
    requestAnimationFrame(tick);
  });
}

const percentile = (sorted: readonly number[], p: number) =>
  sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0);

function stats(intervals: readonly number[]): FrameStats {
  const sorted = [...intervals].sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    frames: sorted.length,
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

const GRID = 4;
const SAMPLE = 32;

const linear = (value: number) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

/** Luminance relative moyenne de chaque bloc de la grille, image courante du canvas (`preserveDrawingBuffer`). */
function blockLuminance(source: HTMLCanvasElement, context: CanvasRenderingContext2D): number[] {
  context.drawImage(source, 0, 0, SAMPLE, SAMPLE);
  const data = context.getImageData(0, 0, SAMPLE, SAMPLE).data;
  const blocks = new Array<number>(GRID * GRID).fill(0);
  const cell = SAMPLE / GRID;
  for (let y = 0; y < SAMPLE; y++) {
    for (let x = 0; x < SAMPLE; x++) {
      const index = (y * SAMPLE + x) * 4;
      const value = 0.2126 * linear(data[index] ?? 0) + 0.7152 * linear(data[index + 1] ?? 0) + 0.0722 * linear(data[index + 2] ?? 0);
      const block = Math.floor(y / cell) * GRID + Math.floor(x / cell);
      blocks[block] = (blocks[block] ?? 0) + value / (cell * cell);
    }
  }
  return blocks;
}

/** Horodatages des éclairs d'une série de luminances : paire de variations opposées ≥ 0,1, état sombre < 0,8. */
function flashTimes(series: readonly { readonly time: number; readonly value: number }[]): number[] {
  const flashes: number[] = [];
  let anchor = series[0];
  let direction = 0;
  for (const sample of series) {
    if (!anchor) break;
    const delta = sample.value - anchor.value;
    const darker = Math.min(sample.value, anchor.value);
    if (Math.abs(delta) >= 0.1 && darker < 0.8) {
      const next = Math.sign(delta);
      if (direction !== 0 && next !== direction) flashes.push(sample.time);
      direction = next;
      anchor = sample;
    } else if ((direction > 0 && sample.value > anchor.value) || (direction < 0 && sample.value < anchor.value)) {
      anchor = sample;
    }
  }
  return flashes;
}

async function measureFlashes(engine: Engine, canvas: HTMLCanvasElement, reduced: boolean): Promise<FlashResult> {
  const sampler = document.createElement('canvas');
  sampler.width = SAMPLE;
  sampler.height = SAMPLE;
  const context = sampler.getContext('2d', { willReadFrequently: true });
  if (!context) return { reduced, maxPerSecond: -1, maxStep: -1 };
  engine.setReduced(reduced);
  engine.setQuality('high');
  let maxPerSecond = 0;
  let maxStep = 0;
  for (const [p1, p2, kind, winner] of CLASHES) {
    engine.reset();
    await wait(SETTLE_MS);
    engine.reveal(p1, p2);
    engine.clash(kind, winner);
    const series: { time: number; blocks: number[] }[] = [];
    await new Promise<void>((resolve) => {
      let start: number | null = null;
      const tick = (time: number) => {
        start ??= time;
        series.push({ time, blocks: blockLuminance(canvas, context) });
        if (time - start < CLASH_MS + 1400) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    for (let block = 0; block < GRID * GRID; block++) {
      const values = series.map((sample) => ({ time: sample.time, value: sample.blocks[block] ?? 0 }));
      for (let index = 1; index < values.length; index++) {
        maxStep = Math.max(maxStep, Math.abs((values[index]?.value ?? 0) - (values[index - 1]?.value ?? 0)));
      }
      const times = flashTimes(values);
      for (const time of times) maxPerSecond = Math.max(maxPerSecond, times.filter((other) => other >= time && other < time + 1000).length);
    }
  }
  engine.reset();
  return { reduced, maxPerSecond, maxStep: Math.round(maxStep * 1000) / 1000 };
}

function rendererOf(canvas: HTMLCanvasElement): string {
  // Contexte existant du moteur : `getContext` rend le même, sans en créer un second.
  const gl = canvas.getContext('webgl2');
  if (!gl) return 'inconnu';
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

function table(report: ProbeReport): string {
  const row = (label: string, value: FrameStats) =>
    `${label.padEnd(14)} ${String(value.medianMs).padStart(7)} ${String(value.p95Ms).padStart(7)} ${String(value.maxMs).padStart(7)} ${String(value.frames).padStart(6)}`;
  return [
    `GPU : ${report.renderer}`,
    `Navigateur : ${report.userAgent}`,
    `Fenêtre : ${report.viewport} @${String(report.devicePixelRatio)}x`,
    '',
    `${'mesure'.padEnd(14)} ${'médiane'.padStart(7)} ${'p95'.padStart(7)} ${'max'.padStart(7)} ${'images'.padStart(6)}  (ms entre deux images)`,
    ...report.results.flatMap((result) => [row(`${result.quality} repos`, result.idle), row(`${result.quality} effets`, result.clash)]),
    ...report.flashes.map(
      (flash) =>
        `Éclairs (${flash.reduced ? 'mouvements réduits' : 'animations complètes'}) : ${String(flash.maxPerSecond)} par seconde au plus, variation max ${String(flash.maxStep)}`,
    ),
    report.status === 'running' ? '\nMesure en cours… ne touchez à rien.' : '\nTerminé.',
  ].join('\n');
}

function panel(): (report: ProbeReport) => void {
  const root = document.createElement('section');
  root.className = 'perf-probe';
  root.setAttribute('aria-label', 'Mesure du temps d’image');
  const output = document.createElement('textarea');
  output.className = 'perf-probe__output';
  output.readOnly = true;
  output.setAttribute('aria-label', 'Résultats');
  root.append(output);
  document.body.append(root);
  return (report) => {
    output.value = table(report);
  };
}

/** Lance la mesure complète sur le moteur donné ; le jeu n'est pas utilisé pendant la mesure. */
export async function runProbe(engine: Engine, canvas: HTMLCanvasElement): Promise<ProbeReport> {
  const show = panel();
  const results: QualityResult[] = [];
  const flashes: FlashResult[] = [];
  const base = {
    renderer: rendererOf(canvas),
    userAgent: navigator.userAgent,
    viewport: `${String(window.innerWidth)}×${String(window.innerHeight)}`,
    devicePixelRatio: window.devicePixelRatio,
  };
  const publish = (status: ProbeReport['status']) => {
    const report: ProbeReport = { status, ...base, results: [...results], flashes: [...flashes] };
    window.__elem3ntsPerf = report;
    show(report);
    return report;
  };
  publish('running');

  engine.setReduced(false);
  for (const quality of QUALITIES) {
    engine.setQuality(quality);
    engine.reset();
    engine.setScene('arena');
    await wait(SETTLE_MS);
    const idle = await sampleFrames(IDLE_MS);
    const clash: number[] = [];
    for (const [p1, p2, kind, winner] of CLASHES) {
      engine.reset();
      engine.reveal(p1, p2);
      engine.clash(kind, winner);
      clash.push(...(await sampleFrames(CLASH_MS)));
    }
    engine.reset();
    results.push({ quality, idle: stats(idle), clash: stats(clash) });
    publish('running');
  }
  for (const reduced of [false, true]) {
    flashes.push(await measureFlashes(engine, canvas, reduced));
    publish('running');
  }
  return publish('done');
}
