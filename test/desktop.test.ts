import assert from "node:assert/strict";
import { test } from "node:test";
import { canRaiseWindows, isGnome, isKde } from "../src/desktop";

const on = (desktop: string) => ({ XDG_CURRENT_DESKTOP: desktop });

test("desktops are told apart like jump.py does", () => {
  assert.ok(isKde(on("KDE")));
  assert.ok(isGnome(on("GNOME")));
  assert.ok(isGnome(on("ubuntu:GNOME")), "Ubuntu's session");
  assert.ok(!isGnome(on("GNOME:KDE")), "KDE wins, as in jump.py's on_gnome()");
  assert.ok(!isKde(on("X-Cinnamon")) && !isGnome(on("X-Cinnamon")));
  assert.ok(!isGnome({}));
});

test("windows can be raised on Plasma and GNOME only", () => {
  assert.ok(canRaiseWindows(on("KDE")));
  assert.ok(canRaiseWindows(on("ubuntu:GNOME")));
  assert.ok(!canRaiseWindows(on("XFCE")));
  assert.ok(!canRaiseWindows({}));
});
