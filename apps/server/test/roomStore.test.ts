import test from "node:test";
import assert from "node:assert/strict";
import { RoomStore } from "../src/roomStore.js";

test("creates a room with an admin and joins by invite code", () => {
  const store = new RoomStore();
  const created = store.createRoom("Weekend plans", "Mina");
  assert.equal(created.snapshot.name, "Weekend plans");
  assert.equal(created.member.role, "admin");
  assert.match(created.snapshot.code, /^[A-Z0-9]{6}$/);

  const joined = store.joinRoom(created.snapshot.code, "Noah");
  assert.ok(joined);
  assert.equal(joined.member.role, "member");
  assert.equal(store.getRoom(created.snapshot.id)?.members.length, 2);
});

test("only admins can create invites and messages retain sender identity", () => {
  const store = new RoomStore();
  const created = store.createRoom("Study", "Admin");
  const member = store.joinRoom(created.snapshot.code, "Guest");
  assert.ok(member);
  assert.equal(store.createInvite(created.snapshot.id, member.member.id), undefined);
  const invite = store.createInvite(created.snapshot.id, created.member.id);
  assert.equal(invite?.roomId, created.snapshot.id);

  const message = store.addMessage(created.snapshot.id, member.member.id, "Hello!");
  assert.equal(message?.senderName, "Guest");
  assert.equal(store.getRoom(created.snapshot.id)?.messages[0]?.body, "Hello!");
});
