import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validateSessionForRestore } from "./session-validation";
import type { ExamSession, StoredExamSession } from "./types";

export const DB_NAME = "yds-study";
export const DB_VERSION = 1;
export const SESSION_STORE = "examSessions";
export const SESSION_STORAGE_VERSION = 1;

interface YdsStudyDatabase extends DBSchema {
  examSessions: {
    key: string;
    value: StoredExamSession;
    indexes: {
      "by-exam-id": string;
      "by-updated-at": number;
    };
  };
}

export interface SessionRepositoryContract {
  saveSession(session: ExamSession, updatedAt?: number): Promise<void>;
  loadSession(sessionId: string): Promise<ExamSession | null>;
  findActiveSessionForExam(examId: string): Promise<ExamSession | null>;
  findLatestSessionForExam(examId: string): Promise<ExamSession | null>;
  listActiveSessions(): Promise<ExamSession[]>;
  deleteSession(sessionId: string): Promise<void>;
  flush(): Promise<void>;
}

function sessionFromRecord(record: StoredExamSession): ExamSession {
  const { storageVersion: _storageVersion, updatedAt: _updatedAt, ...session } = record;
  return structuredClone(session);
}

function validSessionFromRecord(record: StoredExamSession): ExamSession | null {
  if (record.storageVersion !== SESSION_STORAGE_VERSION) {
    console.error(`[session-storage] unsupported storage version for ${record.id}`);
    return null;
  }
  const session = sessionFromRecord(record);
  const validation = validateSessionForRestore(session);
  if (!validation.valid) {
    console.error(`[session-storage] ignored invalid session ${record.id}: ${validation.errors.join("; ")}`);
    return null;
  }
  return session;
}

export class SessionRepository implements SessionRepositoryContract {
  private readonly databasePromise: Promise<IDBPDatabase<YdsStudyDatabase>>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(databaseName = DB_NAME) {
    this.databasePromise = openDB<YdsStudyDatabase>(databaseName, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
          store.createIndex("by-exam-id", "examId");
          store.createIndex("by-updated-at", "updatedAt");
        }
      },
    });
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async saveSession(session: ExamSession, updatedAt = Date.now()): Promise<void> {
    const record: StoredExamSession = structuredClone({
      ...session,
      storageVersion: SESSION_STORAGE_VERSION,
      updatedAt,
    });
    return this.enqueueWrite(async () => {
      const database = await this.databasePromise;
      await database.put(SESSION_STORE, record);
    });
  }

  async loadSession(sessionId: string): Promise<ExamSession | null> {
    await this.flush();
    const database = await this.databasePromise;
    const record = await database.get(SESSION_STORE, sessionId);
    return record ? validSessionFromRecord(record) : null;
  }

  async findLatestSessionForExam(examId: string): Promise<ExamSession | null> {
    await this.flush();
    const database = await this.databasePromise;
    const records = await database.getAllFromIndex(SESSION_STORE, "by-exam-id", examId);
    records.sort((left, right) => right.updatedAt - left.updatedAt);
    for (const record of records) {
      const session = validSessionFromRecord(record);
      if (session && ["RUNNING", "PAUSED", "EXPIRED"].includes(session.state)) return session;
    }
    return null;
  }

  async findActiveSessionForExam(examId: string): Promise<ExamSession | null> {
    const session = await this.findLatestSessionForExam(examId);
    return session && ["RUNNING", "PAUSED"].includes(session.state) ? session : null;
  }

  async listActiveSessions(): Promise<ExamSession[]> {
    await this.flush();
    const database = await this.databasePromise;
    const records = await database.getAll(SESSION_STORE);
    return records
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(validSessionFromRecord)
      .filter((session): session is ExamSession =>
        session !== null && ["RUNNING", "PAUSED"].includes(session.state));
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const database = await this.databasePromise;
      await database.delete(SESSION_STORE, sessionId);
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async clearAllForTests(): Promise<void> {
    await this.flush();
    const database = await this.databasePromise;
    await database.clear(SESSION_STORE);
  }

  async putRawForTests(record: StoredExamSession): Promise<void> {
    await this.flush();
    const database = await this.databasePromise;
    await database.put(SESSION_STORE, record);
  }
}

export const defaultSessionRepository = new SessionRepository();
