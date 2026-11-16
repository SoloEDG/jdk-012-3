import { useRef } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Database,
  History,
  PackageOpen,
  ScrollText,
  Trash2,
} from "lucide-react";
import { useServices } from "../../exhibition/ServicesProvider";
import { useExchange } from "../model/useExchange";
import { formatBytes } from "../../../shared/exchange/capacity";
import { SAMPLE_LABELS, type SampleVariant } from "../lib/samples";

const PHASE_LABEL: Record<string, string> = {
  idle: "空闲",
  reading: "读取包文件",
  decoding: "校验与解码资源",
  preview: "等待确认",
  committing: "原子提交中",
  done: "已完成",
  failed: "已失败",
};

export function ExchangePanel({ x }: { x: ReturnType<typeof useExchange> }) {
  const { runtime } = useServices();
  const budgetInput = useRef<HTMLInputElement>(null);
  const cap = x.capacity;
  const importing =
    x.importState.phase === "reading" ||
    x.importState.phase === "decoding" ||
    x.importState.phase === "committing";
  const archived = x.exhibitions.filter((e) => e.status === "archived");

  return (
    <div className="exchange-panel">
      <div className="eyebrow">EXHIBITION EXCHANGE</div>
      <h2>策展包交换</h2>
      <p className="exchange-hint">
        导入其他展览的策展包（作品图片、摆放、路线与讲解），或把当前展览导出再次交换。
        确认导入前，当前展览始终可以完整参观。
      </p>

      <section className="exchange-section">
        <div className="section-title">
          <PackageOpen size={15} />
          <span>当前展览</span>
        </div>
        <div className="current-exhibition">
          <strong>{runtime.title}</strong>
          <small>
            {runtime.artworks.length} 件作品 · {runtime.routes.length} 条路线
            {cap ? ` · 钉住 ${formatBytes(cap.pinnedBytes)}` : ""}
          </small>
        </div>
      </section>

      {cap && (
        <section className="exchange-section">
          <div className="section-title">
            <Database size={15} />
            <span>容量</span>
            <small>
              {formatBytes(cap.usedBytes)} / {formatBytes(cap.budgetBytes)}
            </small>
          </div>
          <div
            className="capacity-meter"
            role="img"
            aria-label={`容量使用 ${formatBytes(cap.usedBytes)}，预算 ${formatBytes(cap.budgetBytes)}`}
          >
            <span
              className="seg pinned"
              style={{ width: `${(cap.pinnedBytes / cap.budgetBytes) * 100}%` }}
              title={`当前展览 ${formatBytes(cap.pinnedBytes)}`}
            />
            <span
              className="seg staged"
              style={{ width: `${(cap.stagedBytes / cap.budgetBytes) * 100}%` }}
              title={`暂存 ${formatBytes(cap.stagedBytes)}`}
            />
            <span
              className="seg archived"
              style={{
                width: `${(cap.archived.reduce((n, a) => n + a.bytes, 0) / cap.budgetBytes) * 100}%`,
              }}
              title={`归档 ${formatBytes(cap.archived.reduce((n, a) => n + a.bytes, 0))}`}
            />
          </div>
          <div className="capacity-legend">
            <span>
              <i className="dot pinned" />
              当前展览（钉住）
            </span>
            <span>
              <i className="dot staged" />
              导入暂存
            </span>
            <span>
              <i className="dot archived" />
              归档（可回收）
            </span>
          </div>
          <label className="budget-row">
            预算上限（MB）
            <input
              key={cap.budgetBytes}
              ref={budgetInput}
              type="number"
              min="1"
              defaultValue={Math.round(cap.budgetBytes / 1024 / 1024)}
              aria-label="容量预算（MB）"
            />
            <button
              className="text-button"
              onClick={() => {
                const mb = Number(budgetInput.current?.value);
                if (Number.isFinite(mb) && mb >= 1)
                  void x.setBudget(mb * 1024 * 1024);
              }}
            >
              应用
            </button>
          </label>
        </section>
      )}

      <section className="exchange-section">
        <div className="section-title">
          <ArrowDownToLine size={15} />
          <span>导入</span>
        </div>
        {importing ? (
          <div className="import-progress">
            <small>
              {PHASE_LABEL[x.importState.phase]} · {x.importState.sourceName}
            </small>
            <progress
              value={x.importState.progress.done}
              max={x.importState.progress.total || 1}
            />
            <small>
              {x.importState.progress.done} / {x.importState.progress.total} 项资源
            </small>
            {x.importState.phase !== "committing" && (
              <button className="text-button" onClick={() => void x.cancel()}>
                取消导入（当前展览不受影响）
              </button>
            )}
          </div>
        ) : (
          <>
            <button
              className="primary full"
              onClick={() => x.fileInput.current?.click()}
            >
              <ArrowDownToLine size={15} />
              选择策展包文件…
            </button>
            <input
              ref={x.fileInput}
              type="file"
              accept=".json,.yujingpack,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) x.importFile(f);
                e.target.value = "";
              }}
            />
            <div className="sample-buttons">
              {(Object.keys(SAMPLE_LABELS) as SampleVariant[]).map((v) => (
                <button
                  key={v}
                  className="text-button"
                  disabled={x.busySample !== null}
                  onClick={() => void x.importSample(v)}
                >
                  {x.busySample === v ? "生成中…" : SAMPLE_LABELS[v]}
                </button>
              ))}
            </div>
          </>
        )}
        {x.importState.phase === "failed" && (
          <p className="import-error" role="alert">
            {x.importState.error}
          </p>
        )}
      </section>

      <section className="exchange-section">
        <div className="section-title">
          <ArrowUpFromLine size={15} />
          <span>导出</span>
        </div>
        <button className="text-button full" onClick={() => void x.exportActive()}>
          导出「{runtime.title}」策展包
        </button>
      </section>

      {archived.length > 0 && (
        <section className="exchange-section">
          <div className="section-title">
            <Boxes size={15} />
            <span>归档展览</span>
            <small>容量不足时按 LRU 自动回收</small>
          </div>
          {archived.map((e) => (
            <div className="archived-row" key={e.manifest.id}>
              <span>
                <strong>{e.manifest.title}</strong>
                <small>
                  {e.assetsCleared
                    ? "资源已回收 · 清单保留"
                    : `独占 ${formatBytes(
                        x.capacity?.archived.find((a) => a.id === e.manifest.id)
                          ?.bytes ?? 0,
                      )}`}
                </small>
              </span>
              {!e.assetsCleared && (
                <button
                  className="icon-button"
                  aria-label={`回收 ${e.manifest.title}`}
                  onClick={() => void x.evict([e.manifest.id])}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {x.migrations.length > 0 && (
        <section className="exchange-section">
          <div className="section-title">
            <History size={15} />
            <span>迁移记录</span>
          </div>
          {x.migrations.slice(-3).map((m, i) => (
            <div className="migration-row" key={i}>
              <small>
                「{m.from.title}」→「{m.to.title}」：收藏迁移{" "}
                {m.favoritesMatched.length} 件、归档 {m.favoritesArchived.length}{" "}
                件；参观记录迁移 {m.visitsMatched} 条、归档 {m.visitsArchived} 条
              </small>
            </div>
          ))}
        </section>
      )}

      <section className="exchange-section">
        <div className="section-title">
          <ScrollText size={15} />
          <span>事件日志</span>
        </div>
        <div className="event-log" aria-live="polite">
          {x.log.slice(-30).map((e, i) => (
            <div className={`event-row kind-${e.kind}`} key={i}>
              <small>{new Date(e.at).toLocaleTimeString()}</small>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
