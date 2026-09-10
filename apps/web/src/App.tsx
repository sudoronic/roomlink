import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Copy, FileUp, Link2, LogOut, MessageCircle, Paperclip, Plus, Send, Users, X } from "lucide-react";
import type { ChatMessage, ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from "@roomlink/shared";
import { createFileTransfer } from "./webrtc/fileTransfer";

const API_URL = import.meta.env.VITE_API_URL ?? "";
type RoomSession = { room: RoomSnapshot; memberId: string; displayName: string };
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type RoomChange = RoomSnapshot | ((room: RoomSnapshot) => RoomSnapshot);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
  return body;
}

export default function App() {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [toast, setToast] = useState("");

  if (!session) return <Landing onJoined={setSession} onError={setToast} toast={toast} />;
  return (
    <Room
      session={session}
      onRoomChange={(change) => setSession((current) => {
        if (!current) return current;
        return { ...current, room: typeof change === "function" ? change(current.room) : change };
      })}
      onLeave={() => setSession(null)}
      onError={setToast}
      toast={toast}
    />
  );
}

function Landing({ onJoined, onError, toast }: { onJoined: (session: RoomSession) => void; onError: (message: string) => void; toast: string }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = mode === "create"
        ? await api<{ snapshot: RoomSnapshot; member: { id: string; displayName: string } }>("/api/rooms", { method: "POST", body: JSON.stringify({ name, displayName }) })
        : await api<{ snapshot: RoomSnapshot; member: { id: string; displayName: string } }>("/api/rooms/join", { method: "POST", body: JSON.stringify({ code, displayName }) });
      onJoined({ room: result.snapshot, memberId: result.member.id, displayName: result.member.displayName });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="landing">
      <section className="landing-copy">
        <div className="brand-mark">RL</div>
        <p className="eyebrow">A calmer way to gather</p>
        <h1>Shared moments,<br /><em>one room.</em></h1>
        <p className="lede">A private space for the people you want nearby. Chat, share, and stay in sync without the noise.</p>
        <div className="feature-row"><span>01 <b>Instant rooms</b></span><span>02 <b>Real-time chat</b></span><span>03 <b>Peer-to-peer share</b></span></div>
      </section>
      <section className="auth-card">
        <div className="auth-heading"><span className="pill">ROOMLINK</span><h2>{mode === "create" ? "Start a room" : "Join your people"}</h2><p>{mode === "create" ? "Make a space. Send the invite. You're in." : "Enter the invite code shared with you."}</p></div>
        <div className="segmented"><button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>Create room</button><button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>Join room</button></div>
        <form onSubmit={submit}>
          {mode === "create" ? <label>Room name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sunday supper" required maxLength={80} /></label> : <label>Invite code<input className="code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} required /></label>}
          <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we call you?" required maxLength={40} /></label>
          <button className="primary-button" disabled={busy}>{busy ? "Connecting…" : mode === "create" ? <><Plus size={18} /> Create room</> : <><Link2 size={18} /> Join room</>}</button>
        </form>
        {toast && <p className="error">{toast}</p>}
        <p className="privacy-note">No account needed. Rooms live in memory on this server.</p>
      </section>
    </main>
  );
}

