import * as THREE from 'three';

/**
 * Procedural texture factory. Everything is drawn to <canvas> so the app ships
 * with zero binary assets yet still has cork grain, paper fibre, mugshots,
 * documents, newspaper columns, fingerprint ridges and map linework.
 *
 * Textures are memoised — a document card and a photo share one paper base.
 */

const cache = new Map<string, THREE.Texture>();

function makeCanvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function rand(seed: number) {
  // deterministic-ish PRNG for reproducible grain
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function corkTexture(): THREE.Texture {
  if (cache.has('cork')) return cache.get('cork')!;
  const c = makeCanvas(1024);
  const ctx = c.getContext('2d')!;
  const rnd = rand(9137);
  // base
  const g = ctx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#c9a468');
  g.addColorStop(0.5, '#bd9354');
  g.addColorStop(1, '#a97f46');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  // cork granules
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * 1024;
    const y = rnd() * 1024;
    const r = 1 + rnd() * 4;
    const shade = rnd();
    ctx.fillStyle =
      shade < 0.5
        ? `rgba(90,60,30,${0.05 + rnd() * 0.25})`
        : `rgba(220,190,140,${0.04 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // darker blotches
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 1024;
    const y = rnd() * 1024;
    const r = 30 + rnd() * 90;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(70,45,20,${0.08 + rnd() * 0.1})`);
    rg.addColorStop(1, 'rgba(70,45,20,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = toTexture(c, 2);
  cache.set('cork', tex);
  return tex;
}

export function corkRoughness(): THREE.Texture {
  if (cache.has('corkR')) return cache.get('corkR')!;
  const c = makeCanvas(512);
  const ctx = c.getContext('2d')!;
  const rnd = rand(551);
  ctx.fillStyle = '#b0b0b0';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 12000; i++) {
    const v = Math.floor(120 + rnd() * 120);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  cache.set('corkR', tex);
  return tex;
}

function paperBase(ctx: CanvasRenderingContext2D, size: number, tint: string, seed: number) {
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);
  const rnd = rand(seed);
  // fibre speckle
  for (let i = 0; i < 9000; i++) {
    const a = 0.02 + rnd() * 0.05;
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1 + rnd() * 2);
  }
  // subtle vignette / aging at edges
  const rg = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.72);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(120,90,50,0.16)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, size, size);
}

export function stickyTexture(color: string, text: string, seed: number): THREE.Texture {
  const key = `sticky_${color}_${text}_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  paperBase(ctx, size, color, seed);
  // faint gradient sheen
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // handwriting
  ctx.fillStyle = 'rgba(30,30,40,0.9)';
  ctx.font = '600 62px Caveat, cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  const lh = 78;
  lines.forEach((ln, i) => {
    ctx.save();
    ctx.translate(size / 2, size / 2 + (i - (lines.length - 1) / 2) * lh);
    ctx.rotate((Math.random() - 0.5) * 0.03);
    ctx.fillText(ln, 0, 0);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

export function documentTexture(title: string, body: string, seed: number): THREE.Texture {
  const key = `doc_${title}_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const w = 512;
  const h = 680;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  paperBase(ctx, Math.max(w, h), '#f3ecdd', seed);
  ctx.fillStyle = '#f3ecdd';
  ctx.fillRect(0, 0, w, h);
  paperBase(ctx, w, '#f3ecdd', seed);
  // header stamp
  ctx.strokeStyle = 'rgba(160,30,30,0.6)';
  ctx.lineWidth = 4;
  ctx.save();
  ctx.translate(w - 120, 70);
  ctx.rotate(-0.2);
  ctx.strokeRect(-70, -26, 150, 52);
  ctx.fillStyle = 'rgba(160,30,30,0.7)';
  ctx.font = '700 26px "Courier Prime", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CASE', 5, 6);
  ctx.restore();
  // title
  ctx.fillStyle = '#2a2118';
  ctx.font = '700 34px "Courier Prime", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(title.slice(0, 20), 40, 70);
  // body lines
  ctx.font = '18px "Courier Prime", monospace';
  ctx.fillStyle = 'rgba(40,33,24,0.85)';
  const words = (body + ' lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud').split(' ');
  let line = '';
  let y = 120;
  for (const wd of words) {
    if ((line + wd).length > 42) {
      ctx.fillText(line, 40, y);
      line = '';
      y += 30;
      if (y > h - 60) break;
    }
    line += wd + ' ';
  }
  if (y <= h - 60) ctx.fillText(line, 40, y);
  // redaction bars
  const rnd = rand(seed + 7);
  ctx.fillStyle = 'rgba(20,20,20,0.9)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(40 + rnd() * 60, 150 + rnd() * 400, 120 + rnd() * 180, 22);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

