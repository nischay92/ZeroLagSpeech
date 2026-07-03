import { useRef, useState } from "react";
import { askQuestion, startSession, type Provider, type SidecarSession } from "./sidecar";

interface QaEntry {
  question: string;
  answer: string;
  source?: "auto" | "manual";
}

function App() {
  const [status, setStatus] = useState("Desktop shell ready");
  const [provider, setProvider] = useState<Provider>("deepgram");
  const [isRecording, setIsRecording] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [notes, setNotes] = useState("Press Start Recording to demo a live transcription flow.");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [qaLog, setQaLog] = useState<QaEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const sessionRef = useRef<SidecarSession | null>(null);
  const finalTextRef = useRef("");

  const startRecording = async () => {
    setStatus("Requesting microphone...");
    setFinalText("");
    setInterimText("");
    setNotes("");
    setQaLog([]);
    finalTextRef.current = "";

    try {
      const session = await startSession(provider, {
        onConnected: () => setStatus(`Listening (${provider})`),
        onTranscript: ({ text, is_final }) => {
          if (is_final) {
            finalTextRef.current = finalTextRef.current ? `${finalTextRef.current} ${text}` : text;
            setFinalText(finalTextRef.current);
            setInterimText("");
          } else {
            setInterimText(text);
          }
        },
        onInference: ({ kind, text, question: q, source }) => {
          if (kind === "notes") {
            setNotes(text);
          } else {
            setQaLog((log) => [...log, { question: q ?? "", answer: text, source }]);
          }
        },
        onLatency: ({ cerebrasLatencyMs }) => setLatencyMs(cerebrasLatencyMs),
        onStatus: ({ status: s, message }) => setStatus(message ?? s),
        onError: ({ message }) => setStatus(`Error: ${message}`),
        onCompleted: () => setStatus("Session completed"),
      });
      sessionRef.current = session;
      setIsRecording(true);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stopRecording = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setIsRecording(false);
    setStatus("Stopped");
  };

  const submitQuestion = async () => {
    const q = question.trim();
    const sessionId = sessionRef.current?.sessionId;
    if (!q || !sessionId) return;
    setQuestion("");
    setAsking(true);
    try {
      const answer = await askQuestion(sessionId, q);
      setQaLog((log) => [...log, { question: q, answer, source: "manual" }]);
    } catch (err) {
      setQaLog((log) => [
        ...log,
        { question: q, answer: `Error: ${err instanceof Error ? err.message : String(err)}`, source: "manual" },
      ]);
    } finally {
      setAsking(false);
    }
  };

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
          <select
            value={provider}
            disabled={isRecording}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            <option value="deepgram">Deepgram</option>
            <option value="elevenlabs">ElevenLabs</option>
          </select>

          {!isRecording ? (
            <button onClick={() => void startRecording()}>Start Recording</button>
          ) : (
            <button className="secondary" onClick={stopRecording}>
              Stop Recording
            </button>
          )}
        </div>

        <section className="panel">
          <div className="panel-header">
            <span>Live Transcript</span>
            <span className="latency">
              {latencyMs !== null ? `${latencyMs}ms inference latency` : "no inference yet"}
            </span>
          </div>
          <p>
            {finalText}
            {interimText && <span className="interim"> {interimText}</span>}
            {!finalText && !interimText && "Press Start Recording to demo a live transcription flow."}
          </p>
        </section>

        <section className="panel">
          <div className="panel-header">
            <span>Notes (Cerebras)</span>
          </div>
          <p>{notes}</p>
        </section>

        <section className="panel">
          <div className="panel-header">
            <span>Ask about this session</span>
          </div>
          <div className="qa-log">
            {qaLog.map((entry, i) => (
              <div className="qa-item" key={i}>
                <div className="q">
                  Q: {entry.question}
                  {entry.source === "auto" && <span className="tag"> (from speech)</span>}
                </div>
                <div className="a">A: {entry.answer}</div>
              </div>
            ))}
          </div>
          <form
            className="qa-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitQuestion();
            }}
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              disabled={!isRecording || asking}
            />
            <button type="submit" disabled={!isRecording || asking}>
              Ask
            </button>
          </form>
        </section>

        <div className="providers">
          <span>Deepgram: Ready</span>
          <span>ElevenLabs: Ready</span>
          <span>Cerebras: Ready</span>
        </div>
      </section>
    </main>
  );
}

export default App;
