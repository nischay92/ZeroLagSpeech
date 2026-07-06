const Cerebras = require("@cerebras/cerebras_cloud_sdk").default;

const MODEL = "gpt-oss-120b";

// Constructed lazily (not at module load) so a missing key surfaces as a
// normal per-call error the server can catch and report, rather than
// crashing the whole sidecar process at startup — matters for first-run
// users who haven't saved a Cerebras key in ProviderSettings yet.
let client = null;
function getClient() {
  if (!client) {
    if (!process.env.CEREBRAS_API_KEY) {
      throw new Error("CEREBRAS_API_KEY is not configured");
    }
    client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY, maxRetries: 0 });
  }
  return client;
}

// `newTranscript` is only the text spoken since the last summary (not the
// whole session) — keeps token usage roughly constant per call regardless
// of how long the session runs, so long sessions don't blow a tokens/min
// rate limit. `previousSummary` carries prior context forward instead.
async function summarize(newTranscript, previousSummary) {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a note-taking assistant maintaining a running summary of a live speech transcript. You'll be given the current summary and only the newest transcript text since that summary was made. Merge the new information into an updated, concise bullet-point summary. Only include information present in the summary or new text. Return just the bullet points, no preamble.",
      },
      {
        role: "user",
        content: `Current summary:\n${previousSummary || "(none yet)"}\n\nNewest transcript since last summary:\n${newTranscript}\n\nProduce the updated summary.`,
      },
    ],
  });
  return response.choices[0].message.content.trim();
}

async function answerQuestion(transcript, question) {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a real-time assistant listening to a live conversation transcript. Answer the user's question directly and factually, using your own general knowledge. Use the transcript as context if it's relevant to the question, but you are not limited to it.",
      },
      {
        role: "user",
        content: `Transcript so far:\n${transcript || "(empty)"}\n\nQuestion: ${question}`,
      },
    ],
  });
  return response.choices[0].message.content.trim();
}

// Called periodically to auto-detect and answer questions or information
// requests that appeared in newly finalized transcript text, in real time.
async function respondIfQuestion(transcriptSoFar, latestSegment) {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          'You monitor a live speech transcript segment by segment. Given the full transcript so far and the newest segment, decide if the newest segment asks a question or requests information (e.g. "what is the capital of India"). If so, answer it directly and concisely using your own general knowledge, using the transcript as context if relevant. If the newest segment is not a question and needs no answer, reply with exactly: NONE',
      },
      {
        role: "user",
        content: `Full transcript so far:\n${transcriptSoFar}\n\nNewest segment: "${latestSegment}"`,
      },
    ],
  });
  const text = response.choices[0].message.content.trim();
  if (!text || text.toUpperCase() === "NONE") return null;
  return text;
}

module.exports = { summarize, answerQuestion, respondIfQuestion };
