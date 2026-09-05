/**
 * area 类型与微内核契约。
 */

import type { Player } from "@minecraft/server";

export interface AreaBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface AreaDefinition {
  name: string;
  dimension: string;
  start: [number, number];
  end: [number, number];
  features: Record<string, Record<string, unknown>>;
  /** 动态注册标记（非配置文件来源）。 */
  dynamic?: boolean;
}

export interface AreaContext {
  readonly name: string;
  readonly dimension: string;
  readonly box: AreaBox;
  readonly params: Record<string, unknown>;
}

export interface AreaFeatureHandler<TParams = Record<string, unknown>> {
  readonly id: string;
  onEnter?(player: Player, ctx: AreaContext, params: TParams): void;
  onLeave?(player: Player, ctx: AreaContext, params: TParams): void;
  onTick?(ctx: AreaContext, params: TParams): void;
}

export function toBox(start: [number, number], end: [number, number]): AreaBox {
  return {
    minX: Math.min(start[0], end[0]),
    minZ: Math.min(start[1], end[1]),
    maxX: Math.max(start[0], end[0]),
    maxZ: Math.max(start[1], end[1]),
  };
}

export function pointInBox(x: number, z: number, box: AreaBox): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}
