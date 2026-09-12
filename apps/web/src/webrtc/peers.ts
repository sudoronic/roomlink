import { receiveFileTransfer } from "./fileTransfer";

type Signal = {
  from: string;
  to: string;
  signal: {
    type: string;
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
};
export function createPeers(
  self: string,
  send: (payload: Signal) => Promise<void>,
  progress: (text: string) => void,
  error: (text: string) => void,
  received: (file: File) => void,
  changed: (ids: string[]) => void,
) {
  const peers = new Map<string, RTCPeerConnection>();
  const channels = new Map<string, RTCDataChannel>();
  const pending = new Map<string, RTCIceCandidateInit[]>();
  let members = new Set<string>();
  let online = new Set<string>();
  let stopped = false;
  let queue = Promise.resolve();
  const report = (e: unknown) => {
    if (!stopped)
      error(e instanceof Error ? e.message : "Peer connection failed.");
  };
  const update = () => {
    if (!stopped)
      changed(
        [...channels]
          .filter(([, c]) => c.readyState === "open")
          .map(([id]) => id),
      );
  };
  const close = (id: string) => {
    const peer = peers.get(id);
    peers.delete(id);
    pending.delete(id);
    channels.get(id)?.close();
    channels.delete(id);
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.close();
    }
    update();
  };
  const attach = (id: string, channel: RTCDataChannel) => {
    if (
      channels.has(id) ||
      channel.label !== "files" ||
      !channel.ordered ||
      channel.maxRetransmits !== null ||
      channel.maxPacketLifeTime !== null
    ) {
      channel.close();
      return;
    }
    channels.set(id, channel);
    channel.binaryType = "arraybuffer";
    const receive = receiveFileTransfer(received, (n, total) =>
      progress(`Receiving ${total ? Math.round((n / total) * 100) : 100}%`),
    );
    channel.onmessage = (event) => {
      void receive(event).catch((e) => {
        report(e);
        close(id);
      });
    };
    channel.onopen = update;
    channel.onclose = update;
    channel.onerror = () => {
      report(new Error("File channel failed."));
      close(id);
    };
  };
  const connect = async (id: string, initiator: boolean) => {
    if (stopped || id === self || !members.has(id) || peers.has(id)) return;
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peers.set(id, peer);
    peer.onicecandidate = (event) => {
      if (event.candidate && !stopped)
        void send({
          from: self,
          to: id,
          signal: { type: "candidate", candidate: event.candidate.toJSON() },
        }).catch(report);
    };
    peer.ondatachannel = (event) => attach(id, event.channel);
    peer.onconnectionstatechange = () => {
      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "closed"
      )
        close(id);
      if (peer.connectionState === "disconnected")
        setTimeout(() => {
          if (peers.get(id) === peer && peer.connectionState === "disconnected")
            close(id);
        }, 5000);
    };
    if (initiator) {
      attach(id, peer.createDataChannel("files", { ordered: true }));
      await peer.setLocalDescription(await peer.createOffer());
      if (!stopped && peers.get(id) === peer)
        await send({
          from: self,
          to: id,
          signal: { type: "offer", description: peer.localDescription! },
        });
    }
  };
  const flush = async (id: string, peer: RTCPeerConnection) => {
    for (const candidate of pending.get(id) ?? [])
      await peer.addIceCandidate(candidate);
    pending.delete(id);
  };
  return {
    channel: (id: string) => channels.get(id),
    sync(ids: string[], present: string[]) {
      members = new Set(ids);
      online = new Set(present.filter((id) => members.has(id)));
      for (const id of peers.keys())
        if (!members.has(id) || !online.has(id)) close(id);
      for (const id of online)
        if (self < id)
          void connect(id, true).catch((e) => {
            close(id);
            report(e);
          });
    },
    signal(payload: unknown) {
      queue = queue
        .then(async () => {
          if (stopped || !payload || typeof payload !== "object") return;
          const p = payload as Signal;
          if (
            p.to !== self ||
            !members.has(p.from) ||
            p.from === self ||
            !p.signal ||
            JSON.stringify(p).length > 32_768
          )
            return;
          const { signal, from } = p;
          // A deterministic offerer prevents glare; candidate arrival is serialized and queued.
          if (
            signal.type === "offer" &&
            from < self &&
            signal.description?.type === "offer"
          ) {
            if (peers.get(from)?.signalingState === "stable") close(from);
            await connect(from, false);
            const peer = peers.get(from)!;
            await peer.setRemoteDescription(signal.description);
            await flush(from, peer);
            await peer.setLocalDescription(await peer.createAnswer());
            await send({
              from: self,
              to: from,
              signal: { type: "answer", description: peer.localDescription! },
            });
          } else if (
            signal.type === "answer" &&
            self < from &&
            signal.description?.type === "answer"
          ) {
            const peer = peers.get(from);
            if (peer?.signalingState === "have-local-offer") {
              await peer.setRemoteDescription(signal.description);
              await flush(from, peer);
            }
          } else if (signal.type === "candidate" && signal.candidate) {
            const peer = peers.get(from);
            if (peer?.remoteDescription)
              await peer.addIceCandidate(signal.candidate);
            else {
              const list = pending.get(from) ?? [];
              if (list.length < 128) list.push(signal.candidate);
              pending.set(from, list);
            }
          }
        })
        .catch(report);
    },
    stop() {
      stopped = true;
      for (const id of peers.keys()) close(id);
      pending.clear();
    },
  };
}
