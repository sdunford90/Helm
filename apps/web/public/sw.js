/// Helm Marina – Service Worker for Offline Dock Walks

// Bumping the version evicts the previous cache on activate. Bump this
// any time the navigation strategy or pre-cached asset list changes
// (and any time you suspect users may be stuck on a stale shell).
const CACHE_NAME = 'helm-app-shell-v6';

// IMPORTANT: Do NOT pre-cache '/' here. The HTML shell references a
// content-hashed JS bundle (e.g. /assets/index-AbCd1234.js); after a
// new deploy the old bundle URL 404s, so a cached old shell would
// permanently white-screen returning users until they manually
// unregister the SW. We treat HTML navigations as network-first below
// and only fall back to the cached '/' if we ever fetched it once
// while online.
const APP_SHELL_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

const DB_NAME = 'helm-offline';
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// Install – pre-cache the app shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[sw] Caching app shell');
      return cache.addAll(APP_SHELL_ASSETS);
    })
  );
  // Activate immediately without waiting for old clients to close
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate – clean up old caches
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch – network-first for API and HTML navigations, cache-only for icons
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first with IndexedDB fallback awareness
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithFallback(event.request));
    return;
  }

  // JS/CSS bundles from Vite – always network. Vite produces content-hashed
  // filenames so caching them in the SW is unnecessary and causes
  // stale-bundle problems across deployments.
  if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML navigations: NETWORK-FIRST. We must always serve the freshest
  // index.html so it references the current content-hashed bundle. The
  // cached '/' is only used when the network fails (true offline).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache a copy so we have *something* to serve when offline.
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) =>
          cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
        ))
    );
    return;
  }

  // Everything else (icons, manifest, fonts): cache-first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() =>
        new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
      );
    })
  );
});

// ---------------------------------------------------------------------------
// Network-first strategy for API calls
// ---------------------------------------------------------------------------
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    // Cache successful GET responses so we have offline data
    if (request.method === 'GET' && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    // Network failed – try cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // No cached version – return an offline-aware JSON error
    return new Response(
      JSON.stringify({ error: 'offline', message: 'You are offline. Data is saved locally.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Background Sync – process queued dock walk data when back online
// ---------------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-dock-walks') {
    event.waitUntil(syncDockWalkData());
  }
});

async function syncDockWalkData() {
  const db = await openOfflineDB();
  const tx = db.transaction('sync-queue', 'readonly');
  const store = tx.objectStore('sync-queue');
  const items = await idbGetAll(store);

  if (items.length === 0) {
    db.close();
    return;
  }

  const synced = [];

  for (const item of items) {
    try {
      const endpoint = getEndpointForType(item.type);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(item.data._token ? { Authorization: `Bearer ${item.data._token}` } : {}),
        },
        body: JSON.stringify(item.data),
      });

      if (response.ok) {
        synced.push(item.id);
      }
    } catch (_err) {
      // Still offline or endpoint unreachable – will retry on next sync
    }
  }

  // Remove synced items
  if (synced.length > 0) {
    const deleteTx = db.transaction('sync-queue', 'readwrite');
    const deleteStore = deleteTx.objectStore('sync-queue');
    for (const id of synced) {
      deleteStore.delete(id);
    }
  }

  db.close();

  // Notify all clients about sync completion
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({
      type: 'SYNC_COMPLETE',
      synced: synced.length,
      remaining: items.length - synced.length,
    });
  }
}

function getEndpointForType(type) {
  const endpoints = {
    'dock-walk': '/api/dock-walks',
    'dock-walk-item': '/api/dock-walks/items',
    violation: '/api/violations',
    photo: '/api/dock-walks/photos',
  };
  return endpoints[type] || '/api/dock-walks';
}

// ---------------------------------------------------------------------------
// Periodic Sync – attempt sync on a schedule when supported
// ---------------------------------------------------------------------------
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sync-dock-walks-periodic') {
    event.waitUntil(syncDockWalkData());
  }
});

// ---------------------------------------------------------------------------
// Message handler – manual sync trigger from the app
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TRIGGER_SYNC') {
    syncDockWalkData();
  }
});

// ---------------------------------------------------------------------------
// IndexedDB helpers (minimal, used only inside the service worker)
// ---------------------------------------------------------------------------
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('dock-walks')) {
        db.createObjectStore('dock-walks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dock-walk-items')) {
        db.createObjectStore('dock-walk-items', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('violations')) {
        db.createObjectStore('violations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sync-queue')) {
        db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
