/**
 * @sfmc-bds/module-area — 空间微内核与特性插槽
 */

import { Player, system, world } from "@minecraft/server";
import { config } from "@sfmc-bds/sdk/sapi/config";
import { ModuleRegistry } from "@sfmc-bds/sdk/module-loader";
import { debug } from "@sfmc-bds/sdk/sapi/runtime";
import { service } from "@sfmc-bds/sdk/sapi/service";
import {
  byPoint,
  clearAll,
  getAreaByName,
  handlePlayerLeave,
  listAreas,
  registerArea,
  registerFeature,
  replaceStaticAreas,
  scanPlayer,
  tickAllAreas,
  unregisterArea,
} from "./engine.js";
import type { AreaDefinition, AreaFeatureHandler } from "./types.js";

const MODULE_ID = "area";

const unprovide: Array<() => void> = [];
const eventCleanups: Array<() => void> = [];
let scanRunId: number | undefined;
let scanIntervalTicks = 20;

/** 在线玩家缓存（leave 事件可能拿不到完整 Player）。 */
const onlinePlayers = new Map<string, Player>();

function normalizeAreas(raw: unknown): AreaDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: AreaDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    const dimension = typeof o.dimension === "string" ? o.dimension : "";
    const start = Array.isArray(o.start) ? (o.start as [number, number]) : null;
    const end = Array.isArray(o.end) ? (o.end as [number, number]) : null;
    if (!name || !dimension || !start || !end) continue;
    const features =
      o.features && typeof o.features === "object"
        ? (o.features as Record<string, Record<string, unknown>>)
        : {};
    // 兼容旧布尔开关：true → {}
    const normalizedFeatures: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
      if (v === true) normalizedFeatures[k] = {};
      else if (v && typeof v === "object") normalizedFeatures[k] = v as Record<string, unknown>;
    }
    out.push({ name, dimension, start, end, features: normalizedFeatures, dynamic: false });
  }
  return out;
}

async function loadConfigAreas(): Promise<void> {
  const areas = normalizeAreas(await config.get("areas"));
  const interval = await config.get<number>("scan_interval_ticks");
  if (typeof interval === "number" && interval > 0) scanIntervalTicks = interval;
  replaceStaticAreas(areas);
}

ModuleRegistry.register({
  id: MODULE_ID,
  afterWorldLoad: true,
  lifecycle: {
    registerPermissions() {
      // 无玩家命令
    },
    registerCommands() {
      // 无
    },
    registerEvents() {
      const leaveCb = world.afterEvents.playerLeave.subscribe((ev) => {
        const cached = onlinePlayers.get(ev.playerId);
        handlePlayerLeave(ev.playerId, cached);
        onlinePlayers.delete(ev.playerId);
      });
      eventCleanups.push(() => {
        try {
          world.afterEvents.playerLeave.unsubscribe(leaveCb);
        } catch {
          /* ignore */
        }
      });

      const spawnCb = world.afterEvents.playerSpawn.subscribe((ev) => {
        onlinePlayers.set(ev.player.id, ev.player);
        scanPlayer(ev.player);
      });
      eventCleanups.push(() => {
        try {
          world.afterEvents.playerSpawn.unsubscribe(spawnCb);
        } catch {
          /* ignore */
        }
      });
    },
    async init() {
      await loadConfigAreas();
      config.onChange((key) => {
        if (key === "areas" || key === "scan_interval_ticks") void loadConfigAreas();
      });

      for (const p of world.getAllPlayers()) {
        onlinePlayers.set(p.id, p);
        scanPlayer(p);
      }

      scanRunId = system.runInterval(() => {
        for (const p of world.getAllPlayers()) {
          onlinePlayers.set(p.id, p);
          scanPlayer(p);
        }
        tickAllAreas();
      }, scanIntervalTicks);

      unprovide.push(
        service.provide("area.registerFeature", (input) => {
          const id = typeof input.id === "string" ? input.id : "";
          const raw = (input.handler ?? input) as AreaFeatureHandler;
          const handler: AreaFeatureHandler = {
            ...raw,
            id: raw.id || id,
          };
          return registerFeature(handler);
        }),
      );
      unprovide.push(
        service.provide("area.registerArea", (input) =>
          registerArea({ ...(input as unknown as AreaDefinition), dynamic: true }),
        ),
      );
      unprovide.push(
        service.provide("area.unregisterArea", (input) =>
          unregisterArea(String(input.name ?? "")),
        ),
      );
      unprovide.push(
        service.provide("area.byName", (input) => getAreaByName(String(input.name ?? ""))),
      );
      unprovide.push(
        service.provide("area.byPoint", (input) =>
          byPoint({
            dimension: String(input.dimension ?? ""),
            x: Number(input.x),
            z: Number(input.z),
            feature: typeof input.feature === "string" ? input.feature : undefined,
          }),
        ),
      );
      unprovide.push(
        service.provide("area.listAreas", (input) =>
          listAreas(typeof input.dimension === "string" ? input.dimension : undefined),
        ),
      );

      debug.i("Area", `init areas=${listAreas().length} interval=${scanIntervalTicks}`);
    },
    cleanup() {
      for (const off of unprovide.splice(0, unprovide.length)) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      for (const c of eventCleanups.splice(0, eventCleanups.length)) c();
      if (scanRunId !== undefined) {
        try {
          system.clearRun(scanRunId);
        } catch {
          /* ignore */
        }
        scanRunId = undefined;
      }
      clearAll();
      onlinePlayers.clear();
      debug.i("Area", "cleanup");
    },
  },
});
