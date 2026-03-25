import { useState, useEffect } from 'react';
import { getSyncQueue } from '../lib/offline-store.js';

interface SyncStatus {
  synced: number;
  remaining?: number;
  failed?: number;
}

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Track online/offline state
  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      setSyncing(true);
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Poll pending count while offline
  useEffect(() => {
    let cancelled = false;

    async function updateCount() {
      try {
        const queue = await getSyncQueue();
        if (!cancelled) setPendingCount(queue.length);
      } catch {
        // IndexedDB might not be available
      }
    }

    updateCount();
    const interval = setInterval(updateCount, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [offline]);

  // Listen for sync-status events from the sync manager
  useEffect(() => {
    function handleSyncStatus(event: Event) {
      const detail = (event as CustomEvent<SyncStatus>).detail;
      setSyncStatus(detail);
      setSyncing(false);

      // Clear the status after a few seconds
      setTimeout(() => setSyncStatus(null), 4000);
    }

    window.addEventListener('helm:sync-status', handleSyncStatus);
    return () => window.removeEventListener('helm:sync-status', handleSyncStatus);
  }, []);

  // Nothing to show when online and not syncing
  if (!offline && !syncing && !syncStatus) return null;

  const bannerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    padding: '10px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    fontWeight: 600,
    textAlign: 'center',
    color: '#fff',
    backgroundColor: offline ? '#D32F2F' : syncing ? '#F57C00' : '#388E3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  };

  const pillStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: '12px',
    padding: '2px 10px',
    fontSize: '12px',
  };

  return (
    <div style={bannerStyle} role="status" aria-live="polite">
      {offline && (
        <>
          <span>You're offline — dock walk data is saved locally</span>
          {pendingCount > 0 && (
            <span style={pillStyle}>{pendingCount} pending</span>
          )}
        </>
      )}

      {syncing && !offline && (
        <span>Reconnected — syncing dock walk data...</span>
      )}

      {syncStatus && !offline && !syncing && (
        <span>
          Sync complete: {syncStatus.synced} items synced
          {syncStatus.failed ? `, ${syncStatus.failed} failed` : ''}
        </span>
      )}
    </div>
  );
}
