export type Format = "srt" | "vtt";
export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}
export type IssueType =
  | "overlap"
  | "too-short"
  | "too-fast"
  | "too-long"
  | "empty"
  | "invalid-time";
export interface SubtitleIssue {
  id: string;
  cueId: string;
  type: IssueType;
  severity: "info" | "warning" | "error";
  message: string;
}
export interface SubtitleProject {
  id: string;
  name: string;
  format: Format;
  cues: SubtitleCue[];
  updatedAt: number;
  versions: Array<{
    id: string;
    label: string;
    savedAt: number;
    cues: SubtitleCue[];
  }>;
}
export interface MeterState {
  phase: "empty" | "importing" | "ready" | "editing" | "exporting" | "error";
  project: SubtitleProject | null;
  issues: SubtitleIssue[];
  selectedId: string | null;
  notice: string;
  zoom: number;
  /** 时间轴可视范围终点；载入项目时确定，拖动条目不会改变它 */
  viewEndMs: number;
  /** 是否存在可撤销的上一次拖动 */
  canUndoDrag: boolean;
}
export const emptyState = (): MeterState => ({
  phase: "empty",
  project: null,
  issues: [],
  selectedId: null,
  notice: "",
  zoom: 1,
  viewEndMs: 0,
  canUndoDrag: false,
});
