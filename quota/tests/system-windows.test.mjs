import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLoad, readLoad, SCRIPT } from "../mods/system/load.js";
import { readWindows, WINDOWS_COMMAND } from "../mods/system/windows.js";

const WIN = "windows\r\ncpu 11.8086228490222\r\nmem 15465276 33060672\r\ngpu 7.59645644801023\r\n";
const MAC = "darwin\n  12   8  80\n---\nMach Virtual Memory Statistics: (page size of 16384 bytes)\nPages wired down: 100.\nPages occupied by compressor: 50.\nAnonymous pages: 400.\nPages purgeable: 0.\n---\n17179869184\n---\n";

test("Windows output: CPU as read, RAM as used share of visible memory, GPU as given", () => {
  const load = parseLoad(WIN);
  assert.equal(Math.round(load.cpu.pct), 12);
  assert.equal(load.cpu.tip, "CPU 12%");
  assert.equal(Math.round(load.ram.pct), 53);
  assert.equal(load.ram.tip, "Memory 16.8 GB of 31.5 GB used");
  assert.equal(Math.round(load.gpu.pct), 8);
});

test("no GPU counter leaves the GPU out, a missing CPU is an error and never 0%", () => {
  assert.equal(readWindows("cpu 5\nmem 100 200\ngpu \n").gpu, null);
  assert.throws(() => readWindows("cpu \nmem 100 200\ngpu 3\n"), /no CPU reading/);
});

test("readings above 100 are clamped", () => {
  const load = readWindows("cpu 140\nmem 0 100\ngpu 250\n");
  assert.equal(load.cpu.pct, 100);
  assert.equal(load.gpu.pct, 100);
});

test("this computer on Windows reads through PowerShell, with no remote target", async () => {
  const calls = [];
  const load = await readLoad(async (...args) => { calls.push(args); return { code: 0, stdout: WIN }; }, null, "windows");
  assert.deepEqual(calls, [[WINDOWS_COMMAND[0], WINDOWS_COMMAND[1], { on: null }]]);
  assert.equal(Math.round(load.cpu.pct), 12);
});

test("every other case keeps the shell script: macOS, Linux, and a remote machine from a Windows app", async () => {
  for (const [machine, platform] of [[null, "macos"], [null, "linux"], [null, null], ["hub", "windows"]]) {
    const calls = [];
    await readLoad(async (...args) => { calls.push(args); return { code: 0, stdout: MAC }; }, machine, platform);
    assert.deepEqual(calls, [["sh", ["-c", SCRIPT], { on: machine }]]);
  }
});
