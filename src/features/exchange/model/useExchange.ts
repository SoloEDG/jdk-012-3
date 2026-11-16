import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "../../exhibition/ServicesProvider";
import type { ImportState } from "../../../shared/exchange/coordinator";
import type {
  ExchangeEvent,
  MigrationEntry,
  StoredExhibition,
} from "../../../shared/exchange/types";
import type { CapacitySnapshot } from "../../../shared/exchange/storeTypes";
import { META_BUDGET } from "../../../shared/exchange/storeTypes";
import { generateSample, type SampleVariant } from "../lib/samples";
import { buildExportPack, downloadPack } from "../lib/exporter";

/** 交换面板的数据与操作集合 */
export function useExchange() {
  const { coordinator, events, store } = useServices();
  const [importState, setImportState] = useState<ImportState>(
    coordinator.current,
  );
  const [log, setLog] = useState<ExchangeEvent[]>(events.log);
  const [capacity, setCapacity] = useState<CapacitySnapshot | null>(null);
  const [migrations, setMigrations] = useState<MigrationEntry[]>([]);
  const [exhibitions, setExhibitions] = useState<StoredExhibition[]>([]);
  const [busySample, setBusySample] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [snap, ms, es] = await Promise.all([
      store.capacitySnapshot(),
      store.listMigrations(),
      store.listExhibitions(),
    ]);
    setCapacity(snap);
    setMigrations(ms);
    setExhibitions(es);
  }, [store]);

  useEffect(() => {
    void refresh();
    return events.subscribe(() => {
      setImportState({ ...coordinator.current });
      setLog([...events.log]);
      void refresh();
    });
  }, [coordinator, events, refresh]);

  const importFile = useCallback(
    (file: File) => {
      void coordinator.begin(file.name, () => file.text());
    },
    [coordinator],
  );

  const importSample = useCallback(
    async (variant: SampleVariant) => {
      setBusySample(variant);
      try {
        const { name, text } = await generateSample(variant);
        await coordinator.begin(name, async () => text);
      } finally {
        setBusySample(null);
      }
    },
    [coordinator],
  );

  const exportActive = useCallback(async () => {
    const pack = await buildExportPack(store);
    downloadPack(pack);
    events.emit("boot", `已导出「${pack.exhibition.title}」策展包`);
  }, [store, events]);

  const evict = useCallback(
    async (ids: string[]) => {
      const freed = await store.evictArchived(ids);
      events.emit("eviction", `手动回收归档资源，释放 ${freed} 字节`);
      await refresh();
    },
    [store, events, refresh],
  );

  const setBudget = useCallback(
    async (bytes: number) => {
      await store.setMeta(META_BUDGET, Math.max(1024 * 1024, bytes));
      events.emit("capacity", `容量预算已调整为 ${bytes} 字节`);
      await refresh();
    },
    [store, events, refresh],
  );

  return {
    importState,
    log,
    capacity,
    migrations,
    exhibitions,
    busySample,
    fileInput,
    importFile,
    importSample,
    exportActive,
    evict,
    setBudget,
    confirm: () => coordinator.confirm(),
    cancel: () => coordinator.cancel(),
    reset: () => coordinator.reset(),
  };
}
