import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, Invite, RoomMember, RoomSnapshot } from "@roomlink/shared";

type RoomRow = { id: string; code: string; name: string; created_at: string; expires_at: string };
type MemberRow = { id: string; room_id: string; display_name: string; role: RoomMember["role"]; joined_at: string; online: boolean };
type MessageRow = { id: string; room_id: string; sender_id: string; sender_name: string; body: string; sent_at: string };
type InviteRow = { code: string; room_id: string; room_name: string; created_at: string; expires_at: string };

export class SupabasePersistence {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  async saveRoom(snapshot: RoomSnapshot, expiresAt: string) {
    const { error } = await this.client.from("roomlink_rooms").upsert({
      id: snapshot.id, code: snapshot.code, name: snapshot.name, created_at: snapshot.createdAt, expires_at: expiresAt
    });
    if (error) throw error;
  }

  async saveMember(roomId: string, member: RoomMember) {
    const { error } = await this.client.from("roomlink_members").upsert({
      id: member.id, room_id: roomId, display_name: member.displayName, role: member.role,
      joined_at: member.joinedAt, online: member.online
    });
    if (error) throw error;
  }

  async setMemberOnline(roomId: string, memberId: string, online: boolean) {
    const { error } = await this.client.from("roomlink_members").update({ online }).eq("room_id", roomId).eq("id", memberId);
    if (error) throw error;
  }

  async saveMessage(message: ChatMessage) {
    const { error } = await this.client.from("roomlink_messages").insert({
      id: message.id, room_id: message.roomId, sender_id: message.senderId, sender_name: message.senderName,
      body: message.body, sent_at: message.sentAt
    });
    if (error) throw error;
  }

  async saveInvite(invite: Invite) {
    const { error } = await this.client.from("roomlink_invites").upsert({
      code: invite.code, room_id: invite.roomId, room_name: invite.roomName,
      created_at: invite.createdAt, expires_at: invite.expiresAt
    });
    if (error) throw error;
  }

  async load() {
    const [rooms, members, messages, invites] = await Promise.all([
      this.client.from("roomlink_rooms").select("*").gt("expires_at", new Date().toISOString()),
      this.client.from("roomlink_members").select("*"),
      this.client.from("roomlink_messages").select("*").order("sent_at", { ascending: false }).limit(10_000),
      this.client.from("roomlink_invites").select("*").gt("expires_at", new Date().toISOString())
    ]);
    for (const result of [rooms, members, messages, invites]) if (result.error) throw result.error;
    return {
      rooms: rooms.data as RoomRow[],
      members: members.data as MemberRow[],
      messages: messages.data as MessageRow[],
      invites: invites.data as InviteRow[]
    };
  }
}
