import { z } from "zod";

export const displayNameSchema = z.string().trim().min(1).max(40);
export const roomNameSchema = z.string().trim().min(1).max(80);
export const inviteCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/);
export const messageSchema = z.string().trim().min(1).max(2_000);

export const createRoomInputSchema = z.object({
  name: roomNameSchema,
  displayName: displayNameSchema
});

export const joinRoomInputSchema = z.object({
  code: inviteCodeSchema,
  displayName: displayNameSchema
});

export const chatInputSchema = z.object({
  roomId: z.string().min(1),
  body: messageSchema
});

export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomInputSchema>;

export type MemberRole = "admin" | "member";

export interface RoomMember {
  id: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
  online: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  sentAt: string;
}

export interface RoomSnapshot {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  members: RoomMember[];
  messages: ChatMessage[];
}

export interface Invite {
  code: string;
  roomId: string;
  roomName: string;
  createdAt: string;
  expiresAt: string;
}

export type ClientToServerEvents = {
  "room:join": (payload: { roomId: string; memberId: string }) => void;
  "room:leave": (payload: { roomId: string; memberId: string }) => void;
  "chat:send": (payload: { roomId: string; senderId: string; body: string }) => void;
  "webrtc:signal": (payload: {
    roomId: string;
    to: string;
    from: string;
    signal: unknown;
  }) => void;
};

export type ServerToClientEvents = {
  "room:updated": (snapshot: RoomSnapshot) => void;
  "chat:message": (message: ChatMessage) => void;
  "webrtc:signal": (payload: { from: string; signal: unknown }) => void;
  "room:error": (message: string) => void;
};
