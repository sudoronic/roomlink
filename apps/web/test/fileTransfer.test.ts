import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFileTransfer,
  receiveFileTransfer,
  MAX_FILE_SIZE,
} from "../src/webrtc/fileTransfer";
const event = (data: string | ArrayBuffer) =>
  ({ data }) as MessageEvent<string | ArrayBuffer>;
const start = (size: number) =>
  event(
    JSON.stringify({
      kind: "file-start",
      name: "test.txt",
      mimeType: "text/plain",
      size,
    }),
  );
test("direct transfer round-trips chunked bytes and zero byte files", async () => {
  for (const size of [0, 2, 40_000]) {
    let output: File | undefined;
    const receiver = receiveFileTransfer(
      (file) => {
        output = file;
      },
      () => {},
    );
    const pending: Promise<void>[] = [];
    const channel = {
      readyState: "open",
      bufferedAmount: 0,
      send: (data: string | ArrayBuffer) => {
        pending.push(receiver(event(data)));
      },
      close() {},
    } as unknown as RTCDataChannel;
    const input = new File([new Uint8Array(size).fill(37)], "test.txt");
    await createFileTransfer(channel, () => {})(input);
    await Promise.all(pending);
    assert.ok(output);
    assert.deepEqual(await output.arrayBuffer(), await input.arrayBuffer());
  }
});
test("rejects oversized metadata, missing starts, oversized chunks and truncated files", async () => {
  const receive = receiveFileTransfer(
    () => assert.fail("must not complete"),
    () => {},
  );
  await assert.rejects(receive(start(MAX_FILE_SIZE + 1)), /Invalid/);
  await assert.rejects(receive(event(new ArrayBuffer(1))), /Invalid/);
  await receive(start(3));
  await assert.rejects(
    receive(event(JSON.stringify({ kind: "file-end" }))),
    /Incomplete/,
  );
  await receive(start(3));
  await assert.rejects(receive(event(new ArrayBuffer(4))), /Invalid/);
});
test("sender rejects oversized files and disconnected peers", async () => {
  const channel = { readyState: "closed" } as RTCDataChannel;
  await assert.rejects(
    createFileTransfer(channel, () => {})(new File([], "x")),
    /not connected/,
  );
  await assert.rejects(
    createFileTransfer(channel, () => {})({ size: MAX_FILE_SIZE + 1 } as File),
    /50 MiB/,
  );
});
