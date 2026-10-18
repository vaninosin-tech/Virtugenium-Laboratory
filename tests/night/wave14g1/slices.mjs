import fs from 'node:fs';
import path from 'node:path';

const out = 'docs/night/wave14g1';
fs.mkdirSync(out, { recursive: true });
const radius = .007;
const oldRadius = (() => {
  const height = (ml, r) => {
    const volume = ml * 1e-6, hemisphere = 2 * Math.PI * r ** 3 / 3;
    if (volume >= hemisphere) return r + (volume - hemisphere) / (Math.PI * r * r);
    let lo = 0, hi = r;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (Math.PI * mid * mid * (r - mid / 3) < volume) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let lo = .0001, hi = .05;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (height(2.5, mid) > .055) lo = mid; else hi = mid;
  }
  return { radius: (lo + hi) / 2, height };
})();
const actualVolume = h => {
  const sphere = 2 * Math.PI * radius ** 3 / 3;
  return (h <= radius ? Math.PI * h * h * (radius - h / 3)
    : sphere + Math.PI * radius * radius * (h - radius)) * 1e6;
};
let table = '| Stored mL | Old height mm | New height mm | Old grid mL | New grid mL |\n';
table += '| ---: | ---: | ---: | ---: | ---: |\n';
for (const ml of [.5, 1, 1.5, 2, 2.5, 3.5, 5]) {
  const old = oldRadius.height(ml, oldRadius.radius);
  const next = oldRadius.height(ml, radius);
  table += `| ${ml} | ${(old * 1000).toFixed(3)} | ${(next * 1000).toFixed(3)} | ${actualVolume(old).toFixed(4)} | ${actualVolume(next).toFixed(4)} |\n`;
}
fs.writeFileSync(path.join(out, 'mapping.md'), table);
for (const ml of [1, 2, 2.5]) for (const variant of ['old', 'new']) {
  const level = oldRadius.height(ml, variant === 'old' ? oldRadius.radius : radius);
  const width = 48, rows = 192;
  let ppm = `P3\n# central x/y slice, black air, blue liquid, red free surface; y 0..55 mm\n${width} ${rows}\n255\n`;
  for (let py = rows - 1; py >= 0; py--) {
    const y = (py + .5) / rows * .055;
    for (let px = 0; px < width; px++) {
      const x = (px + .5) / width * 2 * radius - radius;
      const inside = y < radius ? x * x + (y - radius) ** 2 < radius ** 2 : Math.abs(x) < radius;
      const wet = inside && y <= level;
      ppm += wet ? (Math.abs(y - level) < .055 / rows ? '255 40 40 ' : '20 90 230 ')
        : inside ? '40 40 40 ' : '0 0 0 ';
    }
    ppm += '\n';
  }
  fs.writeFileSync(path.join(out, `${variant}-${ml.toFixed(1)}ml.ppm`), ppm);
}
console.log(`legacy radius ${(oldRadius.radius * 1000).toFixed(6)} mm`);
console.log(table);
