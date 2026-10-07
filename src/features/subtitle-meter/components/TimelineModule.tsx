import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SubtitleCue, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { formatClock, moveCueRange } from "../timeline";

interface DragPreview {
  cueId: string;
  startMs: number;
  endMs: number;
  clamped: boolean;
}

export function TimelineModule({
  project,
  vm,
  selectedId,
  zoom,
  timelineMs,
  lastDrag,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  selectedId: string | null;
  zoom: number;
  timelineMs: number;
  lastDrag: { cueId: string } | null;
}) {
  const [drag, setDrag] = useState<DragPreview | null>(null);

  useEffect(() => () => setDrag(null), []);

  const trackPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cue: SubtitleCue,
  ) => {
    // 只响应主键拖动；避免与点击选中冲突。
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const x0 = event.clientX;
    const trackWidth =
      event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;

    let frame: number | null = null;
    let shiftMs = 0;
    let cancelled = false;

    const schedulePreview = () => {
      frame = null;
      const next = moveCueRange(cue, shiftMs, timelineMs);
      setDrag({
        cueId: cue.id,
        startMs: next.startMs,
        endMs: next.endMs,
        clamped: next.clamped,
      });
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      shiftMs = ((moveEvent.clientX - x0) / trackWidth) * timelineMs;
      if (frame === null) frame = requestAnimationFrame(schedulePreview);
    };
    const finish = () => {
      // 直接用最终位移提交（VM 内部会做同样的边界夹取），
      // 避免最后一帧预览尚未应用就被 cleanup 取消而丢失位置。
      const finalShift = Math.round(shiftMs);
      cleanup();
      setDrag(null);
      if (!cancelled && finalShift !== 0) void vm.moveCue(cue.id, finalShift);
    };
    const cancel = () => {
      cancelled = true;
      cleanup();
      setDrag(null);
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") cancel();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKeyDown);
      if (frame !== null) cancelAnimationFrame(frame);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("keydown", onKeyDown);
  };

  const displayCue = (cue: SubtitleCue) =>
    drag && drag.cueId === cue.id
      ? { ...cue, startMs: drag.startMs, endMs: drag.endMs }
      : cue;

  return (
    <section className="module timeline-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">02 / TIMELINE</span>
          <h2>时间轴分布</h2>
        </div>
        <label className="zoom-control">
          缩放{" "}
          <input
            aria-label="时间轴缩放"
            type="range"
            min="0.6"
            max="2"
            step="0.1"
            value={zoom}
            onChange={(e) => vm.setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="time-ruler">
        <span>00:00</span>
        <span>{formatClock(timelineMs / 2)}</span>
        <span>{formatClock(timelineMs)}</span>
      </div>
      <div className="timeline-track" style={{ minWidth: `${zoom * 100}%` }}>
        {project.cues.map((cue) => {
          const shown = displayCue(cue);
          return (
            <button
              key={cue.id}
              title={`第 ${cue.index} 条 · ${(shown.startMs / 1000).toFixed(2)}s → ${(shown.endMs / 1000).toFixed(2)}s`}
              className={`timeline-cue ${selectedId === cue.id ? "selected" : ""} ${drag?.cueId === cue.id ? "dragging" : ""}`}
              style={{
                left: `${(shown.startMs / timelineMs) * 100}%`,
                width: `${((shown.endMs - shown.startMs) / timelineMs) * 100}%`,
              }}
              onClick={() => vm.selectCue(cue.id)}
              onPointerDown={(event) => trackPointerDown(event, cue)}
            >
              {cue.index}
            </button>
          );
        })}
      </div>
      <div className="timeline-hint">
        {drag ? (
          <span className="drag-preview-hint" role="status">
            {drag.clamped ? (
              <strong className="drag-clamped">
                {drag.startMs === 0
                  ? "已到起点边界，松手将停在 00:00"
                  : `已到末尾边界，松手将停在 ${formatClock(timelineMs)}`}
              </strong>
            ) : (
              <span>
                预览：{formatClock(drag.startMs)} → {formatClock(drag.endMs)}
              </span>
            )}
            <span className="drag-cancel-hint">按 Esc 取消本次拖动</span>
          </span>
        ) : (
          <>
            <span>
              拖动时间块整体调整时段 · 起止自动保持合法 · 点击条目进行编辑
            </span>
            {lastDrag && (
              <button
                className="drag-undo"
                onClick={() => void vm.undoLastDrag()}
              >
                ↩ 撤销上次拖动
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
