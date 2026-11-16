import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Boxes,
  Route as RouteIcon,
  Move3d,
  Headphones,
  Users,
  Database,
} from "lucide-react";
import type { ImportState } from "../../../shared/exchange/coordinator";
import type { PackReport } from "../../../shared/exchange/types";
import { formatBytes } from "../../../shared/exchange/capacity";

/**
 * 导入前预览：容量、缺失资源、路线引用、空间冲突、讲解可用性、身份迁移。
 * 有 error 级问题时不能确认；取消/失败都不影响当前展览。
 */
export function ImportPreview({
  state,
  onConfirm,
  onCancel,
  onClose,
}: {
  state: ImportState;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const report = state.report;
  if (!report) return null;
  const failed = state.phase === "failed";
  const errors = report.issues.filter((i) => i.level === "error");
  const warnings = report.issues.filter((i) => i.level === "warning");
  return (
    <div className="modal-backdrop" onClick={failed ? onClose : onCancel}>
      <div
        className="modal import-preview"
        role="dialog"
        aria-modal="true"
        aria-label="导入预览"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow">IMPORT PREVIEW</div>
        <h2>{failed ? "导入未通过" : "导入预览"}</h2>
        <p className="preview-source">
          {state.sourceName} · {report.stats.artworks} 件作品 ·{" "}
          {report.stats.routes} 条路线 · {report.stats.assets} 项资源（
          {formatBytes(report.stats.bytes)}）
        </p>

        <section className="preview-section">
          <h3>
            <Database size={15} /> 容量
          </h3>
          <ul>
            <li>
              需新写入 <strong>{formatBytes(report.capacity.requiredBytes)}</strong>
              {report.capacity.reusedBytes > 0 &&
                `，复用已有资源 ${formatBytes(report.capacity.reusedBytes)}`}
            </li>
            <li>
              当前钉住 {formatBytes(report.capacity.pinnedBytes)} · 归档可回收{" "}
              {formatBytes(report.capacity.evictableBytes)} · 预算{" "}
              {formatBytes(report.capacity.budgetBytes)}
            </li>
            {report.capacity.evictions.length > 0 && (
              <li className="warn">
                将按 LRU 回收：
                {report.capacity.evictions
                  .map((e) => `「${e.title}」(${formatBytes(e.bytes)})`)
                  .join("、")}
              </li>
            )}
            {!report.capacity.fits && (
              <li className="error">
                缺口 {formatBytes(report.capacity.shortfall)}
                ，回收全部归档仍不足 —— 请提高预算或先回收归档
              </li>
            )}
          </ul>
        </section>

        <section className="preview-section">
          <h3>
            <Boxes size={15} /> 资源完整性
          </h3>
          {report.missing.required.length === 0 &&
          report.missing.optional.length === 0 ? (
            <p className="ok">
              <CheckCircle2 size={14} /> 所有引用资源齐备，内容哈希校验通过
            </p>
          ) : (
            <ul>
              {report.missing.required.map((h) => (
                <li className="error" key={h}>
                  作品图片缺失：{h.slice(0, 24)}…
                </li>
              ))}
              {report.missing.optional.map((h) => (
                <li className="warn" key={h}>
                  讲解音频缺失（降级）：{h.slice(0, 24)}…
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="preview-section">
          <h3>
            <RouteIcon size={15} /> 路线引用
          </h3>
          {report.routes.length === 0 ? (
            <p className="ok">
              <CheckCircle2 size={14} /> {report.stats.routes} 条路线的站点均可解析
            </p>
          ) : (
            <ul>
              {report.routes.map((r) => (
                <li className="error" key={r.id}>
                  「{r.name}」引用了不存在的作品：{r.broken.join("、")}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="preview-section">
          <h3>
            <Move3d size={15} /> 空间冲突
          </h3>
          {report.spatial.overlaps.length === 0 &&
          report.spatial.outOfBounds.length === 0 ? (
            <p className="ok">
              <CheckCircle2 size={14} /> 摆放无重叠、无越界
            </p>
          ) : (
            <ul>
              {report.spatial.overlaps.map((o, i) => (
                <li className="error" key={i}>
                  {o.a} 与 {o.b} 占位重叠 {o.area.toFixed(2)}㎡
                </li>
              ))}
              {report.spatial.outOfBounds.map((id) => (
                <li className="error" key={id}>
                  {id} 超出展厅边界
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="preview-section">
          <h3>
            <Headphones size={15} /> 讲解资源
          </h3>
          <ul>
            {report.narration.map((n) => (
              <li className={n.status === "ok" ? "ok" : "warn"} key={n.artwork}>
                {n.artwork}：{n.status === "ok" ? "完整" : `降级（${n.reason}）`}
              </li>
            ))}
          </ul>
        </section>

        <section className="preview-section">
          <h3>
            <Users size={15} /> 收藏与参观记录迁移
          </h3>
          <ul>
            <li>
              按内容身份匹配：<strong>{report.identity.favoritesMatched}</strong>{" "}
              件收藏、{report.identity.visitsMatched} 条参观记录将迁移到新展览
            </li>
            {report.identity.matchedTitles.length > 0 && (
              <li className="ok">
                迁移：{report.identity.matchedTitles.join("、")}
              </li>
            )}
            <li>
              <strong>{report.identity.favoritesArchived}</strong> 件收藏、
              {report.identity.visitsArchived} 条记录无法匹配，将保持归档
              （数据保留，不会指向其他作品）
            </li>
            {report.identity.archivedTitles.length > 0 && (
              <li className="warn">
                归档：{report.identity.archivedTitles.join("、")}
              </li>
            )}
          </ul>
        </section>

        {(errors.length > 0 || warnings.length > 0) && (
          <section className="preview-section">
            <h3>
              <AlertTriangle size={15} /> 问题清单（{errors.length} 错误 /{" "}
              {warnings.length} 警告）
            </h3>
            <ul className="issue-list">
              {report.issues.map((issue, i) => (
                <li
                  key={i}
                  className={issue.level === "error" ? "error" : "warn"}
                >
                  {issue.level === "error" ? (
                    <XCircle size={13} />
                  ) : (
                    <AlertTriangle size={13} />
                  )}
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="preview-actions">
          {failed ? (
            <button className="primary" onClick={onClose}>
              返回（当前展览不受影响）
            </button>
          ) : (
            <>
              <button
                className="primary"
                disabled={!report.ok}
                onClick={onConfirm}
              >
                确认切换到这个展览
              </button>
              <button className="text-button" onClick={onCancel}>
                取消，继续参观当前展览
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