export function suspectTexture(title: string, body: string, seed: number): THREE.Texture {
  const key = `suspect_${title}_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const w = 512;
  const h = 650;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(0, 0, w, h);
  paperBase(ctx, w, '#e9e4d8', seed);
  // mugshot backdrop
  ctx.fillStyle = '#8a8f8b';
  ctx.fillRect(40, 40, w - 80, 360);
  // height chart lines
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.font = '14px "Courier Prime", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < 7; i++) {
    const yy = 70 + i * 48;
    ctx.beginPath();
    ctx.moveTo(50, yy);
    ctx.lineTo(w - 50, yy);
    ctx.stroke();
    ctx.fillText(`${6 - i}'`, 52, yy - 4);
  }
  // silhouette head + shoulders
  const cx = w / 2;
  ctx.fillStyle = 'rgba(30,32,34,0.85)';
  ctx.beginPath();
  ctx.ellipse(cx, 230, 78, 96, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 150, 400);
  ctx.quadraticCurveTo(cx, 300, cx + 150, 400);
  ctx.lineTo(cx + 150, 400);
  ctx.lineTo(cx - 150, 400);
  ctx.fill();
  // name plate
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(40, 420, w - 80, 60);
  ctx.fillStyle = '#f0e9d8';
  ctx.font = '700 40px "Special Elite", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(title.slice(0, 16), cx, 462);
  // details
  ctx.fillStyle = '#2a2118';
  ctx.font = '20px "Courier Prime", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SUBJECT', 44, 520);
  ctx.font = '17px "Courier Prime", monospace';
  wrap(ctx, body, 44, 550, w - 88, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

export function newspaperTexture(title: string, headline: string, seed: number): THREE.Texture {
  const key = `news_${title}_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const w = 512;
  const h = 620;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9d2c0';
  ctx.fillRect(0, 0, w, h);
  paperBase(ctx, w, '#d9d2c0', seed);
  // masthead
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.font = '700 40px "Special Elite", serif';
  ctx.fillText(title.slice(0, 22), w / 2, 56);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, 74);
  ctx.lineTo(w - 24, 74);
  ctx.stroke();
  // headline
  ctx.font = '700 30px "Special Elite", serif';
  wrap(ctx, headline.toUpperCase(), w / 2, 120, w - 48, 34, 'center');
  // columns of fake text
  const rnd = rand(seed + 3);
  ctx.fillStyle = 'rgba(20,20,20,0.55)';
  const colW = (w - 60) / 3;
  for (let col = 0; col < 3; col++) {
    const x = 24 + col * (colW + 6);
    for (let row = 0; row < 26; row++) {
      const yy = 230 + row * 14;
      if (yy > h - 20) break;
      ctx.fillRect(x, yy, colW * (0.7 + rnd() * 0.3), 4);
    }
  }
  // a photo block
  ctx.fillStyle = '#9a9488';
  ctx.fillRect(24, 200, colW * 2, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

export function fingerprintTexture(seed: number): THREE.Texture {
  const key = `finger_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#efe9da';
  ctx.fillRect(0, 0, size, size);
  paperBase(ctx, size, '#efe9da', seed);
  const cx = size / 2;
  const cy = size / 2 - 20;
  ctx.strokeStyle = 'rgba(30,30,50,0.7)';
  ctx.lineWidth = 2.2;
  const rnd = rand(seed);
  for (let i = 0; i < 44; i++) {
    ctx.beginPath();
    const r0 = 8 + i * 4.4;
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.12) {
      const wobble = Math.sin(a * 3 + i * 0.5) * (6 + rnd() * 4) + Math.sin(a * 7) * 3;
      const r = r0 + wobble;
      const x = cx + Math.cos(a) * r * 0.85;
      const y = cy + Math.sin(a) * r;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.5 + rnd() * 0.4;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // label
  ctx.fillStyle = '#1a1a2a';
  ctx.font = '700 22px "Courier Prime", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('LATENT PRINT', cx, size - 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function mapTexture(title: string, seed: number): THREE.Texture {
  const key = `map_${title}_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const w = 640;
  const h = 480;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e7e0cc';
  ctx.fillRect(0, 0, w, h);
  paperBase(ctx, Math.max(w, h), '#e7e0cc', seed);
  ctx.fillStyle = '#e7e0cc';
  ctx.fillRect(0, 0, w, h);
  // water
  ctx.fillStyle = '#bcd0cf';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.quadraticCurveTo(w * 0.3, h * 0.6, w, h * 0.78);
  ctx.lineTo(w, h);
  ctx.fill();
  // road grid
  const rnd = rand(seed);
  ctx.strokeStyle = 'rgba(120,110,90,0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const y = 40 + i * 60 + rnd() * 10;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y - 20 + rnd() * 40);
    ctx.stroke();
  }
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    const x = 40 + i * 68 + rnd() * 10;
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 20 + rnd() * 40, h);
    ctx.stroke();
  }
  // marker
  ctx.fillStyle = 'rgba(200,30,30,0.9)';
  ctx.beginPath();
  ctx.arc(w * 0.62, h * 0.4, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,30,30,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w * 0.62, h * 0.4, 22, 0, Math.PI * 2);
  ctx.stroke();
  // title tab
  ctx.fillStyle = 'rgba(20,20,20,0.85)';
  ctx.fillRect(0, 0, 190, 40);
  ctx.fillStyle = '#efe7d4';
  ctx.font = '700 24px "Courier Prime", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(title.slice(0, 12), 14, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

export function photoPlaceholder(title: string, seed: number): THREE.Texture {
  const key = `photo_${title}_${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const w = 512;
  const h = 640;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // moody night photo gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1a2433');
  g.addColorStop(0.6, '#24313f');
  g.addColorStop(1, '#0e1620');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = rand(seed);
  // fake city lights
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(255,${180 + rnd() * 60},${120 + rnd() * 80},${0.2 + rnd() * 0.6})`;
    const x = rnd() * w;
    const y = h * 0.4 + rnd() * h * 0.5;
    ctx.fillRect(x, y, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  // horizon silhouette
  ctx.fillStyle = '#0a0f16';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  for (let x = 0; x <= w; x += 20) {
    ctx.lineTo(x, h * 0.62 - rnd() * 60);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  // grain
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
  // timestamp
  ctx.fillStyle = 'rgba(255,180,60,0.85)';
  ctx.font = '20px "Courier Prime", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(title.slice(0, 18), w - 16, h - 18);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
  align: CanvasTextAlign = 'left'
) {
  ctx.textAlign = align;
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const wd of words) {
    const test = line + wd + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, yy);
      line = wd + ' ';
      yy += lh;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, yy);
}
