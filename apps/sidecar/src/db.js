const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// In a packaged app, NOTES_DB_PATH points at a user-writable location (set
// by the externalBin wrapper script) since the app bundle itself isn't
// writable. In local dev, this env var is unset and notes.db just lives
// next to the source, as before.
const dbPath = process.env.NOTES_DB_PATH || path.join(__dirname, "..", "notes.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
`);

const qaColumns = db.prepare("PRAGMA table_info(qa)").all().map((c) => c.name);
if (!qaColumns.includes("source")) {
  db.exec("ALTER TABLE qa ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
}

function createSession(sessionId, provider) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sessions (id, provider, started_at) VALUES (?, ?, ?)").run(
    sessionId,
    provider,
    now
  );
}

function endSession(sessionId) {
  db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    sessionId
  );
}

function addTranscript(sessionId, text) {
  db.prepare(
    "INSERT INTO transcripts (session_id, text, created_at) VALUES (?, ?, ?)"
  ).run(sessionId, text, new Date().toISOString());
}

function addSummary(sessionId, summary) {
  db.prepare(
    "INSERT INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)"
  ).run(sessionId, summary, new Date().toISOString());
}

function addQa(sessionId, question, answer, source = "manual") {
  db.prepare(
    "INSERT INTO qa (session_id, question, answer, source, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(sessionId, question, answer, source, new Date().toISOString());
}

function listSessions() {
  return db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all();
}

function getSession(sessionId) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return null;
  const transcripts = db
    .prepare("SELECT * FROM transcripts WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
  const summaries = db
    .prepare("SELECT * FROM summaries WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
  const qaHistory = db
    .prepare("SELECT * FROM qa WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
  return { ...session, transcripts, summaries, qa: qaHistory };
}

function getTranscriptText(sessionId) {
  const rows = db
    .prepare("SELECT text FROM transcripts WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
  return rows.map((r) => r.text).join(" ");
}

function getLatestSummary(sessionId) {
  const row = db
    .prepare("SELECT summary FROM summaries WHERE session_id = ? ORDER BY id DESC LIMIT 1")
    .get(sessionId);
  return row ? row.summary : "";
}

module.exports = {
  db,
  createSession,
  endSession,
  addTranscript,
  addSummary,
  addQa,
  listSessions,
  getSession,
  getTranscriptText,
  getLatestSummary,
};
