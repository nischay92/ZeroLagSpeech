const WebSocket = require("ws");

const ELEVENLABS_URL =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime?audio_format=pcm_16000&sample_rate=16000&language_code=en&commit_strategy=vad&include_timestamps=false";

// callbacks: { onOpen, onTranscript({type: 'partial'|'final', text}), onError, onClose }
function connect(callbacks) {
  const ws = new WebSocket(ELEVENLABS_URL, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
  });

  ws.on("open", () => callbacks.onOpen && callbacks.onOpen());

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.message_type === "partial_transcript" && msg.text) {
      callbacks.onTranscript({ type: "partial", text: msg.text });
    } else if (
      (msg.message_type === "committed_transcript" ||
        msg.message_type === "committed_transcript_with_timestamps") &&
      msg.text
    ) {
      callbacks.onTranscript({ type: "final", text: msg.text });
    } else if (
      msg.message_type === "auth_error" ||
      msg.message_type === "quota_exceeded" ||
      msg.message_type === "rate_limited" ||
      msg.message_type === "input_error"
    ) {
      callbacks.onError && callbacks.onError(new Error(`${msg.message_type}: ${msg.message || ""}`));
    }
  });

  ws.on("error", (err) => callbacks.onError && callbacks.onError(err));
  ws.on("close", () => callbacks.onClose && callbacks.onClose());

  return {
    sendAudio(buffer) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: buffer.toString("base64"),
            commit: false,
            sample_rate: 16000,
          })
        );
      }
    },
    close() {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };
}

module.exports = { connect };
