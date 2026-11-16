/**
 * 内置展览的作品画家：把原 artTexture.ts 中按作品 id 的程序化绘制
 * 抽成纯函数，供两处使用：
 * 1. 首次启动时生成内置展览的图片资源（编码为 PNG 并计算内容哈希）；
 * 2. 示例包复用同一画家，产出内容完全相同的图片字节 —— 用于演示
 *   “内容相同 → 身份相同 → 收藏迁移”。
 */

export const ART_W = 700;
export const ART_H = 850;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export function paintBuiltinArtwork(
  id: string,
  w = ART_W,
  h = ART_H,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e3dfd4";
  g.fillRect(0, 0, w, h);
  const rnd = seededRandom(Number(id.slice(1)) * 7919 || 7);
  if (id === "a1") {
    for (let n = 0; n < 11; n++) {
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 4)
        g.lineTo(
          x,
          210 + n * 48 + Math.sin(x / 115 + n) * 90 + Math.sin(x / 40 + n) * 20,
        );
      g.lineTo(w, h);
      g.fillStyle = [
        "#d1d9c9",
        "#bac8b6",
        "#a6bca8",
        "#88a18e",
        "#678a79",
        "#436d60",
      ][n % 6];
      g.fill();
    }
  } else if (id === "a2") {
    g.fillStyle = "#b6b0c6";
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 100; n++) {
      g.beginPath();
      for (let x = 0; x <= w; x += 5) {
        const y = 200 + n * 7 + Math.sin(x / 130 + n / 14) * 85;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = `rgba(244,236,255,${0.1 + rnd() * 0.5})`;
      g.stroke();
    }
  } else if (id === "a3") {
    g.fillStyle = "#e2c4a5";
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 18; n++) {
      g.fillStyle = ["#c66d45", "#edab70", "#8b4939", "#e6ce9f"][n % 4];
      g.fillRect(rnd() * 650, rnd() * 800, 30 + rnd() * 230, 40 + rnd() * 330);
    }
  } else if (id === "a4") {
    g.fillStyle = "#a2bac0";
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 100; n++) {
      const x = rnd() * w,
        y = rnd() * h;
      g.fillStyle = ["#29464f", "#527983", "#d5d8c9"][n % 3];
      g.fillRect(x, y, 20 + rnd() * 80, 40 + rnd() * 140);
      g.strokeStyle = "#c2dddd";
      g.strokeRect(x, y, 20, 65);
    }
  } else if (id === "a5") {
    g.fillStyle = "#18261f";
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 3500; n++) {
      const t = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * 280;
      g.fillStyle = ["#c7d297", "#768953", "#d8b76d"][n % 3];
      g.globalAlpha = rnd();
      g.beginPath();
      g.arc(
        350 + Math.cos(t) * r,
        425 + Math.sin(t) * r * 1.2,
        rnd() * 2.5,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "#c9bcab";
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 9; n++) {
      g.save();
      g.translate(350, 420);
      g.rotate(n * 0.22);
      g.strokeStyle = n % 2 ? "#736b62" : "#eee4d8";
      g.lineWidth = 18;
      g.beginPath();
      g.ellipse(0, 0, 95 + n * 15, 240, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
  return c;
}

/** 通用生成画家（示例包用）：seed 决定画面，内容稳定可复现 */
export function paintGenericArtwork(
  seed: number,
  palette: string[],
  background: string,
  w = ART_W,
  h = ART_H,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const rnd = seededRandom(seed * 2654435761 + 97);
  g.fillStyle = background;
  g.fillRect(0, 0, w, h);
  const shapes = 24 + Math.floor(rnd() * 30);
  for (let n = 0; n < shapes; n++) {
    g.fillStyle = palette[n % palette.length];
    g.globalAlpha = 0.35 + rnd() * 0.6;
    const kind = n % 3;
    if (kind === 0) {
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 20 + rnd() * 140, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 1) {
      g.save();
      g.translate(rnd() * w, rnd() * h);
      g.rotate(rnd() * Math.PI);
      g.fillRect(-rnd() * 160, -rnd() * 60, 60 + rnd() * 240, 30 + rnd() * 160);
      g.restore();
    } else {
      g.beginPath();
      const x = rnd() * w,
        y = rnd() * h;
      g.moveTo(x, y);
      g.lineTo(x + rnd() * 200 - 100, y + rnd() * 200 - 100);
      g.lineTo(x + rnd() * 240 - 120, y + rnd() * 240 - 120);
      g.closePath();
      g.fill();
    }
  }
  g.globalAlpha = 1;
  return c;
}

/** 噪声画家（巨型示例包用）：PNG 压缩率低，用于演示容量上限 */
export function paintNoiseArtwork(
  seed: number,
  w = 512,
  h = 512,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const rnd = seededRandom(seed * 40503 + 65599);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rnd() * 256;
    img.data[i + 1] = rnd() * 256;
    img.data[i + 2] = rnd() * 256;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
