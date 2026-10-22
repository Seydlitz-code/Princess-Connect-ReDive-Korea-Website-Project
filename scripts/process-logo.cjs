/**
 * 로고 PNG에서 검정·근접 검정 배경을 알파로 바꿔 public/images/logo.png 로 출력합니다.
 * 원본은 scripts/logo-source.png 에 두고 `npm run build:logo` 를 실행하세요.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const INPUT = path.join(ROOT, 'scripts', 'logo-source.png');
const OUTPUT = path.join(ROOT, 'public', 'images', 'logo.png');

/** 어두운 배경만 제거 (핑크·흰 영역 유지) */
function knockOutDarkBackground(data, width, height, channels, opts) {
  const maxCutoff = opts.maxCutoff ?? 52;
  const chromaSpread = opts.chromaSpread ?? 28;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const spread = max - min;

      const dark = max <= maxCutoff;
      const lowChroma = spread <= chromaSpread;
      if (dark && lowChroma) {
        data[i + 3] = 0;
      }
    }
  }
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Missing scripts/logo-source.png — 로고 원본 PNG를 해당 경로에 넣은 뒤 다시 실행하세요.');
    process.exit(1);
  }

  const { data, info } = await sharp(INPUT)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  if (channels !== 4) {
    console.error('Expected RGBA after ensureAlpha');
    process.exit(1);
  }

  knockOutDarkBackground(data, info.width, info.height, channels, {});

  await sharp(Buffer.from(data), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toFile(OUTPUT);

  console.log('Wrote', path.relative(ROOT, OUTPUT));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
