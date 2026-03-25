/**
 * Service worker registration for the Helm PWA.
 */

export async function registerServiceWorker(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('[helm] Service worker registered', reg.scope);

      // Check for updates periodically
      setInterval(() => {
        reg.update();
      }, 60 * 60 * 1000); // every hour
    } catch (err) {
      console.error('[helm] Service worker registration failed:', err);
    }
  }
}
