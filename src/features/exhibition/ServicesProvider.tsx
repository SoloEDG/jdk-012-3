/**
 * 服务提供器：应用启动引导与全局单例。
 *
 * 启动顺序保证“重新打开页面时不出现新旧混搭”：
 * 1. 打开存储并清除上次会话遗留的暂存数据；
 * 2. 读取唯一的 active 展览（没有则安装内置展览）；
 * 3. 完整性检查：当前展览资源缺失 → 自愈（重装内置展览并记录事件），
 *    绝不渲染残缺的展览；
 * 4. 构建运行时展览；执行收藏文档的 v1→v2 迁移；
 * 5. 创建导入协调器单例。
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { ExchangeStore } from "../../shared/exchange/storeTypes";
import { openIdbStore } from "../../shared/exchange/idbStore";
import { ExchangeEvents } from "../../shared/exchange/events";
import { ImportCoordinator } from "../../shared/exchange/coordinator";
import { verifyImageDecodable } from "../../shared/exchange/imageTools";
import { migrateV1Document } from "../../shared/storage";
import { buildBuiltinPack } from "./builtin";
import { buildRuntime, IntegrityError, type RuntimeExhibition } from "./runtime";

export type Services = {
  store: ExchangeStore;
  events: ExchangeEvents;
  runtime: RuntimeExhibition;
  coordinator: ImportCoordinator;
  /** 身份键 → 作品标题（覆盖当前与归档展览，用于收藏/迁移展示） */
  titleByKey: ReadonlyMap<string, string>;
  /** 收藏文档的实时键集合，由 useCollection 同步，供协调器在 commit 时读取 */
  collectionKeysRef: MutableRefObject<{ favorites: string[]; visits: string[] }>;
  /** commit 成功后重建运行时展览 */
  reloadRuntime: () => Promise<void>;
};

const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("ServicesProvider 尚未就绪");
  return s;
}

async function loadActiveRuntime(
  store: ExchangeStore,
  events: ExchangeEvents,
  revision: number,
): Promise<RuntimeExhibition> {
  const active = await store.getActive();
  if (!active) throw new Error("存储中没有当前展览");
  try {
    return await buildRuntime(active.manifest, store.readAsset, revision);
  } catch (e) {
    if (!(e instanceof IntegrityError)) throw e;
    // 自愈：当前展览资源残缺 → 重装内置展览（其资源可确定性地重新生成），
    // 并记录可观察事件。绝不带着残缺资源继续渲染。
    events.emit(
      "integrity",
      `当前展览缺少 ${e.missing.length} 项资源，已自愈回退到内置展览`,
    );
    const built = await buildBuiltinPack();
    await store.installActive(built.manifest, built.assets);
    const restored = await store.getActive();
    if (!restored) throw new Error("自愈失败：无法安装内置展览");
    return buildRuntime(restored.manifest, store.readAsset, revision);
  }
}

async function buildTitleIndex(store: ExchangeStore): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const e of await store.listExhibitions()) {
    for (const a of e.manifest.artworks) {
      if (!map.has(a.imageRef)) map.set(a.imageRef, a.title);
      for (const alias of a.sameAs ?? []) {
        if (!map.has(alias)) map.set(alias, a.title);
      }
    }
  }
  return map;
}

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Services | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const collectionKeysRef = useRef<{ favorites: string[]; visits: string[] }>({
    favorites: [],
    visits: [],
  });
  const revisionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let storeRef: ExchangeStore | null = null;
    (async () => {
      const events = new ExchangeEvents();
      const store = await openIdbStore();
      storeRef = store;
      const cleanup = await store.bootCleanup();
      events.emit(
        "boot",
        cleanup.removedStaging > 0
          ? `启动清理：移除上次会话遗留的 ${cleanup.removedStaging} 项暂存资源`
          : "启动：无遗留暂存数据",
      );
      if (!(await store.getActive())) {
        const built = await buildBuiltinPack();
        await store.installActive(built.manifest, built.assets);
        events.emit("boot", `已安装内置展览「${built.manifest.title}」`);
      }
      const runtime = await loadActiveRuntime(store, events, ++revisionRef.current);
      const migrated = migrateV1Document(runtime.identity.keyOf);
      if (migrated) events.emit("boot", "已完成收藏文档 v1 → v2 迁移（按内容身份）");
      const titleByKey = await buildTitleIndex(store);
      const titlesRef = { current: titleByKey };

      const coordinator = new ImportCoordinator({
        store,
        events,
        decodeImage: verifyImageDecodable,
        getCollectionKeys: () => collectionKeysRef.current,
        titleOfKey: (key) => titlesRef.current.get(key),
        onCommitted: async () => {
          await reload();
        },
      });

      const reload = async () => {
        const next = await loadActiveRuntime(store, events, ++revisionRef.current);
        const titles = await buildTitleIndex(store);
        titlesRef.current = titles;
        if (cancelled) return;
        setServices((prev) =>
          prev ? { ...prev, runtime: next, titleByKey: titles } : prev,
        );
      };

      if (cancelled) return;
      setServices({
        store,
        events,
        runtime,
        coordinator,
        titleByKey,
        collectionKeysRef,
        reloadRuntime: reload,
      });
    })().catch((e) => {
      if (!cancelled)
        setBootError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      storeRef?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootError) {
    return (
      <div className="boot-screen">
        <h1>余境</h1>
        <p>展览数据初始化失败：{bootError}</p>
      </div>
    );
  }
  if (!services) {
    return (
      <div className="boot-screen">
        <h1>余境</h1>
        <p>正在布置展厅…</p>
      </div>
    );
  }
  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}
