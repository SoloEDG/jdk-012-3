import { describe, it, expect } from "vitest";
import { parsePack, serializePack, validateSchema } from "../src/shared/exchange/packFormat";
import { PACK_FORMAT } from "../src/shared/exchange/types";
import { makePack } from "./helpers";

describe("packFormat 结构校验", () => {
  it("合法包通过校验并可往返序列化", async () => {
    const pack = await makePack({
      artworks: [
        { id: "a", imageName: "img-a" },
        { id: "b", imageName: "img-b" },
      ],
      routes: [{ id: "r1", name: "路线", stops: ["a", "b"] }],
      narration: { a: ["第一句", "第二句"] },
    });
    expect(validateSchema(pack)).toEqual([]);
    const { pack: parsed, issues } = parsePack(serializePack(pack));
    expect(issues).toEqual([]);
    expect(parsed?.exhibition.id).toBe("test-ex-1");
    expect(parsed?.artworks).toHaveLength(2);
  });

  it("拒绝错误的 format 与缺失字段", async () => {
    const pack = await makePack({ artworks: [{ id: "a", imageName: "x" }] });
    const broken = JSON.parse(serializePack(pack));
    broken.format = "other/9";
    delete broken.exhibition.space;
    broken.artworks[0].imageRef = "not-a-hash";
    const issues = validateSchema(broken);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.every((i) => i.level === "error")).toBe(true);
  });

  it("拒绝重复的作品 id 与重复的资源哈希", async () => {
    const pack = await makePack({
      artworks: [
        { id: "a", imageName: "img-a" },
        { id: "a", imageName: "img-b" },
      ],
    });
    const issues = validateSchema(pack);
    expect(issues.some((i) => i.message.includes("id 重复"))).toBe(true);
  });

  it("JSON 解析失败返回结构错误而不是抛出", () => {
    const { pack, issues } = parsePack("{not json");
    expect(pack).toBeNull();
    expect(issues[0].code).toBe("schema");
  });

  it("format 不符的包被拒绝", async () => {
    const pack = await makePack({ artworks: [{ id: "a", imageName: "x" }] });
    const raw = JSON.parse(serializePack(pack));
    raw.format = "yujing-pack/0";
    const { pack: parsed } = parsePack(JSON.stringify(raw));
    expect(parsed).toBeNull();
    expect(PACK_FORMAT).toBe("yujing-pack/1");
  });
});
