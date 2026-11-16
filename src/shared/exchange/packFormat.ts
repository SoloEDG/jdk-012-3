/**
 * 策展包格式：解析、结构校验、序列化。
 * 只做结构（schema）层面的校验；引用、空间、容量等语义校验在 validate.ts。
 */
import {
  PACK_FORMAT,
  type ExhibitionPack,
  type PackArtwork,
  type PackNarration,
  type PackRoute,
  type ReportIssue,
} from "./types";
import { isContentHash } from "./hash";

const issue = (message: string, refs?: string[]): ReportIssue => ({
  level: "error",
  code: "schema",
  message,
  refs,
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateArtwork(a: unknown, i: number, issues: ReportIssue[]) {
  const at = `artworks[${i}]`;
  if (!isRecord(a)) {
    issues.push(issue(`${at} 不是对象`));
    return;
  }
  for (const k of ["id", "title", "artist", "year", "medium", "description"])
    if (!isNonEmptyString(a[k])) issues.push(issue(`${at}.${k} 缺失或为空`));
  for (const k of ["en", "color"])
    if (a[k] !== undefined && typeof a[k] !== "string")
      issues.push(issue(`${at}.${k} 类型错误`));
  if (!isFiniteNumber(a.duration) || (a.duration as number) < 0)
    issues.push(issue(`${at}.duration 必须是非负数字`));
  const p = a.place;
  if (!isRecord(p)) issues.push(issue(`${at}.place 缺失`));
  else
    for (const k of ["x", "z", "facing", "w", "h"])
      if (!isFiniteNumber(p[k])) issues.push(issue(`${at}.place.${k} 必须是数字`));
  if (isRecord(p) && isFiniteNumber(p.w) && isFiniteNumber(p.h)) {
    if ((p.w as number) <= 0 || (p.h as number) <= 0)
      issues.push(issue(`${at}.place 尺寸必须为正数`));
    if ((p.w as number) > 8 || (p.h as number) > 5)
      issues.push(issue(`${at}.place 尺寸超出展厅可悬挂范围`));
  }
  if (!isContentHash(a.imageRef))
    issues.push(issue(`${at}.imageRef 不是合法的内容哈希`));
  if (a.sameAs !== undefined) {
    if (!Array.isArray(a.sameAs) || !a.sameAs.every(isContentHash))
      issues.push(issue(`${at}.sameAs 必须是内容哈希数组`));
  }
}

function validateRoute(r: unknown, i: number, issues: ReportIssue[]) {
  const at = `routes[${i}]`;
  if (!isRecord(r)) {
    issues.push(issue(`${at} 不是对象`));
    return;
  }
  if (!isNonEmptyString(r.id)) issues.push(issue(`${at}.id 缺失`));
  if (!isNonEmptyString(r.name)) issues.push(issue(`${at}.name 缺失`));
  if (
    !Array.isArray(r.stops) ||
    r.stops.length === 0 ||
    !r.stops.every(isNonEmptyString)
  )
    issues.push(issue(`${at}.stops 必须是非空字符串数组`));
}

function validateNarration(n: unknown, i: number, issues: ReportIssue[]) {
  const at = `narration[${i}]`;
  if (!isRecord(n)) {
    issues.push(issue(`${at} 不是对象`));
    return;
  }
  if (!isNonEmptyString(n.artwork)) issues.push(issue(`${at}.artwork 缺失`));
  if (!Array.isArray(n.transcript))
    issues.push(issue(`${at}.transcript 必须是数组`));
  if (n.audioRef !== undefined && !isContentHash(n.audioRef))
    issues.push(issue(`${at}.audioRef 不是合法的内容哈希`));
}

/** 结构校验：返回错误列表（空数组 = 结构合法） */
export function validateSchema(pack: unknown): ReportIssue[] {
  const issues: ReportIssue[] = [];
  if (!isRecord(pack)) return [issue("包不是 JSON 对象")];
  if (pack.format !== PACK_FORMAT)
    issues.push(issue(`format 必须是 ${PACK_FORMAT}，当前为 ${String(pack.format)}`));
  const ex = pack.exhibition;
  if (!isRecord(ex)) issues.push(issue("exhibition 缺失"));
  else {
    for (const k of ["id", "title"])
      if (!isNonEmptyString(ex[k])) issues.push(issue(`exhibition.${k} 缺失`));
    const s = ex.space;
    if (
      !isRecord(s) ||
      !isFiniteNumber(s.width) ||
      !isFiniteNumber(s.depth) ||
      (s.width as number) <= 0 ||
      (s.depth as number) <= 0
    )
      issues.push(issue("exhibition.space 必须包含正的 width/depth"));
  }
  if (!Array.isArray(pack.artworks) || pack.artworks.length === 0)
    issues.push(issue("artworks 必须是非空数组"));
  else (pack.artworks as unknown[]).forEach((a, i) => validateArtwork(a, i, issues));
  if (!Array.isArray(pack.routes)) issues.push(issue("routes 必须是数组"));
  else (pack.routes as unknown[]).forEach((r, i) => validateRoute(r, i, issues));
  if (!Array.isArray(pack.narration)) issues.push(issue("narration 必须是数组"));
  else
    (pack.narration as unknown[]).forEach((n, i) => validateNarration(n, i, issues));
  if (!Array.isArray(pack.assets)) issues.push(issue("assets 必须是数组"));
  else {
    const seen = new Set<string>();
    (pack.assets as unknown[]).forEach((a, i) => {
      const at = `assets[${i}]`;
      if (!isRecord(a)) {
        issues.push(issue(`${at} 不是对象`));
        return;
      }
      if (!isContentHash(a.hash)) issues.push(issue(`${at}.hash 不是合法的内容哈希`));
      else if (seen.has(a.hash)) issues.push(issue(`${at}.hash 重复`, [a.hash]));
      else seen.add(a.hash);
      if (!isNonEmptyString(a.mime)) issues.push(issue(`${at}.mime 缺失`));
      if (typeof a.bytes !== "string" || a.bytes.length === 0)
        issues.push(issue(`${at}.bytes 缺失`));
    });
  }
  // id 唯一性
  if (Array.isArray(pack.artworks)) {
    const ids = new Set<string>();
    for (const a of pack.artworks as PackArtwork[]) {
      if (!a || typeof a.id !== "string") continue;
      if (ids.has(a.id)) issues.push(issue(`作品 id 重复：${a.id}`, [a.id]));
      ids.add(a.id);
    }
  }
  if (Array.isArray(pack.routes)) {
    const ids = new Set<string>();
    for (const r of pack.routes as PackRoute[]) {
      if (!r || typeof r.id !== "string") continue;
      if (ids.has(r.id)) issues.push(issue(`路线 id 重复：${r.id}`, [r.id]));
      ids.add(r.id);
    }
  }
  return issues;
}

/** 解析 JSON 文本并做结构校验；结构错误时 pack 为 null */
export function parsePack(text: string): {
  pack: ExhibitionPack | null;
  issues: ReportIssue[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      pack: null,
      issues: [issue(`JSON 解析失败：${e instanceof Error ? e.message : e}`)],
    };
  }
  const issues = validateSchema(raw);
  if (issues.length > 0) return { pack: null, issues };
  return { pack: raw as ExhibitionPack, issues: [] };
}

export function serializePack(pack: ExhibitionPack): string {
  return JSON.stringify(pack);
}

/**  narration 中空 transcript 不算结构错误（降级处理），这里只做类型修正 */
export function narrationTranscript(n: PackNarration): string[] {
  return n.transcript.filter((l): l is string => typeof l === "string" && l.length > 0);
}
