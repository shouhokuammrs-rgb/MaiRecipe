// PWA 用のプレースホルダーアイコンを生成する。本物の写真は使わない。
// 実行: node scripts/generate-icons.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const BG = "#B84A26";
const FG = "#ffffff";

function svg(size, { maskable = false } = {}) {
  // 湯気の立つ器。maskable は安全領域（中央 80%）に収める
  const scale = (maskable ? 0.62 : 0.78) * (size / 24);
  const off = (size - 24 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${BG}" />
    <g transform="translate(${off} ${off}) scale(${scale})" fill="none" stroke="${FG}"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" />
      <path d="M9 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5" />
    </g>
  </svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const t of targets) {
  const buf = Buffer.from(svg(t.size, { maskable: t.maskable }));
  await sharp(buf).png().toFile(join(outDir, t.file));
  console.log(`wrote ${t.file}`);
}
