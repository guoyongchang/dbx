import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const appSource = readFileSync("apps/desktop/src/App.vue", "utf8");

test("cold-start SQL files wait for restored tabs before opening", () => {
  const openPathStart = appSource.indexOf("async function openSqlFilePath");
  const openPathEnd = appSource.indexOf("async function openPendingSqlFiles", openPathStart);
  assert.ok(openPathStart >= 0 && openPathEnd > openPathStart);

  const openPathSource = appSource.slice(openPathStart, openPathEnd);
  const initializationWait = openPathSource.indexOf("await desktopInitializationPromise");
  const fileRead = openPathSource.indexOf("api.readExternalSqlFile(path)");
  const tabOpen = openPathSource.indexOf("queryStore.openExternalSqlFile");
  assert.ok(initializationWait >= 0);
  assert.ok(initializationWait < fileRead);
  assert.ok(fileRead < tabOpen);

  const mountedStart = appSource.indexOf("onMounted(async () =>");
  const mountedEnd = appSource.indexOf("onUnmounted(", mountedStart);
  assert.ok(mountedStart >= 0 && mountedEnd > mountedStart);

  const mountedSource = appSource.slice(mountedStart, mountedEnd);
  const initializationStart = mountedSource.indexOf("desktopInitializationPromise = initApp()");
  const pendingFileOpen = mountedSource.indexOf("openPendingSqlFiles()");
  assert.ok(initializationStart >= 0);
  assert.ok(initializationStart < pendingFileOpen);
});
