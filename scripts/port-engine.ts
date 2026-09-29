/**
 * Porte le moteur 3D de la maquette (elem3nts-design/elem3nts-engine.js) dans l'application
 * (src/client/scene/engine.js), à l'identique sauf les correctifs listés ci-dessous (D33).
 * Chaque correctif doit s'appliquer exactement une fois : sinon la maquette a changé et le
 * portage échoue plutôt que de produire un moteur incohérent.
 *
 * Usage : npm run port:engine — `tests/tooling/engine-port.test.ts` vérifie que le fichier porté
 * correspond toujours à cette sortie.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface EnginePatch {
  readonly why: string;
  readonly from: string;
  readonly to: string;
}

export const ENGINE_PATCHES: readonly EnginePatch[] = [
  {
    why: 'Three.js depuis le paquet npm exact (three@0.160.0), jamais depuis un CDN',
    from: "import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';",
    to: "import * as THREE from 'three';",
  },
  {
    why: 'Module ES : classe exportée au lieu d’un global',
    from: 'class Engine{\n',
    to: 'export class Engine{\n',
  },
  {
    why: 'Suppression du global de débogage window.__e3',
    from: 'constructor(canvas){window.__e3=this;this.c=canvas;',
    to: 'constructor(canvas){this.c=canvas;',
  },
  {
    why: 'Perte de contexte WebGL signalée (repli DOM) ; rendu suspendu onglet masqué (ARCHITECTURE)',
    from: 'this._iv=setInterval(()=>{if(performance.now()-this.lastStep>150)this.step()},60)}',
    to: "this._iv=setInterval(()=>{if(!document.hidden&&performance.now()-this.lastStep>150)this.step()},60);this._lost=e=>{e.preventDefault();this.lost=true;this.onContextLost&&this.onContextLost()};canvas.addEventListener('webglcontextlost',this._lost)}",
  },
  {
    why: 'Libération complète des ressources GPU (géométries, matériaux, textures, contexte) au démontage',
    from: "destroy(){clearInterval(this._iv);cancelAnimationFrame(this.raf);this.ro.disconnect();window.removeEventListener('pointermove',this._pm);this.renderer.dispose()}",
    to: "destroy(){clearInterval(this._iv);cancelAnimationFrame(this.raf);this.ro.disconnect();window.removeEventListener('pointermove',this._pm);this.c.removeEventListener('webglcontextlost',this._lost);const seen=new Set(),drop=x=>{if(x&&typeof x.dispose==='function'&&!seen.has(x)){seen.add(x);x.dispose()}};this.scene.traverse(o=>{drop(o.geometry);[].concat(o.material||[]).forEach(m=>{if(!m)return;Object.values(m).forEach(v=>{if(v&&v.isTexture)drop(v)});if(m.uniforms)Object.values(m.uniforms).forEach(u=>{if(u&&u.value&&u.value.isTexture)drop(u.value)});drop(m)})});[this.env,this.stone,this.soft].forEach(drop);this.scene.clear();this.renderer.dispose();this.renderer.forceContextLoss()}",
  },
  {
    why: 'Aucune image calculée onglet masqué ni après perte de contexte',
    from: 'loop(){this.raf=requestAnimationFrame(this._loop);this.step()}',
    to: 'loop(){this.raf=requestAnimationFrame(this._loop);if(!document.hidden&&!this.lost)this.step()}',
  },
  {
    why: 'Pas d’enregistrement global : l’application importe le module',
    from: "\nwindow.Elem3ntsEngine=Engine;window.dispatchEvent(new Event('elem3nts-engine'));",
    to: '',
  },
];

const HEADER = `/*
 * Moteur 3D de la maquette elem3nts-design/elem3nts-engine.js, porté par scripts/port-engine.ts (D33).
 * Code tiers de référence visuelle : ne pas modifier à la main, relancer \`npm run port:engine\`.
 * Correctifs appliqués :
${ENGINE_PATCHES.map((patch) => ` * - ${patch.why}`).join('\n')}
 */
`;

export function portEngine(source: string): string {
  let result = source;
  for (const patch of ENGINE_PATCHES) {
    const count = result.split(patch.from).length - 1;
    if (count !== 1) throw new Error(`Correctif « ${patch.why} » : ${String(count)} occurrence(s), 1 attendue.`);
    result = result.replace(patch.from, patch.to);
  }
  return HEADER + result;
}

export const ENGINE_SOURCE = fileURLToPath(new URL('../elem3nts-design/elem3nts-engine.js', import.meta.url));
export const ENGINE_TARGET = fileURLToPath(new URL('../src/client/scene/engine.js', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(ENGINE_TARGET, portEngine(await readFile(ENGINE_SOURCE, 'utf8')));
  console.log(`Moteur porté : ${ENGINE_TARGET}`);
}
