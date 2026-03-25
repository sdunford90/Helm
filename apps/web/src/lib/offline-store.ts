/**
 * IndexedDB wrapper for offline dock walk data.
 *
 * Database: helm-offline
 * Stores:
 *   dock-walks       – pending dock walk records
 *   dock-walk-items  – per-slip inspection items
 *   violations       – queued violation reports
 *   photos           – blob storage for inspection photos
 *   sync-queue       – items waiting to sync
 */

const DB_NAME = 'helm-offline';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

// ---------------------------------------------------------------------------
// Open / initialise the database
// ---------------------------------------------------------------------------
export async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('dock-walks')) {
        const walkStore = db.createObjectStore('dock-walks', { keyPath: 'id' });
        walkStore.createIndex('status', 'status', { unique: false });
        walkStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('dock-walk-items')) {
        const itemStore = db.createObjectStore('dock-walk-items', { keyPath: 'id' });
        itemStore.createIndex('walkId', 'walkId', { unique: false });
      }

      if (!db.objectStoreNames.contains('violations')) {
        const violationStore = db.createObjectStore('violations', { keyPath: 'id' });
        violationStore.createIndex('walkItemId', 'walkItemId', { unique: false });
      }

      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('walkItemId', 'walkItemId', { unique: false });
      }

      if (!db.objectStoreNames.contains('sync-queue')) {
        const syncStore = db.createObjectStore('sync-queue', {
          keyPath: 'id',
          autoIncrement: true,
        });
        syncStore.createIndex('type', 'type', { unique: false });
        syncStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Reset the cached instance when the database is unexpectedly closed
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTransaction(
  storeName: string,
  mode: IDBTransactionMode = 'readonly',
): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  return openDB().then((db) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    return { store, tx };
  });
}

// ---------------------------------------------------------------------------
// Dock Walks
// ---------------------------------------------------------------------------
export async function saveDockWalk(walk: any): Promise<string> {
  const id = walk.id || generateId();
  const record = {
    ...walk,
    id,
    status: walk.status || 'pending',
    createdAt: walk.createdAt || new Date().toISOString(),
  };

  const { store } = await idbTransaction('dock-walks', 'readwrite');
  await idbRequest(store.put(record));
  await addToSyncQueue('dock-walk', record);
  return id;
}

export async function getPendingWalks(): Promise<any[]> {
  const { store } = await idbTransaction('dock-walks', 'readonly');
  const index = store.index('status');
  return idbRequest(index.getAll('pending'));
}

// ---------------------------------------------------------------------------
// Dock Walk Items
// ---------------------------------------------------------------------------
export async function saveDockWalkItem(item: any): Promise<string> {
  const id = item.id || generateId();
  const record = {
    ...item,
    id,
    createdAt: item.createdAt || new Date().toISOString(),
  };

  const { store } = await idbTransaction('dock-walk-items', 'readwrite');
  await idbRequest(store.put(record));
  await addToSyncQueue('dock-walk-item', record);
  return id;
}

export async function getPendingItems(walkId: string): Promise<any[]> {
  const { store } = await idbTransaction('dock-walk-items', 'readonly');
  const index = store.index('walkId');
  return idbRequest(index.getAll(walkId));
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------
export async function saveViolation(violation: any): Promise<string> {
  const id = violation.id || generateId();
  const record = {
    ...violation,
    id,
    createdAt: violation.createdAt || new Date().toISOString(),
  };

  const { store } = await idbTransaction('violations', 'readwrite');
  await idbRequest(store.put(record));
  await addToSyncQueue('violation', record);
  return id;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
export async function savePhoto(walkItemId: string, blob: Blob): Promise<string> {
  const id = generateId();
  const record = {
    id,
    walkItemId,
    blob,
    mimeType: blob.type,
    size: blob.size,
    createdAt: new Date().toISOString(),
  };

  const { store } = await idbTransaction('photos', 'readwrite');
  await idbRequest(store.put(record));
  await addToSyncQueue('photo', { id, walkItemId, mimeType: blob.type, size: blob.size });
  return id;
}

// ---------------------------------------------------------------------------
// Sync Queue
// ---------------------------------------------------------------------------
export async function addToSyncQueue(type: string, data: any): Promise<void> {
  const record = {
    type,
    data,
    createdAt: new Date().toISOString(),
  };

  const { store } = await idbTransaction('sync-queue', 'readwrite');
  await idbRequest(store.add(record));

  // Attempt to register a background sync if supported
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await (reg as any).sync.register('sync-dock-walks');
    } catch (_err) {
      // Background sync registration failed – will rely on online event
    }
  }
}

export async function getSyncQueue(): Promise<any[]> {
  const { store } = await idbTransaction('sync-queue', 'readonly');
  return idbRequest(store.getAll());
}

export async function clearSynced(ids: string[]): Promise<void> {
  const { store } = await idbTransaction('sync-queue', 'readwrite');
  for (const id of ids) {
    store.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------
export async function isOnline(): Promise<boolean> {
  if (!navigator.onLine) return false;

  // navigator.onLine can lie – do a lightweight fetch to confirm
  try {
    const response = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}
