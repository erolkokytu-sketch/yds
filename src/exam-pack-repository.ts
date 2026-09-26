import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DB_NAME,
  DB_VERSION,
  EXAM_PACK_STORE,
  SESSION_STORE,
} from "./session-repository";
import type { ExamPack, InstalledExamPack, StoredExamSession } from "./types";

interface YdsStudyDatabase extends DBSchema {
  examSessions: {
    key: string;
    value: StoredExamSession;
    indexes: {
      "by-exam-id": string;
      "by-updated-at": number;
    };
  };
  examPacks: {
    key: string;
    value: InstalledExamPack;
    indexes: {
      "by-installed-at": number;
    };
  };
}

export type InstallExamPackResult =
  | { status: "installed"; record: InstalledExamPack }
  | { status: "duplicate"; record: InstalledExamPack }
  | { status: "conflict"; record: InstalledExamPack };

export interface ExamPackRepositoryContract {
  listInstalled(): Promise<InstalledExamPack[]>;
  getInstalled(examId: string): Promise<InstalledExamPack | null>;
  install(
    examPack: ExamPack,
    fingerprint: string,
    installedAt?: number,
  ): Promise<InstallExamPackResult>;
}

export class ExamPackRepository implements ExamPackRepositoryContract {
  private readonly databasePromise: Promise<IDBPDatabase<YdsStudyDatabase>>;

  constructor(databaseName = DB_NAME) {
    this.databasePromise = openDB<YdsStudyDatabase>(databaseName, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
          store.createIndex("by-exam-id", "examId");
          store.createIndex("by-updated-at", "updatedAt");
        }
        if (!database.objectStoreNames.contains(EXAM_PACK_STORE)) {
          const store = database.createObjectStore(EXAM_PACK_STORE, { keyPath: "id" });
          store.createIndex("by-installed-at", "installedAt");
        }
      },
    });
  }

  async listInstalled(): Promise<InstalledExamPack[]> {
    const database = await this.databasePromise;
    const records = await database.getAll(EXAM_PACK_STORE);
    return records.sort((left, right) => left.installedAt - right.installedAt)
      .map((record) => structuredClone(record));
  }

  async getInstalled(examId: string): Promise<InstalledExamPack | null> {
    const database = await this.databasePromise;
    const record = await database.get(EXAM_PACK_STORE, examId);
    return record ? structuredClone(record) : null;
  }

  async install(
    examPack: ExamPack,
    fingerprint: string,
    installedAt = Date.now(),
  ): Promise<InstallExamPackResult> {
    const database = await this.databasePromise;
    const transaction = database.transaction(EXAM_PACK_STORE, "readwrite");
    const existing = await transaction.store.get(examPack.id);
    if (existing) {
      await transaction.done;
      return {
        status: existing.fingerprint === fingerprint ? "duplicate" : "conflict",
        record: structuredClone(existing),
      };
    }

    const record: InstalledExamPack = structuredClone({
      id: examPack.id,
      schemaVersion: examPack.schemaVersion,
      title: examPack.title,
      installedAt,
      fingerprint,
      examPack,
    });
    await transaction.store.add(record);
    await transaction.done;
    return { status: "installed", record: structuredClone(record) };
  }

  async clearAllForTests(): Promise<void> {
    const database = await this.databasePromise;
    await database.clear(EXAM_PACK_STORE);
  }
}

export const defaultExamPackRepository = new ExamPackRepository();
