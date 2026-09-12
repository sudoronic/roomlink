export const FILE_CHUNK_SIZE = 16_384;
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
const activeSenders = new WeakSet<RTCDataChannel>();

function drain(channel: RTCDataChannel) {
  if (channel.readyState !== "open")
    return Promise.reject(new Error("Peer disconnected."));
  if (channel.bufferedAmount <= FILE_CHUNK_SIZE * 8) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", ready);
      channel.removeEventListener("close", closed);
      channel.removeEventListener("error", closed);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const closed = () => finish(new Error("Transfer connection closed."));
    const timer = setTimeout(
      () => finish(new Error("Transfer timed out.")),
      30_000,
    );
    channel.bufferedAmountLowThreshold = FILE_CHUNK_SIZE * 2;
    channel.addEventListener("bufferedamountlow", ready);
    channel.addEventListener("close", closed);
    channel.addEventListener("error", closed);
    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish();
  });
}

export function createFileTransfer(
  channel: RTCDataChannel,
  onProgress: (sent: number, total: number) => void,
) {
  return async (file: File) => {
    if (file.size > MAX_FILE_SIZE)
      throw new Error("Files must be at most 50 MiB.");
    if (activeSenders.has(channel))
      throw new Error("Wait for the current transfer to finish.");
    if (channel.readyState !== "open")
      throw new Error("Peer is not connected.");
    activeSenders.add(channel);
    try {
      channel.send(
        JSON.stringify({
          kind: "file-start",
          name: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      );
      for (let offset = 0; offset < file.size;) {
        await drain(channel);
        const chunk = await file
          .slice(offset, offset + FILE_CHUNK_SIZE)
          .arrayBuffer();
        if (channel.readyState !== "open")
          throw new Error("Peer disconnected.");
        channel.send(chunk);
        offset += chunk.byteLength;
        onProgress(offset, file.size);
      }
      await drain(channel);
      channel.send(JSON.stringify({ kind: "file-end" }));
    } catch (error) {
      channel.close();
      throw error;
    } finally {
      activeSenders.delete(channel);
    }
  };
}

export function receiveFileTransfer(
  onComplete: (file: File) => void,
  onProgress: (received: number, total: number) => void,
) {
  let metadata: { name: string; mimeType: string; size: number } | undefined;
  let received = 0;
  let chunks: BlobPart[] = [];
  return async (event: MessageEvent<string | ArrayBuffer | Blob>) => {
    try {
      if (typeof event.data === "string") {
        if (event.data.length > 2048)
          throw new Error("Oversized transfer metadata.");
        const control = JSON.parse(event.data);
        if (control?.kind === "file-start") {
          if (
            metadata ||
            typeof control.name !== "string" ||
            !control.name.length ||
            control.name.length > 255 ||
            typeof control.mimeType !== "string" ||
            control.mimeType.length > 255 ||
            !Number.isSafeInteger(control.size) ||
            control.size < 0 ||
            control.size > MAX_FILE_SIZE
          ) {
            throw new Error(
              "Invalid transfer metadata or file exceeds 50 MiB.",
            );
          }
          metadata = {
            name: control.name.replace(/[\\/\x00-\x1f]/g, "_"),
            mimeType: control.mimeType,
            size: control.size,
          };
          received = 0;
          chunks = [];
        } else if (control?.kind === "file-end") {
          if (!metadata || received !== metadata.size)
            throw new Error("Incomplete file received.");
          const file = new File(chunks, metadata.name, {
            type: metadata.mimeType,
          });
          metadata = undefined;
          chunks = [];
          onComplete(file);
        } else throw new Error("Unknown transfer message.");
        return;
      }
      if (!(event.data instanceof ArrayBuffer))
        throw new Error("Unexpected transfer data.");
      if (
        !metadata ||
        event.data.byteLength > FILE_CHUNK_SIZE ||
        received + event.data.byteLength > metadata.size
      ) {
        throw new Error("Invalid file chunk.");
      }
      chunks.push(event.data);
      received += event.data.byteLength;
      onProgress(received, metadata.size);
    } catch (error) {
      metadata = undefined;
      chunks = [];
      throw error;
    }
  };
}
