import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  emptyState,
  type Format,
  type MeterState,
  type SubtitleCue,
  type SubtitleProject,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
import {
  computeCueMove,
  computeViewEndMs,
  type CueMove,
} from "../timelineDrag";
export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  /** 上一次拖动前，被拖动条目的起止时间，用于撤销 */
  private dragUndo: Pick<SubtitleCue, "id" | "startMs" | "endMs"> | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
    extra: Partial<MeterState> = {},
  ) {
    project.updatedAt = Date.now();
    const issues = detectIssues(project.cues);
    this.publish({ project, issues, phase, notice: "", ...extra });
    try {
      await projectRepository.save(project);
    } catch {
      if (this.state.project?.updatedAt === project.updatedAt) {
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
      }
    }
  }
  async restore() {
    try {
      const project = await projectRepository.load();
      if (project)
        this.publish({
          project,
          issues: detectIssues(project.cues),
          phase: "ready",
          selectedId: project.cues[0]?.id ?? null,
          notice: "已恢复上次编辑",
          viewEndMs: computeViewEndMs(project.cues),
          canUndoDrag: false,
        });
    } catch {
      this.publish({ notice: "本地项目暂时无法读取，可继续导入字幕文件" });
    }
  }
  async importFile(file: File) {
    this.publish({ phase: "importing", notice: "正在读取并解析字幕文件…" });
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      const project: SubtitleProject = {
        id: "subtitle-meter.current.v1",
        name: file.name,
        format,
        cues,
        updatedAt: Date.now(),
        versions: [],
      };
      this.publish({
        selectedId: cues[0].id,
        notice: `已解析 ${cues.length} 条字幕`,
      });
      this.dragUndo = null;
      await this.commit(project, "ready", {
        viewEndMs: computeViewEndMs(cues),
        canUndoDrag: false,
      });
    } catch (error) {
      this.publish({
        phase: "error",
        notice:
          error instanceof Error ? error.message : "导入失败，请检查文件后重试",
      });
    }
  }
  selectCue(id: string) {
    this.publish({ selectedId: id });
  }
  setZoom(zoom: number) {
    this.publish({ zoom });
  }
  async editCue(
    id: string,
    patch: Partial<Pick<SubtitleCue, "text" | "startMs" | "endMs">>,
  ) {
    if (!this.state.project) return;
    const cues = this.state.project.cues.map((cue) =>
      cue.id === id ? { ...cue, ...patch } : cue,
    );
    // 精确编辑超出可视范围时扩展范围；拖动（moveCue）永远不会走到这里
    const viewEndMs = Math.max(this.state.viewEndMs, computeViewEndMs(cues));
    this.dragUndo = null;
    await this.commit({ ...this.state.project, cues }, "editing", {
      viewEndMs,
      canUndoDrag: false,
    });
  }
  /**
   * 拖动条目：在当前可视范围内整体平移，时长保持不变。
   * 越界时钳制在边界上，可视范围本身不会因此改变。
   */
  async moveCue(id: string, desiredShiftMs: number): Promise<CueMove | null> {
    const project = this.state.project;
    const cue = project?.cues.find((item) => item.id === id);
    if (!project || !cue) return null;
    const move = computeCueMove(cue, desiredShiftMs, {
      minStartMs: 0,
      maxEndMs: this.state.viewEndMs,
    });
    if (move.startMs === cue.startMs && move.endMs === cue.endMs) return move;
    this.dragUndo = { id: cue.id, startMs: cue.startMs, endMs: cue.endMs };
    const cues = project.cues.map((item) =>
      item.id === id
        ? { ...item, startMs: move.startMs, endMs: move.endMs }
        : item,
    );
    await this.commit({ ...project, cues }, "editing", {
      canUndoDrag: true,
    });
    return move;
  }
  /** 撤销上一次拖动，把被拖动的条目恢复到拖动前的起止时间 */
  async undoLastDrag() {
    const project = this.state.project;
    const undo = this.dragUndo;
    if (!project || !undo) return;
    if (!project.cues.some((cue) => cue.id === undo.id)) return;
    this.dragUndo = null;
    const cues = project.cues.map((cue) =>
      cue.id === undo.id
        ? { ...cue, startMs: undo.startMs, endMs: undo.endMs }
        : cue,
    );
    await this.commit({ ...project, cues }, "editing", {
      canUndoDrag: false,
      notice: "已撤销上次拖动",
    });
  }
  async saveVersion() {
    const project = this.state.project;
    if (!project) return;
    const versions = [
      ...project.versions,
      {
        id: `v-${Date.now()}`,
        label: `快照 ${project.versions.length + 1}`,
        savedAt: Date.now(),
        cues: structuredClone(project.cues),
      },
    ];
    await this.commit({ ...project, versions });
    this.publish({ notice: "已保存版本快照" });
  }
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    const cues = structuredClone(version.cues);
    this.dragUndo = null;
    await this.commit({ ...project, cues }, "editing", {
      viewEndMs: computeViewEndMs(cues),
      canUndoDrag: false,
    });
    this.publish({ notice: `已恢复${version.label}` });
  }
  async exportFile() {
    const project = this.state.project;
    if (!project) return;
    this.publish({ phase: "exporting" });
    try {
      formatSubtitles(project.cues, project.format);
      downloadSubtitles(project.name, project.cues, project.format);
      this.publish({ phase: "ready", notice: "字幕文件已导出" });
    } catch {
      this.publish({
        phase: "error",
        notice: "导出失败，编辑内容已保留，请重试",
      });
    }
  }
  setFormat(format: Format) {
    const project = this.state.project;
    if (project) void this.commit({ ...project, format });
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