function Room({ session, onRoomChange, onLeave, onError, toast }: { session: RoomSession; onRoomChange: (change: RoomChange) => void; onLeave: () => void; onError: (message: string) => void; toast: string }) {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState("");
  const fileChannel = useRef<RTCDataChannel | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const client: AppSocket = io(API_URL || undefined);
    setSocket(client);
    client.emit("room:join", { roomId: session.room.id, memberId: session.memberId });
    client.on("room:updated", onRoomChange);
    client.on("chat:message", (chatMessage) => onRoomChange((current) => ({ ...current, messages: [...current.messages, chatMessage] })));
    client.on("room:error", onError);
    return () => { client.emit("room:leave", { roomId: session.room.id, memberId: session.memberId }); client.disconnect(); };
  }, [session.memberId, session.room.id]); // room content changes must not reconnect the socket

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [session.room.messages.length]);

  const admin = session.room.members.find((member) => member.id === session.memberId)?.role === "admin";
  const onlineCount = session.room.members.filter((member) => member.online).length;
  const initials = (value: string) => value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function createInvite() {
    try {
      const result = await api<{ code: string }>(`/api/rooms/${session.room.id}/invites`, { method: "POST", body: JSON.stringify({ memberId: session.memberId }) });
      setInvite(result.code);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not create invite."); }
  }

  function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!socket || !message.trim()) return;
    socket.emit("chat:send", { roomId: session.room.id, senderId: session.memberId, body: message.trim() });
    setMessage("");
  }

  async function pickFile(file: File) {
    if (!fileChannel.current || fileChannel.current.readyState !== "open") {
      setFileProgress("Connect to a peer before sending a file.");
      return;
    }
    const send = createFileTransfer(fileChannel.current, (sent, total) => setFileProgress(`Sending ${Math.round(sent / total * 100)}%`));
    await send(file);
    setFileProgress("File sent.");
  }

  return (
    <div className="room-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark small">RL</span><span>RoomLink</span></div><div className="room-code"><span>{session.room.name}</span><b>{session.room.code}</b></div><button className="icon-button" aria-label="Leave room" onClick={onLeave}><LogOut size={18} /></button></header>
      <div className="room-layout">
        <aside className="room-sidebar">
          <div className="side-title"><div><p className="eyebrow">Your room</p><h2>{session.room.name}</h2></div><span className="online-dot" /></div>
          <div className="invite-box"><div><span className="invite-icon"><Link2 size={16} /></span><div><b>Invite people</b><small>Share the room code</small></div></div><button onClick={createInvite}>{invite ? "Copied!" : "Invite"}</button>{invite && <button className="copy-code" onClick={() => navigator.clipboard?.writeText(invite)}><Copy size={13} /> {invite}</button>}</div>
          <div className="members-header"><span><Users size={15} /> People</span><b>{onlineCount}</b></div>
          <div className="member-list">{session.room.members.map((member) => <div className="member" key={member.id}><span className={`avatar ${member.role === "admin" ? "warm" : ""}`}>{initials(member.displayName)}</span><span><b>{member.displayName}{member.id === session.memberId ? " (you)" : ""}</b><small>{member.role === "admin" ? "Host" : "Member"}</small></span><i className={member.online ? "online" : ""} /></div>)}</div>
          <div className="sidebar-footer"><span className="secure-dot" /> End-to-end peer sharing ready</div>
        </aside>
        <main className="chat-panel"><div className="chat-header"><div><p className="eyebrow">The conversation</p><h1>Say hello.</h1></div><div className="message-count"><MessageCircle size={16} /> {session.room.messages.length}</div></div><div className="messages">{session.room.messages.length === 0 && <div className="empty-chat"><span>✦</span><h3>This is your room.</h3><p>Start with a hello, a plan, or a photo.</p></div>}{session.room.messages.map((item) => <Message key={item.id} message={item} own={item.senderId === session.memberId} initials={initials} />)}<div ref={messagesEnd} /></div><form className="composer" onSubmit={sendMessage}><label className="attach-button" title="Send a file"><Paperclip size={19} /><input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void pickFile(file); event.target.value = ""; }} /></label><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message…" maxLength={2000} /><button className="send-button" aria-label="Send message"><Send size={18} /></button></form>{fileProgress && <div className="file-status"><FileUp size={14} /> {fileProgress}</div>}{toast && <div className="floating-error"><X size={15} /> {toast}</div>}</main>
      </div>
    </div>
  );
}

function Message({ message, own, initials }: { message: ChatMessage; own: boolean; initials: (name: string) => string }) {
  const time = useMemo(() => new Date(message.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), [message.sentAt]);
  return <div className={`message-row ${own ? "own" : ""}`}><span className="avatar">{initials(message.senderName)}</span><div className="message-content"><div className="message-meta"><b>{own ? "You" : message.senderName}</b><time>{time}</time></div><p>{message.body}</p></div></div>;
}
