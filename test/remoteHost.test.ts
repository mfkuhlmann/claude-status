import assert from "node:assert/strict";
import { test } from "node:test";
import { hostFromAuthority } from "../src/remoteHost";

const hex = (o: object) => Buffer.from(JSON.stringify(o)).toString("hex");

test("plain Remote-SSH authorities name the host", () => {
  assert.equal(hostFromAuthority("ssh-remote+build-server"), "build-server");
  assert.equal(hostFromAuthority("ssh-remote+build-server.example.com"), "build-server.example.com");
});

test("hex-encoded authorities are decoded", () => {
  assert.equal(hostFromAuthority("ssh-remote+" + hex({ hostName: "GpuBox" })), "GpuBox");
  assert.equal(hostFromAuthority("ssh-remote+" + hex({ hostName: "gpu-box", user: "alice" })), "alice@gpu-box");
  assert.equal(hostFromAuthority("ssh-remote+" + hex({ hostName: "gpu-box", port: 2222 })), "gpu-box");
});

test("other remotes and odd names are not SSH hosts", () => {
  assert.equal(hostFromAuthority(undefined), undefined);
  assert.equal(hostFromAuthority("wsl+Ubuntu"), undefined);
  assert.equal(hostFromAuthority("dev-container+abc"), undefined);
  assert.equal(hostFromAuthority("ssh-remote+bad name;rm"), undefined);
});
