// Regression tests for the Windows backend (issue #5896).
//
// Before the fix:
//   1. Every User32-backed action spawned a fresh powershell.exe that never had
//      the `User32` P/Invoke type defined, so the call silently failed.
//   2. `withUser32` returned the subprocess result without checking the exit
//      code, so a failed action still reported `{ action_sent: true }`.
//   3. `left_mouse_down({ target })` only moved the cursor and dropped the
//      button press due to a ternary/concatenation precedence bug.
//
// These tests inject a fake runner so no real powershell.exe is spawned and the
// generated PowerShell scripts can be asserted directly.
import { test } from "node:test";
import assert from "node:assert/strict";

function decodeScript(args) {
  const i = args.indexOf("-EncodedCommand");
  if (i === -1) return null;
  return Buffer.from(args[i + 1], "base64").toString("utf16le");
}

function mockExec({ fail = false } = {}) {
  const calls = [];
  const run = async (_cmd, args) => {
    calls.push({ script: decodeScript(args) });
    if (fail) return { code: 1, stdout: "", stderr: "simulated powershell failure" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

test("win32: User32 actions define the type in their own process", async () => {
  const { run, calls } = mockExec();
  const mod = await import("../src/backends/win32.mjs");
  const b = mod.create({ exec: { run } });
  await b.left_click({ target: { x: 5, y: 6 } });
  assert.ok(calls.at(-1).script.includes("public static class User32"), "User32 type must be defined in the action process");
});

test("win32: input actions fail truthfully on a nonzero exit (no false success)", async () => {
  const { run } = mockExec({ fail: true });
  const mod = await import("../src/backends/win32.mjs");
  const b = mod.create({ exec: { run } });
  await assert.rejects(() => b.left_click({ target: { x: 1, y: 2 } }), /failed/);
  await assert.rejects(() => b.left_mouse_down({ target: { x: 1, y: 2 } }), /failed/);
  await assert.rejects(() => b.scroll({ target: { x: 1, y: 2 } }), /failed/);
  await assert.rejects(() => b.key({ text: "a" }), /failed/);
});

test("win32: left_mouse_down with a target both moves and presses", async () => {
  const { run, calls } = mockExec();
  const mod = await import("../src/backends/win32.mjs");
  const b = mod.create({ exec: { run } });
  await b.left_mouse_down({ target: { x: 12, y: 34 } });
  const script = calls.at(-1).script;
  assert.ok(script.includes("SetCursorPos(12, 34)"), "must move the cursor to the target");
  assert.ok(script.includes("LEFTDOWN"), "must press the left button (precedence fix)");
  assert.ok(script.includes("SetCursorPos") && script.includes("mouse_event"), "both move and press must be present");
});

test("win32: cursor_position loads the User32 type in-process and never lies", async () => {
  const { run, calls } = mockExec();
  const mod = await import("../src/backends/win32.mjs");
  const b = mod.create({ exec: { run } });
  // Empty stdout -> no JSON -> must throw, not report a position.
  await assert.rejects(() => b.cursor_position());
  assert.ok(calls.at(-1).script.includes("public static class User32"), "cursor_position must define User32 in-process");
});
