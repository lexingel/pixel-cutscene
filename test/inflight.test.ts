import { expect, test } from "vitest";
import { clock, isRunning, track } from "../src/ui/inflight";

test("one_run_per_action_at_a_time", async () => {
  let finish!: () => void;
  const first = track("Generate dragon breathe", () => new Promise<void>((r) => (finish = r)));
  expect(isRunning("Generate dragon breathe")).toBe(true);
  expect(await track("Generate dragon breathe", async () => {})).toBe(false); // refused: already running
  expect(isRunning("Generate knight walk")).toBe(false);
  finish();
  expect(await first).toBe(true);
  expect(isRunning("Generate dragon breathe")).toBe(false);
});
test("a_failed_run_frees_the_action", async () => {
  await expect(track("x", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(isRunning("x")).toBe(false);
});
test("clock_reads_minutes_and_seconds", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(65_400)).toBe("1:05");
});
