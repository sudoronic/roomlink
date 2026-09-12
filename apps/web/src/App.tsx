import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  FileUp,
  Link2,
  LogOut,
  MessageCircle,
  Paperclip,
  Plus,
  Send,
  Users,
  X,
} from "lucide-react";
import type { ChatMessage, RoomSnapshot } from "@roomlink/shared";
import {
  createInvite,
  createRoom,
  joinRoom,
  sendMessage,
  loadRoom,
  supabase,
} from "./supabase/roomlink";
import { createFileTransfer } from "./webrtc/fileTransfer";
import { createPeers } from "./webrtc/peers";

type RoomSession = {
  room: RoomSnapshot;
  memberId: string;
  displayName: string;
};
type RoomChange = RoomSnapshot | ((room: RoomSnapshot) => RoomSnapshot);

export default function App() {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [toast, setToast] = useState("");

  if (!session)
    return <Landing onJoined={setSession} onError={setToast} toast={toast} />;
  return (
    <Room
      session={session}
      onRoomChange={(change) =>
        setSession((current) => {
          if (!current) return current;
          return {
            ...current,
            room: typeof change === "function" ? change(current.room) : change,
          };
        })
      }
      onLeave={() => setSession(null)}
      onError={setToast}
      toast={toast}
    />
  );
}

function Landing({
  onJoined,
  onError,
  toast,
}: {
  onJoined: (session: RoomSession) => void;
  onError: (message: string) => void;
  toast: string;
}) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result =
        mode === "create"
          ? await createRoom(name, displayName)
          : await joinRoom(code, displayName);
      onJoined({
        room: result.snapshot,
        memberId: result.memberId,
        displayName,
      });
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
        <h1>
          Shared moments,
          <br />
          <em>one room.</em>
        </h1>
        <p className="lede">
          A private space for the people you want nearby. Chat, share, and stay
          in sync without the noise.
        </p>
        <div className="feature-row">
          <span>
            01 <b>Instant rooms</b>
          </span>
          <span>
            02 <b>Real-time chat</b>
          </span>
          <span>
            03 <b>Peer-to-peer share</b>
          </span>
        </div>
      </section>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="pill">ROOMLINK</span>
          <h2>{mode === "create" ? "Start a room" : "Join your people"}</h2>
          <p>
            {mode === "create"
              ? "Make a space. Send the invite. You're in."
              : "Enter the invite code shared with you."}
          </p>
        </div>
        <div className="segmented">
          <button
            className={mode === "create" ? "active" : ""}
            onClick={() => setMode("create")}
          >
            Create room
          </button>
          <button
            className={mode === "join" ? "active" : ""}
            onClick={() => setMode("join")}
          >
            Join room
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "create" ? (
            <label>
              Room name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Sunday supper"
                required
                maxLength={80}
              />
            </label>
          ) : (
            <label>
              Invite code
              <input
                className="code-input"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                required
              />
            </label>
          )}
          <label>
            Your name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="How should we call you?"
              required
              maxLength={40}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? (
              "Connecting…"
            ) : mode === "create" ? (
              <>
                <Plus size={18} /> Create room
              </>
            ) : (
              <>
                <Link2 size={18} /> Join room
              </>
            )}
          </button>
        </form>
        {toast && <p className="error">{toast}</p>}
        <p className="privacy-note">
          No account needed. Anonymous sign-in required. Anyone with the room
          code can join.
        </p>
      </section>
    </main>
  );
}

