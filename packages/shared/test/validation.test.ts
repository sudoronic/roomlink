import test from "node:test";
import assert from "node:assert/strict";
import { createRoomInputSchema, inviteCodeSchema, messageSchema } from "../src/index.js";

test("validates create room inputs", () => {
  assert.deepEqual(createRoomInputSchema.parse({ name: "Design sync", displayName: "Ari" }), {
    name: "Design sync",
    displayName: "Ari"
  });
  assert.throws(() => createRoomInputSchema.parse({ name: "", displayName: "Ari" }));
});

test("invite codes are six uppercase alphanumeric characters", () => {
  assert.equal(inviteCodeSchema.safeParse("ABC123").success, true);
  assert.equal(inviteCodeSchema.safeParse("abc123").success, false);
  assert.equal(inviteCodeSchema.safeParse("ABC12").success, false);
});

test("chat messages are bounded", () => {
  assert.equal(messageSchema.safeParse("hello").success, true);
  assert.equal(messageSchema.safeParse(" ".repeat(10)).success, false);
  assert.equal(messageSchema.safeParse("x".repeat(2001)).success, false);
});
