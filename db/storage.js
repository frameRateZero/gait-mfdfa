/**
 * db/storage.js
 * =============
 * IndexedDB wrapper for GAIT MFDFA PWA.
 *
 * Schema
 * ------
 * DB: "gait_mfdfa"  version 1
 *   store: "sessions"      — keyPath: "session_id"
 *     index: "participant_id"
 *     index: "processed_at"
 *
 * Each record is the full sessionResult object from mfdfa.worker.js.
 */

const DB_NAME    = "gait_mfdfa";
const DB_VERSION = 1;
const STORE      = "sessions";

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "session_id" });
        store.createIndex("participant_id", "metadata.participant_id", { unique: false });
        store.createIndex("processed_at",  "processed_at",            { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function saveSession(sessionResult) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(sessionResult);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function getSession(session_id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(session_id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function getAllSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(STORE, "readonly");
    const req  = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Get all sessions for a participant, sorted by processed_at ascending */
export async function getSessionsByParticipant(participant_id) {
  const all = await getAllSessions();
  return all
    .filter((s) => s.metadata?.participant_id === participant_id)
    .sort((a, b) => (a.processed_at < b.processed_at ? -1 : 1));
}

export async function deleteSession(session_id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(session_id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** List all unique participant IDs */
export async function listParticipants() {
  const all = await getAllSessions();
  return [...new Set(all.map((s) => s.metadata?.participant_id).filter(Boolean))];
}
