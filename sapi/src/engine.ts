/**
 * 内存空间索引与特性插槽调度。
 */

import type { Player } from "@minecraft/server";
import { debug } from "@sfmc-bds/sdk/sapi/runtime";
import {
  pointInBox,
  toBox,
  type AreaContext,
  type AreaDefinition,
  type AreaFeatureHandler,
} from "./types.js";

const areas = new Map<string, AreaDefinition>();
const features = new Map<string, AreaFeatureHandler>();
/** playerId → 当前所处区域名集合 */
const playerCurrentAreas = new Map<string, Set<string>>();

export function clearAll(): void {
  areas.clear();
  features.clear();
  playerCurrentAreas.clear();
}

export function listAreas(dimension?: string): AreaDefinition[] {
  const all = [...areas.values()];
  if (!dimension) return all;
  return all.filter((a) => a.dimension === dimension);
}

export function getAreaByName(name: string): AreaDefinition | null {
  return areas.get(name) ?? null;
}

export function registerArea(def: AreaDefinition): { ok: boolean } {
  if (!def?.name || !def.dimension || !def.start || !def.end) {
    return { ok: false };
  }
  const normalized: AreaDefinition = {
    name: def.name,
    dimension: def.dimension,
    start: def.start,
    end: def.end,
    features: def.features ?? {},
    dynamic: def.dynamic ?? true,
  };
  areas.set(normalized.name, normalized);
  return { ok: true };
}

export function unregisterArea(name: string): { ok: boolean } {
  const existed = areas.delete(name);
  if (existed) {
    for (const set of playerCurrentAreas.values()) set.delete(name);
  }
  return { ok: existed };
}

export function registerFeature(handler: AreaFeatureHandler): { ok: boolean } {
  if (!handler?.id || typeof handler !== "object") return { ok: false };
  features.set(handler.id, handler);
  return { ok: true };
}

export function byPoint(opts: {
  dimension: string;
  x: number;
  z: number;
  feature?: string;
}): AreaDefinition | null {
  for (const area of areas.values()) {
    if (area.dimension !== opts.dimension) continue;
    const box = toBox(area.start, area.end);
    if (!pointInBox(opts.x, opts.z, box)) continue;
    if (opts.feature && !(opts.feature in (area.features ?? {}))) continue;
    return area;
  }
  return null;
}

function buildContext(area: AreaDefinition, featureId: string): AreaContext {
  const params = (area.features?.[featureId] ?? {}) as Record<string, unknown>;
  return {
    name: area.name,
    dimension: area.dimension,
    box: toBox(area.start, area.end),
    params,
  };
}

function dispatchEnter(player: Player, area: AreaDefinition): void {
  for (const featureId of Object.keys(area.features ?? {})) {
    const handler = features.get(featureId);
    if (!handler) {
      debug.w("Area", `区域 ${area.name} 声明特性 ${featureId} 未注册，已跳过`);
      continue;
    }
    try {
      handler.onEnter?.(player, buildContext(area, featureId), buildContext(area, featureId).params);
    } catch (err) {
      debug.e(
        "Area",
        `onEnter ${featureId}@${area.name} failed`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

function dispatchLeave(player: Player, area: AreaDefinition): void {
  for (const featureId of Object.keys(area.features ?? {})) {
    const handler = features.get(featureId);
    if (!handler) continue;
    try {
      handler.onLeave?.(player, buildContext(area, featureId), buildContext(area, featureId).params);
    } catch (err) {
      debug.e(
        "Area",
        `onLeave ${featureId}@${area.name} failed`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

/** 扫描一名玩家的进出边界。 */
export function scanPlayer(player: Player): void {
  const dim = player.dimension.id;
  const { x, z } = player.location;
  const next = new Set<string>();
  for (const area of areas.values()) {
    if (area.dimension !== dim) continue;
    if (pointInBox(x, z, toBox(area.start, area.end))) next.add(area.name);
  }
  const prev = playerCurrentAreas.get(player.id) ?? new Set<string>();
  for (const name of next) {
    if (!prev.has(name)) {
      const area = areas.get(name);
      if (area) dispatchEnter(player, area);
    }
  }
  for (const name of prev) {
    if (!next.has(name)) {
      const area = areas.get(name);
      if (area) dispatchLeave(player, area);
    }
  }
  playerCurrentAreas.set(player.id, next);
}

/** 玩家离线：对其当前区域触发 onLeave。 */
export function handlePlayerLeave(playerId: string, player: Player | undefined): void {
  const prev = playerCurrentAreas.get(playerId);
  if (!prev || prev.size === 0) {
    playerCurrentAreas.delete(playerId);
    return;
  }
  for (const name of prev) {
    const area = areas.get(name);
    if (!area || !player) continue;
    dispatchLeave(player, area);
  }
  playerCurrentAreas.delete(playerId);
}

/** 周期 onTick 派发。 */
export function tickAllAreas(): void {
  for (const area of areas.values()) {
    for (const featureId of Object.keys(area.features ?? {})) {
      const handler = features.get(featureId);
      if (!handler?.onTick) {
        if (!handler && featureId) {
          // 未注册特性已在 enter 时告警，此处静默
        }
        continue;
      }
      try {
        const ctx = buildContext(area, featureId);
        handler.onTick(ctx, ctx.params);
      } catch (err) {
        debug.e(
          "Area",
          `onTick ${featureId}@${area.name} failed`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }
}

/** 用配置覆盖静态区域（保留 dynamic 区域）。 */
export function replaceStaticAreas(defs: AreaDefinition[]): void {
  for (const [name, area] of [...areas.entries()]) {
    if (!area.dynamic) areas.delete(name);
  }
  for (const def of defs) {
    areas.set(def.name, { ...def, features: def.features ?? {}, dynamic: false });
  }
}
