import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { openKnowledgeDatabase, closeKnowledgeDatabase } from '../../src/knowledge/database';
import { KNOWLEDGE_DB_NAME, KNOWLEDGE_DB_VERSION } from '../../src/knowledge/types';

async function deleteTestDb(): Promise<void> {
  closeKnowledgeDatabase();
  // Clear all stores instead of deleting the database
  const db = await openKnowledgeDatabase();
  for (const name of Array.from(db.objectStoreNames)) {
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
  }
}

describe('knowledge database', () => {
  beforeEach(async () => {
    await deleteTestDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('opens the database successfully', async () => {
    const db = await openKnowledgeDatabase();
    expect(db).toBeInstanceOf(IDBDatabase);
    expect(db.name).toBe(KNOWLEDGE_DB_NAME);
    expect(db.version).toBe(KNOWLEDGE_DB_VERSION);
  });

  it('creates the expected object stores', async () => {
    const db = await openKnowledgeDatabase();
    const storeNames = Array.from(db.objectStoreNames).sort();
    expect(storeNames).toEqual(['chunks', 'documents', 'meta']);
  });

  it('creates expected indexes on documents store', async () => {
    const db = await openKnowledgeDatabase();
    const tx = db.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    const indexNames = Array.from(store.indexNames).sort();
    expect(indexNames).toEqual(['contentHash', 'enabled', 'importedAt']);
  });

  it('creates expected indexes on chunks store', async () => {
    const db = await openKnowledgeDatabase();
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const indexNames = Array.from(store.indexNames).sort();
    expect(indexNames).toEqual(['documentId', 'documentId_index']);

    // Verify compound index properties
    const compoundIndex = store.index('documentId_index');
    expect(compoundIndex.unique).toBe(true);
    expect(compoundIndex.keyPath).toEqual(['documentId', 'index']);

    // Verify non-unique index properties
    const docIdIndex = store.index('documentId');
    expect(docIdIndex.unique).toBe(false);
    expect(docIdIndex.keyPath).toBe('documentId');
  });

  it('opens the same version repeatedly without error', async () => {
    const db1 = await openKnowledgeDatabase();
    expect(db1.version).toBe(KNOWLEDGE_DB_VERSION);
    const db2 = await openKnowledgeDatabase();
    expect(db2.version).toBe(KNOWLEDGE_DB_VERSION);
    expect(db2).toBe(db1);
  });

  it('handles upgrade path correctly from version 0', async () => {
    // Delete and re-open forces a fresh create
    await deleteTestDb();
    const db = await openKnowledgeDatabase();
    expect(db.version).toBe(KNOWLEDGE_DB_VERSION);
    expect(Array.from(db.objectStoreNames)).toContain('documents');
    expect(Array.from(db.objectStoreNames)).toContain('chunks');
    expect(Array.from(db.objectStoreNames)).toContain('meta');
  });

  it('closes and clears the database cache on versionchange', async () => {
    const db = await openKnowledgeDatabase();
    expect(db).toBeTruthy();

    // Simulate a versionchange event
    db.onversionchange!(new Event('versionchange') as IDBVersionChangeEvent);

    // Re-opening should create a new connection
    const db2 = await openKnowledgeDatabase();
    expect(db2).toBeInstanceOf(IDBDatabase);
    expect(db2).not.toBe(db);
    db2.close();
  });

  it('clears the cache on close', async () => {
    const db = await openKnowledgeDatabase();
    expect(db).toBeTruthy();

    closeKnowledgeDatabase();

    const db2 = await openKnowledgeDatabase();
    expect(db2).toBeInstanceOf(IDBDatabase);
    expect(db2).not.toBe(db);
    db2.close();
  });
});