function Room({
  session,
  onRoomChange,
  onLeave,
  onError,
  toast,
}: {
  session: RoomSession;
  onRoomChange: (change: RoomChange) => void;
  onLeave: () => void;
  onError: (message: string) => void;
  toast: string;
}) {
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState("");
  const peers = useRef<ReturnType<typeof createPeers> | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>(
    [],
  );
  const downloadUrls = useRef<string[]>([]);
  const callbacks = useRef({ onRoomChange, onError });
  callbacks.current = { onRoomChange, onError };
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let ready = false;
    let refreshing = false;
    let members = session.room.members;
    let present: string[] = [];
    const fail = (e: unknown) => {
      if (!stopped)
        callbacks.current.onError(e instanceof Error ? e.message : String(e));
    };
    const channel = supabase.channel(`roomlink:${session.room.id}`, {
      config: {
        private: true,
        broadcast: { self: false, ack: true },
        presence: { key: session.memberId },
      },
    });
    const manager = createPeers(
      session.memberId,
      async (payload) => {
        if (stopped || !ready) throw new Error("Signaling is reconnecting.");
        const result = await channel.send({
          type: "broadcast",
          event: "webrtc:signal",
          payload,
        });
        if (result !== "ok")
          throw new Error("Could not deliver connection signal.");
      },
      (text) => {
        if (!stopped) setFileProgress(text);
      },
      fail,
      (file) => {
        if (stopped) return;
        const url = URL.createObjectURL(file);
        downloadUrls.current.push(url);
        if (downloadUrls.current.length > 3)
          URL.revokeObjectURL(downloadUrls.current.shift()!);
        setDownloads((current) =>
          [...current, { name: file.name, url }].slice(-3),
        );
        setFileProgress(`Received ${file.name}. Choose Download to save it.`);
      },
      (ids) => {
        if (!stopped) setConnected(ids);
      },
    );
    peers.current = manager;
    const presence = () => {
      if (stopped || !ready) return;
      present = Object.keys(channel.presenceState());
      manager.sync(
        members.map((m) => m.id),
        present,
      );
      callbacks.current.onRoomChange((current) => ({
        ...current,
        members: current.members.map((m) => ({
          ...m,
          online: present.includes(m.id),
        })),
      }));
    };
    const refresh = async () => {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const snapshot = await loadRoom(session.room.id);
        if (stopped) return;
        members = snapshot.members;
        callbacks.current.onRoomChange((current) => ({
          ...snapshot,
          members: snapshot.members.map((m) => ({
            ...m,
            online: present.includes(m.id),
          })),
          messages: [
            ...new Map(
              [...snapshot.messages, ...current.messages].map((m) => [m.id, m]),
            ).values(),
          ]
            .sort(
              (a, b) =>
                a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id),
            )
            .slice(-100),
        }));
        presence();
      } catch (e) {
        fail(e);
      } finally {
        refreshing = false;
      }
    };
    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "roomlink_messages",
          filter: `room_id=eq.${session.room.id}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "roomlink_members",
          filter: `room_id=eq.${session.room.id}`,
        },
        () => {
          void refresh();
        },
      )
      .on("presence", { event: "sync" }, presence)
      .on("broadcast", { event: "webrtc:signal" }, ({ payload }) => {
        if (!stopped) manager.signal(payload);
      })
      .subscribe((status) => {
        if (stopped) return;
        ready = status === "SUBSCRIBED";
        if (ready)
          void (async () => {
            const result = await channel.track({ member_id: session.memberId });
            if (result !== "ok") throw new Error("Presence could not connect.");
            await refresh();
            presence();
          })().catch(fail);
        else {
          manager.sync([], []);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            fail(new Error("Room connection lost. Retrying…"));
        }
      });
    const poll = window.setInterval(() => {
      if (ready) void refresh();
    }, 5000);
    return () => {
      stopped = true;
      ready = false;
      window.clearInterval(poll);
      manager.stop();
      peers.current = null;
      void supabase.removeChannel(channel);
      downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
      downloadUrls.current = [];
    };
  }, [session.memberId, session.room.id]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.room.messages.length]);

  const admin =
    session.room.members.find((member) => member.id === session.memberId)
      ?.role === "admin";
  const onlineCount = session.room.members.filter(
    (member) => member.online,
  ).length;
  const initials = (value: string) =>
    value
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  async function invitePeople() {
    if (!admin) return;
    try {
      const result = await createInvite(session.room.id);
      setInvite(result.code);
      await navigator.clipboard?.writeText(result.code);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Could not create invite.",
      );
    }
  }

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    const body = message.trim();
    if (!body) return;
    try {
      await sendMessage(session.room.id, body);
      setMessage("");
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Could not send message.",
      );
    }
  }

  async function pickFile(file: File) {
    if (sendingRef.current) return;
    const channel = peers.current?.channel(recipient);
    if (!channel || channel.readyState !== "open") {
      onError("Choose a connected recipient first.");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      await createFileTransfer(channel, (sent, total) =>
        setFileProgress(
          `Sending ${total ? Math.round((sent / total) * 100) : 100}%`,
        ),
      )(file);
      setFileProgress(
        "File queued to peer. Ask the recipient to confirm receipt.",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "File transfer failed.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="room-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark small">RL</span>
          <span>RoomLink</span>
        </div>
        <div className="room-code">
          <span>{session.room.name}</span>
          <b>{session.room.code}</b>
        </div>
        <button
          className="icon-button"
          aria-label="Leave room"
          onClick={onLeave}
        >
          <LogOut size={18} />
        </button>
      </header>
      <div className="room-layout">
        <aside className="room-sidebar">
          <div className="side-title">
            <div>
              <p className="eyebrow">Your room</p>
              <h2>{session.room.name}</h2>
            </div>
            <span className="online-dot" />
          </div>
          <div className="invite-box">
            <div>
              <span className="invite-icon">
                <Link2 size={16} />
              </span>
              <div>
                <b>Invite people</b>
                <small>Share the room code</small>
              </div>
            </div>
            <button disabled={!admin} onClick={() => void invitePeople()}>
              {invite ? "Copied!" : "Invite"}
            </button>
            {invite && (
              <button
                className="copy-code"
                onClick={() => void navigator.clipboard?.writeText(invite)}
              >
                <Copy size={13} /> {invite}
              </button>
            )}
          </div>
          <div className="members-header">
            <span>
              <Users size={15} /> People
            </span>
            <b>{onlineCount}</b>
          </div>
          <div className="member-list">
            {session.room.members.map((member) => (
              <div className="member" key={member.id}>
                <span
                  className={`avatar ${member.role === "admin" ? "warm" : ""}`}
                >
                  {initials(member.displayName)}
                </span>
                <span>
                  <b>
                    {member.displayName}
                    {member.id === session.memberId ? " (you)" : ""}
                  </b>
                  <small>{member.role === "admin" ? "Host" : "Member"}</small>
                </span>
                <i className={member.online ? "online" : ""} />
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <span className="secure-dot" /> Direct WebRTC file sharing
          </div>
        </aside>
        <main className="chat-panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">The conversation</p>
              <h1>Say hello.</h1>
            </div>
            <div className="message-count">
              <MessageCircle size={16} /> {session.room.messages.length}
            </div>
          </div>
          <div className="messages">
            {session.room.messages.length === 0 && (
              <div className="empty-chat">
                <span>✦</span>
                <h3>This is your room.</h3>
                <p>Start with a hello, a plan, or a photo.</p>
              </div>
            )}
            {session.room.messages.map((item) => (
              <Message
                key={item.id}
                message={item}
                own={item.senderId === session.memberId}
                initials={initials}
              />
            ))}
            <div ref={messagesEnd} />
          </div>
          <div className="file-status">
            <label>
              File recipient{" "}
              <select
                aria-label="File recipient"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">Choose a connected peer</option>
                {connected.map((id) => (
                  <option key={id} value={id}>
                    {session.room.members.find((m) => m.id === id)
                      ?.displayName ?? id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {downloads.map((item) => (
            <div className="file-status" key={item.url}>
              <a href={item.url} download={item.name}>
                Download {item.name}
              </a>
            </div>
          ))}
          <form
            className="composer"
            onSubmit={(event) => void submitMessage(event)}
          >
            <label className="attach-button" title="Send a file">
              <Paperclip size={19} />
              <input
                disabled={sending || !connected.includes(recipient)}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void pickFile(file);
                  event.target.value = "";
                }}
              />
            </label>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write a message…"
              maxLength={2000}
            />
            <button className="send-button" aria-label="Send message">
              <Send size={18} />
            </button>
          </form>
          {fileProgress && (
            <div className="file-status">
              <FileUp size={14} /> {fileProgress}
            </div>
          )}
          {toast && (
            <div className="floating-error">
              <X size={15} /> {toast}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Message({
  message,
  own,
  initials,
}: {
  message: ChatMessage;
  own: boolean;
  initials: (name: string) => string;
}) {
  const time = useMemo(
    () =>
      new Date(message.sentAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    [message.sentAt],
  );
  return (
    <div className={`message-row ${own ? "own" : ""}`}>
      <span className="avatar">{initials(message.senderName)}</span>
      <div className="message-content">
        <div className="message-meta">
          <b>{own ? "You" : message.senderName}</b>
          <time>{time}</time>
        </div>
        <p>{message.body}</p>
      </div>
    </div>
  );
}
