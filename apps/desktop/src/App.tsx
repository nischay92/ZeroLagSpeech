import { useState } from "react";

const sidecarUrl = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:43110";

function App() {
  const [status, setStatus] = useState("Desktop shell ready");
  const [transcript, setTranscript] = useState(
    "Press Start Recording to demo a live transcription flow.",
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ZeroLag Desktop</p>
        <h1>Voice intelligence, running on your machine.</h1>

        <p className="lede">
          A macOS-first desktop shell for low-latency speech capture,
          transcription, and AI-powered response generation.
        </p>

        <div className="status" aria-label="Desktop foundation status">
          <span className="status-dot" />
          <span>{status}</span>
        </div>

        <div className="actions">
          <button
            onClick={() => {
              setStatus("Recording audio...");
              setTranscript("Listening... capturing microphone input locally.");
            }}
          >
            Start Recording
          </button>

          <button
            onClick={() => {
              setStatus("Transcribing with Deepgram...");
              setTranscript(
                "Demo transcript: ZeroLag converts live speech into clean text with low latency.",
              );
            }}
          >
            Run Deepgram Demo
          </button>

          <button
            onClick={() => {
              setStatus("Generating response with Cerebras...");
              setTranscript(
                "AI response: Your transcript is ready for fast inference and structured output.",
              );
            }}
          >
            Run Cerebras Demo
          </button>

          <button
            className="secondary"
            onClick={() => {
              setStatus("Demo reset");
              setTranscript(
                "Press Start Recording to demo a live transcription flow.",
              );
            }}
          >
            Reset
          </button>
        </div>

        <section className="panel">
          <div className="panel-header">
            <span>Live Transcript</span>
            <span className="latency">42ms demo latency</span>
          </div>
          <p>{transcript}</p>
        </section>

        <div className="providers">
          <span>Deepgram: Ready</span>
          <span>ElevenLabs: Optional</span>
          <span>Cerebras: Ready</span>
        </div>

        <p className="endpoint">Sidecar contract: {sidecarUrl}</p>
      </section>
    </main>
  );
}

export default App;
