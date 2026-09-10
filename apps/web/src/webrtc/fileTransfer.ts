export const FILE_CHUNK_SIZE = 16_384;

export interface FileChunk {
  kind: "file-start" | "file-chunk" | "file-end";
  name?: string;
  mimeType?: string;
  size?: number;
  data?: ArrayBuffer;
}

export function createFileTransfer(
  channel: RTCDataChannel,
  onProgress: (sentBytes: number, totalBytes: number) => void
) {
  channel.binaryType = "arraybuffer";
  return async (file: File) => {
    channel.send(JSON.stringify({ kind: "file-start", name: file.name, mimeType: file.type, size: file.size }));
    let offset = 0;
    while (offset < file.size) {
      const chunk = await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer();
      channel.send(chunk);
      offset += chunk.byteLength;
      onProgress(offset, file.size);
      if (channel.bufferedAmount > FILE_CHUNK_SIZE * 8) {
        await new Promise<void>((resolve) => {
          const waitForDrain = () => {
            channel.removeEventListener("bufferedamountlow", waitForDrain);
            resolve();
          };
          channel.bufferedAmountLowThreshold = FILE_CHUNK_SIZE * 2;
          channel.addEventListener("bufferedamountlow", waitForDrain);
        });
      }
    }
    channel.send(JSON.stringify({ kind: "file-end" }));
  };
}

export function receiveFileTransfer(
  onComplete: (file: File) => void,
  onProgress: (receivedBytes: number, totalBytes: number) => void
) {
  let name = "download";
  let mimeType = "application/octet-stream";
  let total = 0;
  let received = 0;
  let chunks: BlobPart[] = [];

  return async (event: MessageEvent<string | ArrayBuffer | Blob>) => {
    if (typeof event.data === "string") {
      const control = JSON.parse(event.data) as FileChunk;
      if (control.kind === "file-start") {
        name = control.name ?? name;
        mimeType = control.mimeType ?? mimeType;
        total = control.size ?? 0;
        received = 0;
        chunks = [];
      } else if (control.kind === "file-end") {
        onComplete(new File(chunks, name, { type: mimeType }));
      }
      return;
    }
    const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
    chunks.push(data);
    received += data.byteLength;
    onProgress(received, total);
  };
}
