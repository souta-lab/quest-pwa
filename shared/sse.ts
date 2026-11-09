export type SSEvent = { event: string; data: string };

// Decode bytes incrementally: a network chunk need not end on a UTF-8 character,
// line, or event boundary. Limits also apply to unterminated events.
export async function* readSSE(
  stream: ReadableStream<Uint8Array>,
  maxBytes = 200000,
): AsyncGenerator<SSEvent> {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    size = 0,
    event = "message",
    data: string[] = [],
    complete = false;
  try {
    for (;;) {
      const part = await reader.read();
      size += part.value?.byteLength ?? 0;
      if (size > maxBytes) throw Error("stream_too_large");
      buffer += decoder.decode(part.value, { stream: !part.done });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (!line) {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        } else if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
      if (part.done) {
        complete = true;
        break;
      }
    }
    // Events require a blank-line terminator. An interrupted frame is discarded.
    if (buffer.trim() || data.length) throw Error("stream_interrupted");
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
