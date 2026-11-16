/**
 * 示例包生成器：在浏览器内生成可导入的策展包，用于完整演示交换流程。
 *
 * 关键设计：
 * - 示例包 B 中「山的另一种记忆」复用内置画家 → 图片字节与内置展览
 *   完全相同 → 内容哈希相同 → 收藏/参观记录按身份规则迁移；
 * - 「无声的潮汐」标题与内置作品相同，但画面是另一幅 → 内容哈希不同 →
 *   绝不能合并（演示“名称相同但内容不同的作品不能误合并”）。
 */
import {
  PACK_FORMAT,
  type ExhibitionPack,
  type PackArtwork,
} from "../../../shared/exchange/types";
import { contentHash } from "../../../shared/exchange/hash";
import { bytesToBase64 } from "../../../shared/exchange/base64";
import { canvasToPngBytes } from "../../../shared/exchange/imageTools";
import {
  paintBuiltinArtwork,
  paintGenericArtwork,
  paintNoiseArtwork,
} from "../../space/lib/painters";

export type SampleVariant = "B" | "brokenNarration" | "conflict" | "giant";

export const SAMPLE_LABELS: Record<SampleVariant, string> = {
  B: "示例包 · 潮汐之间",
  brokenNarration: "示例包 · 损坏讲解",
  conflict: "示例包 · 空间冲突",
  giant: "示例包 · 超出容量",
};

type ArtworkSeed = {
  id: string;
  title: string;
  en: string;
  artist: string;
  year: string;
  medium: string;
  color: string;
  description: string;
  duration: number;
  place: PackArtwork["place"];
  paint: () => HTMLCanvasElement;
  transcript: string[];
};

const TIDE_ARTWORKS: ArtworkSeed[] = [
  {
    id: "b1",
    title: "山的另一种记忆",
    en: "MEMORY OF THE MOUNTAIN",
    artist: "林知远",
    year: "2025",
    medium: "生成艺术 / 数字微喷",
    color: "#a7c4ac",
    description: "山并非静止的风景，而是时间缓慢折叠后的形状。（与「万物之间」中的是同一内容版本）",
    duration: 40,
    place: { x: -5.4, z: -4, facing: Math.PI / 2, w: 2.13, h: 2.73 },
    paint: () => paintBuiltinArtwork("a1"), // 与内置展览字节完全相同
    transcript: [
      "这件作品随巡展来到这里，仍是记忆中的那座山。",
      "同一份数据，同一幅画 —— 收藏它的人会在新展览里再次遇见。",
    ],
  },
  {
    id: "b2",
    title: "无声的潮汐",
    en: "TIDE, REIMAGINED",
    artist: "陈以宁",
    year: "2026",
    medium: "算法绘画 / 重制版",
    color: "#8fa8c8",
    description:
      "与旧展同名的全新版本：艺术家重写了潮汐算法，色彩更冷、更克制。同名，但已是另一件作品。",
    duration: 34,
    place: { x: 0, z: -7.4, facing: 0, w: 2.13, h: 2.73 },
    paint: () =>
      paintGenericArtwork(11, ["#2e4a66", "#7fa3c7", "#d8e4ef"], "#16222e"),
    transcript: [
      "这是「无声的潮汐」的第二个版本。",
      "名字沿用下来，画面却是全新的海。",
    ],
  },
  {
    id: "b3",
    title: "港口的清晨",
    en: "MORNING HARBOR",
    artist: "何序",
    year: "2024",
    medium: "数字构成",
    color: "#c8b28f",
    description: "集装箱与吊臂在晨雾中排成几何队列，港口像一座未醒的城市。",
    duration: 30,
    place: { x: 5.4, z: -4, facing: -Math.PI / 2, w: 2.13, h: 2.73 },
    paint: () =>
      paintGenericArtwork(22, ["#8f5b3c", "#c8b28f", "#e8dcc8"], "#3c4650"),
    transcript: ["清晨六点的港口，声音还没有开始。", "几何不是冷漠，是秩序的温度。"],
  },
  {
    id: "b4",
    title: "风的刻度",
    en: "SCALES OF WIND",
    artist: "周弥",
    year: "2025",
    medium: "数据绘画",
    color: "#9fc0b0",
    description: "一整年的风向记录被折叠成色带，每一道弧线都是某天的风。",
    duration: 28,
    place: { x: -5.4, z: 2.5, facing: Math.PI / 2, w: 2.13, h: 2.73 },
    paint: () =>
      paintGenericArtwork(33, ["#3c6e58", "#9fc0b0", "#e0ebdd"], "#20302a"),
    transcript: ["风看不见，但数据记得。", "每一道色带，都是某一天路过的风。"],
  },
  {
    id: "b5",
    title: "夜色温室",
    en: "NIGHT GREENHOUSE",
    artist: "许眠",
    year: "2026",
    medium: "粒子艺术",
    color: "#7d8fb0",
    description: "植物在夜里释放微光，温室像一座装着星空的盒子。",
    duration: 36,
    place: { x: 5.4, z: 2.5, facing: -Math.PI / 2, w: 2.13, h: 2.73 },
    paint: () =>
      paintGenericArtwork(44, ["#4a5e8f", "#8fb0d8", "#d8e0f0"], "#141c2c"),
    transcript: ["温室在夜里换了主人。", "光是植物说的话。"],
  },
];

