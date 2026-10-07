import type { SubtitleCue } from "./models";

/** 拖动后条目至少保留的可读时长（毫秒），与检查规则中的过短阈值保持一致。 */
export const MIN_CUE_DURATION_MS = 800;

/**
 * 时间轴可视范围在导入/恢复时一次性确定：
 * 向上取整到整秒，且至少 1 秒。之后拖动条目不再改变它，避免整轴跳变。
 */
export function initialTimelineMs(cues: SubtitleCue[]): number {
  const lastEnd = cues.reduce((max, cue) => Math.max(max, cue.endMs), 0);
  return Math.max(1000, Math.ceil(lastEnd / 1000) * 1000);
}

/**
 * 计算整体平移后的起止时间。
 * - 平移保持原始时长不变；
 * - 结果夹在 [0, timelineMs] 内，越界时停在边界而不是被推出；
 * - 短于最小可读时长的条目，以开始时间为锚点补齐结束时间，
 *   避免出现几乎看不见、甚至结束早于开始的极短块。
 * 返回是否在任一边界发生了夹取，用于给出明确提示。
 */
export function moveCueRange(
  cue: SubtitleCue,
  shiftMs: number,
  timelineMs: number,
): { startMs: number; endMs: number; clamped: boolean } {
  const duration = Math.max(cue.endMs - cue.startMs, MIN_CUE_DURATION_MS);
  const maxStart = Math.max(0, timelineMs - duration);
  const rawStart = cue.startMs + shiftMs;
  const startMs = Math.round(Math.min(maxStart, Math.max(0, rawStart)));
  return {
    startMs,
    endMs: startMs + duration,
    clamped: rawStart !== startMs,
  };
}

export function formatClock(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`
    : `${seconds.toFixed(1)}s`;
}
