import type {
  ChatMessage,
  MemberRole,
  RoomMember,
  RoomSnapshot,
} from "@roomlink/shared";
import { ensureAnonymousSession, supabase } from "./client";

type RoomRow = {
  id: string;
  code: string;
  name: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  room_id: string;
  display_name: string;
  role: MemberRole;
  joined_at: string;
  online: boolean;
};

type MessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  sent_at: string;
};

type RoomActionResult = { roomId: string; memberId: string };

function toMember(row: MemberRow): RoomMember {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.joined_at,
    online: false,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    sentAt: row.sent_at,
  };
}

export async function loadRoom(roomId: string): Promise<RoomSnapshot> {
  const [roomResult, memberResult, messageResult] = await Promise.all([
    supabase
      .from("roomlink_rooms")
      .select("id,code,name,created_at")
      .eq("id", roomId)
      .single(),
    supabase
      .from("roomlink_members")
      .select("id,room_id,display_name,role,joined_at,online")
      .eq("room_id", roomId)
      .order("joined_at"),
    supabase
      .from("roomlink_messages")
      .select("id,room_id,sender_id,sender_name,body,sent_at")
      .eq("room_id", roomId)
      .order("sent_at", { ascending: false })
      .limit(100),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (memberResult.error) throw memberResult.error;
  if (messageResult.error) throw messageResult.error;

  const room = roomResult.data as RoomRow;
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    createdAt: room.created_at,
    members: (memberResult.data as MemberRow[]).map(toMember),
    messages: (messageResult.data as MessageRow[]).reverse().map(toMessage),
  };
}

async function roomAction(
  name: "roomlink_create_room" | "roomlink_join_room",
  args: Record<string, string>,
) {
  await ensureAnonymousSession();
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as RoomActionResult;
}

export async function createRoom(name: string, displayName: string) {
  const action = await roomAction("roomlink_create_room", {
    p_name: name,
    p_display_name: displayName,
  });
  return { snapshot: await loadRoom(action.roomId), memberId: action.memberId };
}

export async function joinRoom(code: string, displayName: string) {
  const action = await roomAction("roomlink_join_room", {
    p_code: code.toUpperCase(),
    p_display_name: displayName,
  });
  return { snapshot: await loadRoom(action.roomId), memberId: action.memberId };
}

export async function setOnline(roomId: string, online: boolean) {
  const result = await supabase.rpc("roomlink_set_online", {
    p_room_id: roomId,
    p_online: online,
  });
  if (result.error) throw result.error;
}

export async function sendMessage(roomId: string, body: string) {
  const result = await supabase.rpc("roomlink_send_message", {
    p_room_id: roomId,
    p_body: body,
  });
  if (result.error) throw result.error;
}

export async function createInvite(roomId: string) {
  const result = await supabase.rpc("roomlink_create_invite", {
    p_room_id: roomId,
  });
  if (result.error) throw result.error;
  return result.data as { code: string };
}

export async function closeRoom(roomId: string) {
  const result = await supabase.rpc("roomlink_close_room", {
    p_room_id: roomId,
  });
  if (result.error) throw result.error;
}

export { supabase };