async function buildPack(
  variant: SampleVariant,
): Promise<{ name: string; pack: ExhibitionPack }> {
  if (variant === "giant") return buildGiantPack();
  const assets: ExhibitionPack["assets"] = [];
  const artworks: PackArtwork[] = [];
  for (const seed of TIDE_ARTWORKS) {
    const bytes = await canvasToPngBytes(seed.paint());
    const hash = await contentHash(bytes);
    assets.push({ hash, mime: "image/png", bytes: bytesToBase64(bytes) });
    artworks.push({
      id: seed.id,
      title: seed.title,
      en: seed.en,
      artist: seed.artist,
      year: seed.year,
      medium: seed.medium,
      color: seed.color,
      description: seed.description,
      duration: seed.duration,
      place: { ...seed.place },
      imageRef: hash,
    });
  }
  const narration: ExhibitionPack["narration"] = TIDE_ARTWORKS.map((a) => ({
    artwork: a.id,
    transcript: [...a.transcript],
  }));
  if (variant === "brokenNarration") {
    // 损坏一：讲解文本为空；损坏二：讲解音频指向不存在的资源
    narration[2] = { artwork: "b3", transcript: [] };
    narration[3] = {
      artwork: "b4",
      transcript: narration[3].transcript,
      audioRef: "sha256:" + "0".repeat(64),
    };
  }
  if (variant === "conflict") {
    // 冲突一：b3 与 b1 占位重叠；冲突二：b5 摆出展厅边界
    artworks[2].place = { ...artworks[0].place };
    artworks[4].place = { ...artworks[4].place, z: 20 };
  }
  const pack: ExhibitionPack = {
    format: PACK_FORMAT,
    exhibition: {
      id: variant === "B" ? "sample-tide-001" : `sample-tide-${variant}`,
      title: "潮汐之间",
      en: "BETWEEN TIDES",
      intro: "巡展第二站：海、港口与夜色的另一种排列。",
      space: { width: 12, depth: 16 },
    },
    artworks,
    routes: [
      {
        id: "r-tide",
        name: "归途",
        subtitle: "从山出发，经过港口，回到夜色",
        stops: ["b1", "b3", "b5"],
      },
      {
        id: "r-light",
        name: "光的路径",
        subtitle: "潮汐与风的两种测量方式",
        stops: ["b2", "b4"],
      },
    ],
    narration,
    assets,
  };
  return { name: SAMPLE_LABELS[variant], pack };
}

async function buildGiantPack(): Promise<{
  name: string;
  pack: ExhibitionPack;
}> {
  const assets: ExhibitionPack["assets"] = [];
  const artworks: PackArtwork[] = [];
  const narration: ExhibitionPack["narration"] = [];
  for (let i = 0; i < 16; i++) {
    const bytes = await canvasToPngBytes(paintNoiseArtwork(i + 1));
    const hash = await contentHash(bytes);
    assets.push({ hash, mime: "image/png", bytes: bytesToBase64(bytes) });
    const id = `g${i + 1}`;
    artworks.push({
      id,
      title: `噪声研究 ${i + 1}`,
      en: `NOISE STUDY ${i + 1}`,
      artist: "机器集体",
      year: "2026",
      medium: "生成艺术",
      color: "#888888",
      description: "高信息量噪声图像，用于演示容量上限与恢复行为。",
      duration: 20,
      place: {
        x: -4.5 + (i % 4) * 3,
        z: -6 + Math.floor(i / 4) * 4,
        facing: 0,
        w: 1.2,
        h: 1.6,
      },
      imageRef: hash,
    });
    narration.push({ artwork: id, transcript: ["这是一件用于容量演示的作品。"] });
  }
  return {
    name: SAMPLE_LABELS.giant,
    pack: {
      format: PACK_FORMAT,
      exhibition: {
        id: "sample-giant-001",
        title: "无限噪声",
        en: "INFINITE NOISE",
        intro: "一个故意超出默认容量预算的展览。",
        space: { width: 12, depth: 16 },
      },
      artworks,
      routes: [{ id: "r-all", name: "全部", subtitle: "十六件噪声", stops: artworks.map((a) => a.id) }],
      narration,
      assets,
    },
  };
}

export async function generateSample(
  variant: SampleVariant,
): Promise<{ name: string; text: string }> {
  const { name, pack } = await buildPack(variant);
  return { name, text: JSON.stringify(pack) };
}
