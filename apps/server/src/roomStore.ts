import { randomBytes, randomUUID } from "node:crypto";
import type { ChatMessage, Invite, RoomMember, RoomSnapshot } from "@roomlink/shared";

export interface RoomPersistence {
  saveRoom(snapshot: RoomSnapshot, expiresAt: string): Promise<void>;
  saveMember(roomId: string, member: RoomMember): Promise<void>;
  setMemberOnline(roomId: string, memberId: string, online: boolean): Promise<void>;
  saveMessage(message: ChatMessage): Promise<void>;
  saveInvite(invite: Invite): Promise<void>;
}

export interface HydratedRoomData {
  rooms: Array<{ id: string; code: string; name: string; created_at: string; expires_at: string }>;
  members: Array<{ id: string; room_id: string; display_name: string; role: RoomMember["role"]; joined_at: string; online: boolean }>;
  messages: ChatMessage[];
  invites: Invite[];
}

interface RoomRecord {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  members: Map<string, RoomMember>;
  messages: ChatMessage[];
  expiresAt: string;
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly invites = new Map<string, Invite>();
  constructor(private readonly persistence?: RoomPersistence, private readonly roomTtlMinutes = 360) {}

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
      messages: [],
      expiresAt: new Date(Date.now() + this.roomTtlMinutes * 60_000).toISOString()
    };
    const member = this.addMember(room, displayName, "admin");
    this.rooms.set(room.id, room);
    this.persist(() => this.persistence?.saveRoom(this.snapshot(room), room.expiresAt));
    this.persist(() => this.persistence?.saveMember(room.id, member));
    return { snapshot: this.snapshot(room), member };
  }

  joinRoom(code: string, displayName: string) {
    const room = [...this.rooms.values()].find((candidate) => candidate.code === code);
    if (!room) return undefined;
    const member = this.addMember(room, displayName, "member");
    this.persist(() => this.persistence?.saveMember(room.id, member));
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
    if (member) this.persist(() => this.persistence?.setMemberOnline(roomId, memberId, online));
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
    this.persist(() => this.persistence?.saveMessage(message));
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
    this.persist(() => this.persistence?.saveInvite(invite));
    return invite;
  }

  getInvite(code: string) {
    const invite = this.invites.get(code);
    if (!invite || Date.parse(invite.expiresAt) < Date.now()) return undefined;
    return invite;
  }

  hydrate(data: HydratedRoomData) {
    for (const row of data.rooms) {
      const room: RoomRecord = {
        id: row.id, code: row.code, name: row.name, createdAt: row.created_at,
        expiresAt: row.expires_at, members: new Map(), messages: []
      };
      for (const member of data.members.filter((candidate) => candidate.room_id === row.id)) {
        room.members.set(member.id, {
          id: member.id, displayName: member.display_name, role: member.role,
          joinedAt: member.joined_at, online: false
        });
      }
      room.messages = data.messages.filter((message) => message.roomId === row.id).slice(-100);
      this.rooms.set(room.id, room);
    }
    for (const invite of data.invites) this.invites.set(invite.code, invite);
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

  private persist(operation: () => Promise<void> | undefined) {
    const pending = operation();
    if (pending) pending.catch((error: unknown) => console.error("RoomLink persistence error", error));
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
