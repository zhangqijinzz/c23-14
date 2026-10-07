import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { SubtitleCue, SubtitleProject } from "../models";
import { computeCueMove } from "../timelineDrag";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
interface DragPreview {
  cueId: string;
  startMs: number;
  endMs: number;
  originStartMs: number;
  originEndMs: number;
  clampedTo: "start" | "end" | null;
}
const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
export function TimelineModule({
  project,
  vm,
  selectedId,
  zoom,
  viewEndMs,
  canUndoDrag,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  selectedId: string | null;
  zoom: number;
  viewEndMs: number;
  canUndoDrag: boolean;
}) {
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [dragNote, setDragNote] = useState("");
  const suppressClick = useRef(false);
  const trackPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    cue: SubtitleCue,
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    const x0 = event.clientX,
      origin = { startMs: cue.startMs, endMs: cue.endMs },
      trackWidth =
        event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
    let move = computeCueMove(origin, 0, {
      minStartMs: 0,
      maxEndMs: viewEndMs,
    });
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const desired = Math.round(
        ((moveEvent.clientX - x0) / trackWidth) * viewEndMs,
      );
      move = computeCueMove(origin, desired, {
        minStartMs: 0,
        maxEndMs: viewEndMs,
      });
      setPreview({
        cueId: cue.id,
        startMs: move.startMs,
        endMs: move.endMs,
        originStartMs: origin.startMs,
        originEndMs: origin.endMs,
        clampedTo: move.clampedTo,
      });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onDone);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
    const onCancel = () => {
      cleanup();
      setPreview(null);
      setDragNote("已取消拖动，条目保持原位");
    };
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") onCancel();
    };
    const onDone = () => {
      cleanup();
      setPreview(null);
      if (move.startMs === origin.startMs && move.endMs === origin.endMs)
        return;
      suppressClick.current = true;
      setDragNote(
        move.clampedTo === "start"
          ? "已到时间轴起点，无法更早；如需精确时间请在「问题检查」中输入"
          : move.clampedTo === "end"
            ? "已到时间轴末尾，无法更晚；如需精确时间请在「问题检查」中输入"
            : "",
      );
      void vm.moveCue(cue.id, move.shiftMs);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onDone, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    window.addEventListener("keydown", onKey);
  };
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
        <span>{(viewEndMs / 2000).toFixed(0)}s</span>
        <span>{(viewEndMs / 1000).toFixed(0)}s</span>
      </div>
      <div className="timeline-track" style={{ minWidth: `${zoom * 100}%` }}>
        {preview && (
          <span
            aria-hidden
            className="timeline-cue ghost"
            style={{
              // 与 .timeline-cue 的 3n 行位置模式保持一致，让虚影落在原行
              top: `${[23, 5, 45][project.cues.findIndex((item) => item.id === preview.cueId) % 3]}px`,
              left: `${(preview.originStartMs / viewEndMs) * 100}%`,
              width: `${Math.max(2.5, ((preview.originEndMs - preview.originStartMs) / viewEndMs) * 100)}%`,
            }}
          />
        )}
        {project.cues.map((cue) => {
          const shown = preview?.cueId === cue.id ? preview : cue;
          return (
            <button
              key={cue.id}
              title={`第 ${cue.index} 条 · ${formatSeconds(shown.startMs)} – ${formatSeconds(shown.endMs)}`}
              className={`timeline-cue ${selectedId === cue.id ? "selected" : ""} ${preview?.cueId === cue.id ? "dragging" : ""}`}
              style={{
                left: `${(shown.startMs / viewEndMs) * 100}%`,
                width: `${Math.max(2.5, ((shown.endMs - shown.startMs) / viewEndMs) * 100)}%`,
              }}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                vm.selectCue(cue.id);
              }}
              onPointerDown={(event) => trackPointerDown(event, cue)}
            >
              {cue.index}
            </button>
          );
        })}
      </div>
      <div className="timeline-hint">
        {preview ? (
          <span className="timeline-status">
            拖动中：{formatSeconds(preview.startMs)} –{" "}
            {formatSeconds(preview.endMs)}
            {preview.clampedTo === "start"
              ? "（已到起点）"
              : preview.clampedTo === "end"
                ? "（已到末尾）"
                : ""}
            · 松开生效，Esc 取消
          </span>
        ) : (
          <span className="timeline-status">
            {dragNote || "拖动时间块调整起止位置 · 点击条目进行编辑"}
          </span>
        )}
        {canUndoDrag && (
          <button
            className="timeline-undo"
            onClick={() => void vm.undoLastDrag()}
          >
            撤销上次拖动
          </button>
        )}
      </div>
    </section>
  );
}
