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
  it("clamps drags to a fixed visible range and lets the last drag be undone", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce(
      "1\n00:00:01,000 --> 00:00:03,000\nA\n\n2\n00:00:04,000 --> 00:00:05,500\nB",
    );
    await vm.importFile(new File(["x"], "two.srt"));
    const range = vm.state.timelineMs;
    expect(range).toBe(6000);
    const [first, last] = vm.state.project!.cues;

    // 向左越过起点：停在 0 且时长不变，不会产生非法时间。
    await vm.moveCue(first.id, -99999);
    let movedFirst = vm.state.project!.cues[0];
    expect(movedFirst.startMs).toBe(0);
    expect(movedFirst.endMs - movedFirst.startMs).toBe(2000);
    expect(vm.state.timelineMs).toBe(6000); // 可视范围没有因拖动改变
    expect(vm.state.issues.some((i) => i.type === "invalid-time")).toBe(false);
    expect(vm.state.lastDrag?.cueId).toBe(first.id);

    // 再向右越过末尾：停在范围边界，标尺范围仍不跳变。
    await vm.moveCue(first.id, 99999);
    movedFirst = vm.state.project!.cues[0];
    expect(movedFirst.endMs).toBe(6000);
    expect(movedFirst.startMs).toBe(4000);
    expect(vm.state.timelineMs).toBe(6000);
    // 另一条完全不受影响，没有被“整体挪动”。
    const untouched = vm.state.project!.cues.find((c) => c.id === last.id)!;
    expect(untouched).toMatchObject({ startMs: 4000, endMs: 5500 });

    // 撤销回退到上一次拖动之前（即左移后停在起点的位置）。
    await vm.undoLastDrag();
    const undone = vm.state.project!.cues[0];
    expect(undone).toMatchObject({ startMs: 0, endMs: 2000 });
    expect(vm.state.lastDrag).toBeNull();
  });
});
