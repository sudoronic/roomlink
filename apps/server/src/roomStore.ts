import { randomBytes, randomUUID } from "node:crypto";
import type { ChatMessage, Invite, RoomMember, RoomSnapshot } from "@roomlink/shared";

interface RoomRecord {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  members: Map<string, RoomMember>;
  messages: ChatMessage[];
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly invites = new Map<string, Invite>();

  createRoom(name: string, displayName: string) {
    let code = createCode();
    while ([...this.rooms.values()].some((room) => room.code === code)) code = createCode();
    const now = new Date().toISOString();
    const room: RoomRecord = {
      id: randomUUID(),
      code,
      name,
      createdAt: now,
      members: new Map(),
      messages: []
    };
    const member = this.addMember(room, displayName, "admin");
    this.rooms.set(room.id, room);
    return { snapshot: this.snapshot(room), member };
  }

  joinRoom(code: string, displayName: string) {
    const room = [...this.rooms.values()].find((candidate) => candidate.code === code);
    if (!room) return undefined;
    const member = this.addMember(room, displayName, "member");
    return { snapshot: this.snapshot(room), member };
  }

  getRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? this.snapshot(room) : undefined;
  }

  getMember(roomId: string, memberId: string) {
    return this.rooms.get(roomId)?.members.get(memberId);
  }

  setOnline(roomId: string, memberId: string, online: boolean) {
    const member = this.rooms.get(roomId)?.members.get(memberId);
    if (member) member.online = online;
    return member;
  }

  addMessage(roomId: string, senderId: string, body: string) {
    const room = this.rooms.get(roomId);
    const sender = room?.members.get(senderId);
    if (!room || !sender) return undefined;
    const message: ChatMessage = {
      id: randomUUID(),
      roomId,
      senderId,
      senderName: sender.displayName,
      body,
      sentAt: new Date().toISOString()
    };
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();
    return message;
  }

  createInvite(roomId: string, memberId: string): Invite | undefined {
    const room = this.rooms.get(roomId);
    const member = room?.members.get(memberId);
    if (!room || member?.role !== "admin") return undefined;
    const now = Date.now();
    const invite: Invite = {
      code: room.code,
      roomId: room.id,
      roomName: room.name,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
    };
    this.invites.set(invite.code, invite);
    return invite;
  }

  getInvite(code: string) {
    const invite = this.invites.get(code);
    if (!invite || Date.parse(invite.expiresAt) < Date.now()) return undefined;
    return invite;
  }

  private addMember(room: RoomRecord, displayName: string, role: RoomMember["role"]) {
    const member: RoomMember = {
      id: randomUUID(),
      displayName,
      role,
      joinedAt: new Date().toISOString(),
      online: true
    };
    room.members.set(member.id, member);
    return member;
  }

  private snapshot(room: RoomRecord): RoomSnapshot {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      createdAt: room.createdAt,
      members: [...room.members.values()],
      messages: [...room.messages]
    };
  }
}
