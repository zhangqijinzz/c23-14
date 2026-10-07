import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "../models";
import {
  initialTimelineMs,
  MIN_CUE_DURATION_MS,
  moveCueRange,
} from "../timeline";

const cue = (startMs: number, endMs: number): SubtitleCue => ({
  id: "c1",
  index: 1,
  startMs,
  endMs,
  text: "字幕",
});

describe("initialTimelineMs", () => {
  it("rounds the last end up to the next whole second with a 1s floor", () => {
    expect(initialTimelineMs([cue(0, 300)])).toBe(1000);
    expect(initialTimelineMs([cue(0, 8900)])).toBe(9000);
    expect(initialTimelineMs([])).toBe(1000);
  });
});

describe("moveCueRange", () => {
  it("keeps the duration while translating within range", () => {
    const r = moveCueRange(cue(2000, 4000), 1500, 10000);
    expect(r).toMatchObject({ startMs: 3500, endMs: 5500, clamped: false });
  });

  it("stops at the left boundary without shrinking or crossing start/end", () => {
    const r = moveCueRange(cue(500, 2500), -9000, 10000);
    expect(r.startMs).toBe(0);
    expect(r.endMs - r.startMs).toBe(2000);
    expect(r.clamped).toBe(true);
  });

  it("stops at the right boundary instead of escaping the visible range", () => {
    const r = moveCueRange(cue(8000, 9500), 9000, 10000);
    expect(r.endMs).toBe(10000);
    expect(r.startMs).toBe(8500);
    expect(r.clamped).toBe(true);
  });

  it("never produces a zero/negative duration even when the cue was already short", () => {
    const r = moveCueRange(cue(100, 300), -50, 10000);
    expect(r.endMs).toBeGreaterThan(r.startMs);
    expect(r.endMs - r.startMs).toBeGreaterThanOrEqual(MIN_CUE_DURATION_MS);
  });

  it("keeps a minimum readable width for the last short cue at the end", () => {
    const r = moveCueRange(cue(9900, 10000), 500, 10000);
    expect(r.startMs).toBe(10000 - MIN_CUE_DURATION_MS);
    expect(r.endMs).toBe(10000);
    expect(r.clamped).toBe(true);
  });
});
