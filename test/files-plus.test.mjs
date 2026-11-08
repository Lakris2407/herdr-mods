// files-plus hands a Windows folder path to PowerShell as Base64 (b64.js), never as code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base64 } from "../layout/mods/files-plus/b64.js";

test("base64 matches Node's for ASCII, accents, CJK and emoji paths", () => {
  for (const s of ["", "a", "ab", "abc", "C:\\Users\\Acme\\src", "a;calc", "$(calc)", "a'b", "a’b", "Æble/ø", "文件夹", "📁 work"]) {
    assert.equal(base64(s), Buffer.from(s, "utf8").toString("base64"), s);
  }
});

test("base64 output is only Base64 characters", () => {
  assert.match(base64("x'; Remove-Item -Recurse C:\\ #’‘"), /^[A-Za-z0-9+/]*=*$/);
});
