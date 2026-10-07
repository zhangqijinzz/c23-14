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
import { initialTimelineMs, moveCueRange } from "../timeline";
export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
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
          timelineMs: initialTimelineMs(project.cues),
          lastDrag: null,
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
      const timelineMs = initialTimelineMs(cues);
      this.publish({
        selectedId: cues[0].id,
        notice: `已解析 ${cues.length} 条字幕`,
        timelineMs,
        lastDrag: null,
      });
      await this.commit(project, "ready", { timelineMs });
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
    this.publish({ lastDrag: null });
    await this.commit({ ...this.state.project, cues });
  }
  /**
   * 拖动提交：在固定的可视范围内夹取起止时间（保持时长、补齐最小可读时长），
   * 记录拖动前的快照以便撤销；越界时返回明确提示。
   */
  async moveCue(id: string, shiftMs: number) {
    const project = this.state.project;
    if (!project) return;
    const cue = project.cues.find((item) => item.id === id);
    if (!cue || shiftMs === 0) return;
    const { startMs, endMs, clamped } = moveCueRange(
      cue,
      shiftMs,
      this.state.timelineMs,
    );
    if (startMs === cue.startMs && endMs === cue.endMs) return;
    const cues = project.cues.map((item) =>
      item.id === id ? { ...item, startMs, endMs } : item,
    );
    this.publish({
      lastDrag: {
        cueId: id,
        startMs: cue.startMs,
        endMs: cue.endMs,
      },
    });
    await this.commit({ ...project, cues });
    if (clamped && this.state.phase !== "error")
      this.publish({
        notice:
          startMs === 0
            ? "已到时间轴起点，无法继续左移"
            : "已到时间轴末尾，无法继续右移",
      });
  }
  async undoLastDrag() {
    const project = this.state.project;
    const lastDrag = this.state.lastDrag;
    if (!project || !lastDrag) return;
    const cues = project.cues.map((cue) =>
      cue.id === lastDrag.cueId
        ? { ...cue, startMs: lastDrag.startMs, endMs: lastDrag.endMs }
        : cue,
    );
    this.publish({ lastDrag: null });
    await this.commit({ ...project, cues });
    this.publish({ notice: "已撤销本次拖动" });
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
    this.publish({ lastDrag: null });
    await this.commit({ ...project, cues: structuredClone(version.cues) });
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
