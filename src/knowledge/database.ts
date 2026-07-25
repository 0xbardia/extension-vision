import { KNOWLEDGE_DB_NAME, KNOWLEDGE_DB_VERSION } from './types';
import { KnowledgeError } from './errors';

let dbCache: IDBDatabase | null = null;

export async function openKnowledgeDatabase(): Promise<IDBDatabase> {
  if (dbCache) return dbCache;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(KNOWLEDGE_DB_NAME, KNOWLEDGE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction!;
      upgradeDatabase(db, tx);
    };

    request.onsuccess = () => {
      const db = request.result;

      // Handle versionchange from another context (e.g., extension update)
      db.onversionchange = () => {
        db.close();
        dbCache = null;
      };

      db.onclose = () => {
        dbCache = null;
      };

      dbCache = db;
      resolve(db);
    };

    request.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_DB_OPEN_FAILED',
          'Failed to open the knowledge database.',
          request.error?.message ?? 'indexedDB.open failed',
        ),
      );
    };

    request.onblocked = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_DB_BLOCKED',
          'The knowledge database open request was blocked.',
          'Another extension context has the database open.',
        ),
      );
    };
  });
}

function upgradeDatabase(db: IDBDatabase, tx: IDBTransaction): void {
  // Meta store — key-value metadata
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'key' });
  }

  // Documents store
  if (!db.objectStoreNames.contains('documents')) {
    const docStore = db.createObjectStore('documents', { keyPath: 'id' });
    docStore.createIndex('contentHash', 'contentHash', { unique: true });
    docStore.createIndex('enabled', 'enabled', { unique: false });
    docStore.createIndex('importedAt', 'importedAt', { unique: false });
  }

  // Chunks store
  if (!db.objectStoreNames.contains('chunks')) {
    const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
    chunkStore.createIndex('documentId', 'documentId', { unique: false });
    chunkStore.createIndex('documentId_index', ['documentId', 'index'], { unique: true });
  }
}

export function closeKnowledgeDatabase(): void {
  if (dbCache) {
    dbCache.close();
    dbCache = null;
  }
}
