const WebSocket = require("ws");

const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&encoding=linear16&sample_rate=16000&interim_results=true";

// callbacks: { onOpen, onTranscript({type: 'partial'|'final', text}), onError, onClose }
function connect(callbacks) {
  const ws = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });

  ws.on("open", () => callbacks.onOpen && callbacks.onOpen());

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type !== "Results") return;
    const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
    const text = alt && alt.transcript;
    if (!text) return;
    callbacks.onTranscript({
      type: msg.is_final ? "final" : "partial",
      text,
    });
  });

  ws.on("error", (err) => callbacks.onError && callbacks.onError(err));
  ws.on("close", () => callbacks.onClose && callbacks.onClose());

  return {
    sendAudio(buffer) {
      if (ws.readyState === WebSocket.OPEN) ws.send(buffer);
    },
    close() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      }
    },
  };
}

module.exports = { connect };
