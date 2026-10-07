import type { SubtitleCue } from "./models";
/**
 * 与 issueDetector 的 too-short 阈值保持一致：
 * 拖动结果永远不低于这个最小可读时长。
 */
export const MIN_READABLE_DURATION_MS = 800;
export interface CueMoveBounds {
  /** 可视范围起点（通常为 0） */
  minStartMs: number;
  /** 可视范围终点，拖动不允许把条目推出它之外 */
  maxEndMs: number;
  /** 最小可读时长，缺省用 MIN_READABLE_DURATION_MS */
  minDurationMs?: number;
}
export interface CueMove {
  startMs: number;
  endMs: number;
  /** 实际应用的位移（钳制之后） */
  shiftMs: number;
  /** 位移被哪一侧边界钳制；未越界为 null */
  clampedTo: "start" | "end" | null;
}
/**
 * 计算一次“整体平移”拖动的结果。
 * 保证：
 * - 起止先后关系：endMs 始终大于 startMs（原始时长非法时修复为最小可读时长）；
 * - 时长不被压缩：平移是刚性的，拖到边界只会停下，不会把条目挤扁；
 * - 不越界：结果始终落在 [minStartMs, maxEndMs] 内。
 */
export function computeCueMove(
  cue: Pick<SubtitleCue, "startMs" | "endMs">,
  desiredShiftMs: number,
  bounds: CueMoveBounds,
): CueMove {
  const minDuration = Math.max(
    1,
    bounds.minDurationMs ?? MIN_READABLE_DURATION_MS,
  );
  const duration = Math.max(cue.endMs - cue.startMs, minDuration);
  const minShift = bounds.minStartMs - cue.startMs;
  const maxShift = Math.max(minShift, bounds.maxEndMs - duration - cue.startMs);
  const shiftMs = Math.min(Math.max(desiredShiftMs, minShift), maxShift);
  // 按实际停下的边界报告；未越界（位移未被钳制）为 null
  const clampedTo =
    shiftMs === desiredShiftMs ? null : shiftMs <= minShift ? "start" : "end";
  return {
    startMs: cue.startMs + shiftMs,
    endMs: cue.startMs + shiftMs + duration,
    shiftMs,
    clampedTo,
  };
}
/**
 * 项目载入时的可视范围：覆盖全部条目，最小 1 秒。
 * 只在导入 / 恢复 / 还原版本时重算，拖动本身永远不会改变它。
 */
export function computeViewEndMs(
  cues: ReadonlyArray<Pick<SubtitleCue, "endMs">>,
): number {
  return Math.max(1000, ...cues.map((cue) => cue.endMs));
}
