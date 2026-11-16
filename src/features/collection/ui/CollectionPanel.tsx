import { Heart, Download, ArrowUpRight, Archive } from "lucide-react";
import type { GalleryDocument } from "../../../shared/types";
import { useServices } from "../../exhibition/ServicesProvider";
import { recapStats, createRecap } from "../lib/recap";
import { downloadRecap } from "../lib/download";

export function CollectionPanel({
  document,
  onSelect,
  onNote,
  onNoteByKey,
  onToggleByKey,
}: {
  document: GalleryDocument;
  onSelect: (id: string) => void;
  onNote: (id: string, text: string) => void;
  onNoteByKey: (key: string, text: string) => void;
  onToggleByKey: (key: string) => void;
}) {
  const { runtime, titleByKey } = useServices();
  const resolve = (key: string) => {
    const id = runtime.identity.resolve(key);
    return id ? runtime.artworkById(id) : undefined;
  };
  const stats = recapStats(document, resolve);
  const here = document.favorites.filter((k) => resolve(k));
  const archived = document.favorites.filter((k) => !resolve(k));
  return (
    <div className="collection-panel">
      <div className="eyebrow">YOUR PERSONAL GALLERY</div>
      <h2>把共鸣，留在这里。</h2>
      <div className="stats">
        <span>
          <strong>{stats.seen}</strong>已观看
        </span>
        <span>
          <strong>{stats.saved}</strong>已收藏
        </span>
        <span>
          <strong>{Math.floor(stats.seconds / 60)}′</strong>停留时长
        </span>
      </div>
      {document.favorites.length === 0 ? (
        <div className="empty">
          <Heart size={28} />
          <p>遇见喜欢的作品，点亮一颗心。</p>
          <small>你的参观故事，将从这里开始。</small>
        </div>
      ) : (
        <>
          {here.map((key) => {
            const a = resolve(key)!;
            return (
              <article className="saved-card" key={key}>
                <button className="saved-title" onClick={() => onSelect(a.id)}>
                  {a.title}
                  <ArrowUpRight size={15} />
                </button>
                <small>
                  {a.artist} · {a.year}
                </small>
                <textarea
                  aria-label={"感想-" + a.title}
                  placeholder="写下此刻的感受…"
                  value={document.notes[key] || ""}
                  onChange={(e) => onNote(a.id, e.target.value)}
                  maxLength={1000}
                />
                <button
                  className="text-button"
                  onClick={() => onToggleByKey(key)}
                >
                  移出收藏
                </button>
              </article>
            );
          })}
          {archived.length > 0 && (
            <div className="archived-section">
              <div className="eyebrow">
                <Archive size={13} /> 来自其他展览 · 已妥善保留
              </div>
              {archived.map((key) => (
                <article className="saved-card archived" key={key}>
                  <span className="saved-title archived-title">
                    {titleByKey.get(key) ?? "未知作品"}
                  </span>
                  <small>当前展览中并无此内容的作品，不会被错误挂接</small>
                  <textarea
                    aria-label="感想-归档作品"
                    placeholder="写下此刻的感受…"
                    value={document.notes[key] || ""}
                    onChange={(e) => onNoteByKey(key, e.target.value)}
                    maxLength={1000}
                  />
                  <button
                    className="text-button"
                    onClick={() => onToggleByKey(key)}
                  >
                    移出收藏
                  </button>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      <button
        className="primary full"
        disabled={!stats.saved}
        onClick={() =>
          downloadRecap(createRecap(document, resolve, runtime.title))
        }
      >
        <Download size={16} />
        生成个人参观回顾
      </button>
    </div>
  );
}
