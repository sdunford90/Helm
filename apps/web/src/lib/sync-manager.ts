/**
 * Sync manager – processes the offline queue when connectivity is restored.
 */

import { getSyncQueue, clearSynced, isOnline } from './offline-store.js';
import { api } from './api.js';

// ---------------------------------------------------------------------------
// Endpoint mapping
// ---------------------------------------------------------------------------
const ENDPOINT_MAP: Record<string, string> = {
  'dock-walk': '/dock-walks',
  'dock-walk-item': '/dock-walks/items',
  violation: '/violations',
  photo: '/dock-walks/photos',
};

// ---------------------------------------------------------------------------
// Sync pending data
// ---------------------------------------------------------------------------
export async function syncPendingData(
  token: string,
): Promise<{ synced: number; failed: number }> {
  const queue = await getSyncQueue();

  if (queue.length === 0) {
    return { synced: 0, failed: 0 };
  }

  const syncedIds: string[] = [];
  let failed = 0;

  for (const item of queue) {
    const endpoint = ENDPOINT_MAP[item.type];
    if (!endpoint) {
      console.warn(`[sync] Unknown sync type: ${item.type}`);
      failed++;
      continue;
    }

    try {
      await api.post(endpoint, item.data, token);
      syncedIds.push(item.id);
    } catch (err) {
      console.error(`[sync] Failed to sync ${item.type} (id=${item.id}):`, err);
      failed++;
    }
  }

  if (syncedIds.length > 0) {
    await clearSynced(syncedIds);
  }

  console.log(`[sync] Completed: ${syncedIds.length} synced, ${failed} failed`);
  return { synced: syncedIds.length, failed };
}

// ---------------------------------------------------------------------------
// Register sync handler – listens for connectivity changes
// ---------------------------------------------------------------------------
let syncInProgress = false;
let registeredToken: string | null = null;

export function registerSyncHandler(token?: string): void {
  if (token) {
    registeredToken = token;
  }

  // Sync when the browser comes back online
  window.addEventListener('online', handleOnline);

  // Listen for sync-complete messages from the service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SYNC_COMPLETE') {
        console.log(
          `[sync] SW background sync complete: ${event.data.synced} synced, ${event.data.remaining} remaining`,
        );
        window.dispatchEvent(
          new CustomEvent('helm:sync-status', { detail: event.data }),
        );
      }
    });
  }

  // Register periodic background sync if supported
  registerPeriodicSync();
}

async function handleOnline(): Promise<void> {
  if (syncInProgress) return;
  if (!registeredToken) {
    console.warn('[sync] No auth token registered – skipping sync');
    return;
  }

  // Small delay to let the connection stabilise
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const online = await isOnline();
  if (!online) return;

  syncInProgress = true;
  try {
    const result = await syncPendingData(registeredToken);
    window.dispatchEvent(
      new CustomEvent('helm:sync-status', {
        detail: { type: 'SYNC_COMPLETE', ...result },
      }),
    );
  } finally {
    syncInProgress = false;
  }
}

async function registerPeriodicSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await (reg as any).periodicSync.register('sync-dock-walks-periodic', {
        minInterval: 5 * 60 * 1000, // 5 minutes
      });
      console.log('[sync] Periodic background sync registered');
    }
  } catch (_err) {
    // Periodic sync not granted or not supported
  }
}
