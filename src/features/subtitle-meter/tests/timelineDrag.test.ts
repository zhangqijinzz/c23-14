import { describe, expect, it } from "vitest";
import {
  computeCueMove,
  computeViewEndMs,
  MIN_READABLE_DURATION_MS,
} from "../timelineDrag";
describe("computeCueMove", () => {
  const bounds = { minStartMs: 0, maxEndMs: 10_000 };
  it("translates rigidly inside the view range", () => {
    const move = computeCueMove({ startMs: 1000, endMs: 3000 }, 500, bounds);
    expect(move).toEqual({
      startMs: 1500,
      endMs: 3500,
      shiftMs: 500,
      clampedTo: null,
    });
  });
  it("stops at the view start without squashing the cue", () => {
    const move = computeCueMove({ startMs: 200, endMs: 1000 }, -5000, bounds);
    expect(move.startMs).toBe(0);
    expect(move.endMs).toBe(800);
    expect(move.endMs - move.startMs).toBe(800);
    expect(move.clampedTo).toBe("start");
  });
  it("stops at the view end without growing the view range", () => {
    const move = computeCueMove({ startMs: 6000, endMs: 8000 }, 9000, bounds);
    expect(move.endMs).toBe(10_000);
    expect(move.endMs - move.startMs).toBe(2000);
    expect(move.clampedTo).toBe("end");
  });
  it("keeps start before end and heals invalid durations to the readable minimum", () => {
    const move = computeCueMove({ startMs: 1000, endMs: 1000 }, 0, bounds);
    expect(move.endMs).toBeGreaterThan(move.startMs);
    expect(move.endMs - move.startMs).toBe(MIN_READABLE_DURATION_MS);
  });
  it("pins a cue longer than the whole view to the view start", () => {
    const move = computeCueMove({ startMs: 0, endMs: 20_000 }, 3000, bounds);
    expect(move.startMs).toBe(0);
    expect(move.clampedTo).toBe("start");
  });
});
describe("computeViewEndMs", () => {
  it("covers all cues with a one second floor", () => {
    expect(computeViewEndMs([{ endMs: 400 }])).toBe(1000);
    expect(computeViewEndMs([{ endMs: 400 }, { endMs: 6200 }])).toBe(6200);
  });
});
