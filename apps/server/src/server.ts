import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "socket.io";
import {
  chatInputSchema,
  createRoomInputSchema,
  joinRoomInputSchema,
  type ClientToServerEvents,
  type ServerToClientEvents
} from "@roomlink/shared";
import { config } from "./config.js";
import { RoomStore } from "./roomStore.js";
import { SupabasePersistence } from "./supabasePersistence.js";

export function createApp(store = new RoomStore()) {
  const app = express();
  app.use(cors({ origin: config.clientOrigin === "*" ? true : config.clientOrigin }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => response.json({ ok: true, service: "roomlink-server" }));

  app.post("/api/rooms", (request, response) => {
    const result = createRoomInputSchema.safeParse(request.body);
    if (!result.success) return response.status(400).json({ error: "Enter a room name and display name." });
    const created = store.createRoom(result.data.name, result.data.displayName);
    return response.status(201).json(created);
  });

  app.post("/api/rooms/join", (request, response) => {
    const result = joinRoomInputSchema.safeParse({
      ...request.body,
      code: typeof request.body?.code === "string" ? request.body.code.toUpperCase() : request.body?.code
    });
    if (!result.success) return response.status(400).json({ error: "Use a six-character invite code and display name." });
    const joined = store.joinRoom(result.data.code, result.data.displayName);
    if (!joined) return response.status(404).json({ error: "That room could not be found." });
    return response.status(201).json(joined);
  });

  app.get("/api/rooms/:roomId", (request, response) => {
    const room = store.getRoom(request.params.roomId);
    return room ? response.json(room) : response.status(404).json({ error: "Room not found." });
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  app.use(express.static(webDist, { index: "index.html" }));

  app.post("/api/rooms/:roomId/invites", (request, response) => {
    const memberId = request.body?.memberId;
    if (typeof memberId !== "string") return response.status(400).json({ error: "memberId is required." });
    const invite = store.createInvite(request.params.roomId, memberId);
    return invite ? response.status(201).json(invite) : response.status(403).json({ error: "Only the room admin can invite." });
  });

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.clientOrigin }
  });

  io.on("connection", (socket) => {
    let authenticatedMember: { roomId: string; memberId: string } | undefined;

    socket.on("room:join", ({ roomId, memberId }) => {
      if (!store.getMember(roomId, memberId)) return socket.emit("room:error", "You are not a member of this room.");
      authenticatedMember = { roomId, memberId };
      socket.join(roomId);
      socket.join(memberId);
      store.setOnline(roomId, memberId, true);
      const snapshot = store.getRoom(roomId);
      if (snapshot) io.to(roomId).emit("room:updated", snapshot);
    });

    socket.on("room:leave", ({ roomId, memberId }) => {
      if (authenticatedMember?.roomId !== roomId || authenticatedMember.memberId !== memberId) return;
      socket.leave(roomId);
      store.setOnline(roomId, memberId, false);
      authenticatedMember = undefined;
      const snapshot = store.getRoom(roomId);
      if (snapshot) io.to(roomId).emit("room:updated", snapshot);
    });

    socket.on("chat:send", (payload) => {
      const parsed = chatInputSchema.safeParse(payload);
      if (!parsed.success) return socket.emit("room:error", "Message is empty or too long.");
      if (authenticatedMember?.roomId !== parsed.data.roomId || authenticatedMember.memberId !== payload.senderId) {
        return socket.emit("room:error", "You are not authorized to send messages in this room.");
      }
      const message = store.addMessage(parsed.data.roomId, authenticatedMember.memberId, parsed.data.body);
      if (message) io.to(parsed.data.roomId).emit("chat:message", message);
    });

    socket.on("webrtc:signal", (payload) => {
      if (
        authenticatedMember?.roomId !== payload.roomId ||
        authenticatedMember.memberId !== payload.from ||
        !store.getMember(payload.roomId, payload.to)
      ) return;
      io.to(payload.to).emit("webrtc:signal", { from: payload.from, signal: payload.signal });
    });

    socket.on("disconnect", () => {
      if (authenticatedMember) {
        store.setOnline(authenticatedMember.roomId, authenticatedMember.memberId, false);
        const snapshot = store.getRoom(authenticatedMember.roomId);
        if (snapshot) io.to(authenticatedMember.roomId).emit("room:updated", snapshot);
      }
    });
  });

  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(webDist, "index.html"));
  });

  return { app, httpServer, io, store };
}

export function startServer() {
  const persistence = config.supabaseUrl && config.supabaseServiceRoleKey
    ? new SupabasePersistence(config.supabaseUrl, config.supabaseServiceRoleKey)
    : undefined;
  if (!persistence) console.warn("Supabase persistence is disabled; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const store = new RoomStore(persistence, config.roomTtlMinutes);
  const server = createApp(store);
  const listen = () => server.httpServer.listen(config.port, () => {
    console.log(`RoomLink server listening on http://localhost:${config.port}`);
  });
  if (persistence) {
    persistence.load().then((data) => {
      store.hydrate({
        ...data,
        messages: data.messages.map((message) => ({
          id: message.id, roomId: message.room_id, senderId: message.sender_id,
          senderName: message.sender_name, body: message.body, sentAt: message.sent_at
        })),
        invites: data.invites.map((invite) => ({
          code: invite.code, roomId: invite.room_id, roomName: invite.room_name,
          createdAt: invite.created_at, expiresAt: invite.expires_at
        }))
      });
      listen();
    }).catch((error: unknown) => {
      console.error("Could not hydrate RoomLink from Supabase", error);
      process.exitCode = 1;
    });
  } else listen();
  return server;
}
