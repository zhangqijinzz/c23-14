import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";
vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(
    async () => "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
  ),
}));
vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => null),
  },
}));
vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));
describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vm = new SubtitleMeterViewModel();
  });
  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });
  it("keeps a recoverable error when an unsupported import is selected", async () => {
    await vm.importFile(new File(["x"], "clip.txt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("仅支持");
  });
  it("shows a parse failure as a recoverable import error", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("缺少时间码");
  });
  it("keeps editing visible immediately and reports export failures", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    const cue = vm.state.project!.cues[0];
    const saving = vm.editCue(cue.id, { text: "Immediate edit" });
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
    await saving;
    vi.mocked(downloadSubtitles).mockImplementationOnce(() => {
      throw new Error("download unavailable");
    });
    await vm.exportFile();
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("导出失败");
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
  });
  describe("timeline dragging", () => {
    const twoCues =
      "1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond";
    beforeEach(async () => {
      vi.mocked(readTextFile).mockResolvedValueOnce(twoCues);
      await vm.importFile(new File(["x"], "clip.srt"));
    });
    it("clamps a left drag at the view start without squashing the cue", async () => {
      const cue = vm.state.project!.cues[0];
      const move = await vm.moveCue(cue.id, -99_000);
      const dragged = vm.state.project!.cues[0];
      expect(move?.clampedTo).toBe("start");
      expect(dragged.startMs).toBe(0);
      expect(dragged.endMs - dragged.startMs).toBe(2000);
      expect(dragged.endMs).toBeGreaterThan(dragged.startMs);
    });
    it("clamps a right drag at the view end and keeps the view range stable", async () => {
      const before = vm.state.viewEndMs;
      const other = vm.state.project!.cues[0];
      const cue = vm.state.project!.cues[1];
      const move = await vm.moveCue(cue.id, 99_000);
      const dragged = vm.state.project!.cues[1];
      expect(move?.clampedTo).toBe("end");
      expect(dragged.endMs).toBe(before);
      expect(dragged.endMs - dragged.startMs).toBe(1000);
      expect(vm.state.viewEndMs).toBe(before);
      expect(vm.state.project!.cues[0]).toEqual(other);
    });
    it("moves a cue rigidly inside the view range", async () => {
      const cue = vm.state.project!.cues[0];
      await vm.moveCue(cue.id, 500);
      const dragged = vm.state.project!.cues[0];
      expect(dragged.startMs).toBe(1500);
      expect(dragged.endMs).toBe(3500);
      expect(vm.state.canUndoDrag).toBe(true);
    });
    it("undoes the last drag and restores the previous times", async () => {
      const cue = vm.state.project!.cues[0];
      await vm.moveCue(cue.id, 500);
      await vm.undoLastDrag();
      const restored = vm.state.project!.cues[0];
      expect(restored.startMs).toBe(1000);
      expect(restored.endMs).toBe(3000);
      expect(vm.state.canUndoDrag).toBe(false);
      expect(vm.state.notice).toBe("已撤销上次拖动");
    });
    it("a precise edit clears the drag undo and grows the view range when needed", async () => {
      const cue = vm.state.project!.cues[0];
      await vm.moveCue(cue.id, 500);
      expect(vm.state.canUndoDrag).toBe(true);
      await vm.editCue(cue.id, { endMs: 9000 });
      expect(vm.state.canUndoDrag).toBe(false);
      expect(vm.state.viewEndMs).toBe(9000);
      await vm.undoLastDrag();
      expect(vm.state.project!.cues[0].endMs).toBe(9000);
    });
  });
});
