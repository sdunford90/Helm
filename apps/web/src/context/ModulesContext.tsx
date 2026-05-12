import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { reportApiError } from '../lib/apiError';
import { setActiveLocationGetter } from '../lib/api';

export interface ApiLocation {
  id: string;
  name: string;
  transientEnabled: boolean;
  rentalsEnabled: boolean;
  rampEnabled: boolean;
  conciergeEnabled: boolean;
  // Per-location toggle for the POS counter's ACH button. Defaults to false
  // server-side; tolerated as optional here so older API responses (or any
  // hand-rolled test fixtures) don't crash on missing field.
  posAchEnabled?: boolean;
  // Per-location toggle for the POS counter's "Charge to A/R" button.
  // When true, cashiers can complete a sale by creating a real A/R invoice
  // for the attached customer. Optional for the same compatibility reason
  // as posAchEnabled above.
  posChargeToARAllowed?: boolean;
}

export interface ModulesConfig {
  transient: boolean;
  rentals: boolean;
  ramp: boolean;
  concierge: boolean;
}

const FALLBACK: ModulesConfig = { transient: true, rentals: true, ramp: true, concierge: true };

const MODULE_TO_API: Record<keyof ModulesConfig, keyof ApiLocation> = {
  transient: 'transientEnabled',
  rentals: 'rentalsEnabled',
  ramp: 'rampEnabled',
  concierge: 'conciergeEnabled',
};

interface ModulesContextValue {
  locations: ApiLocation[];
  locationsLoading: boolean;
  // null === "All locations" sentinel: the operator wants a tenant-wide view
  // rather than scoping to a single location.
  currentLocationId: string | null;
  setCurrentLocationId: (id: string | null) => void;
  modules: ModulesConfig;
  setModule: (key: keyof ModulesConfig, enabled: boolean) => void;
}

const ModulesContext = createContext<ModulesContextValue>({
  locations: [],
  locationsLoading: true,
  currentLocationId: null,
  setCurrentLocationId: () => {},
  modules: FALLBACK,
  setModule: () => {},
});

const LOCATION_STORAGE_KEY = 'helm_current_location';
// Sentinel persisted in localStorage when "All locations" is selected. Kept
// distinct from any real UUID so we can round-trip the All-locations choice
// across reloads without tripping the location-id validation below.
export const ALL_LOCATIONS_SENTINEL = '__ALL__';

function featuresToModules(loc: ApiLocation): ModulesConfig {
  return {
    transient: loc.transientEnabled,
    rentals: loc.rentalsEnabled,
    ramp: loc.rampEnabled,
    concierge: loc.conciergeEnabled,
  };
}

// Union of enabled modules across locations — used when the user picks
// "All locations" so the sidebar shows every nav item the operator could
// reach from at least one of their locations. Per-location enable/disable
// still applies on the relevant pages.
function unionModules(locations: ApiLocation[]): ModulesConfig {
  if (locations.length === 0) return FALLBACK;
  return {
    transient: locations.some((l) => l.transientEnabled),
    rentals: locations.some((l) => l.rentalsEnabled),
    ramp: locations.some((l) => l.rampEnabled),
    concierge: locations.some((l) => l.conciergeEnabled),
  };
}

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(() => {
    const stored = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (stored === ALL_LOCATIONS_SENTINEL) return null;
    return stored;
  });
  const [modules, setModules] = useState<ModulesConfig>(FALLBACK);

  // Task #339: register a global getter so the api client can stamp the
  // active location on every request without us threading it through every
  // call site. Use a ref so the getter is stable across re-renders but
  // always reads the latest currentLocationId.
  const currentLocationIdRef = useRef<string | null>(currentLocationId);
  useEffect(() => {
    currentLocationIdRef.current = currentLocationId;
  }, [currentLocationId]);
  useEffect(() => {
    setActiveLocationGetter(() =>
      currentLocationIdRef.current === null
        ? ALL_LOCATIONS_SENTINEL
        : currentLocationIdRef.current,
    );
    return () => setActiveLocationGetter(null);
  }, []);

  useEffect(() => {
    // Wait until Clerk has hydrated and the user is signed in. Otherwise
    // getToken() returns null and the API call falls back to a 302 → SPA
    // index.html redirect, which silently fails and leaves the dropdown empty.
    if (!isLoaded) return;
    // Mirror AppLayout's dev-bypass: when VITE_ENABLE_AUTH_DEV_BYPASS=true
    // the app shell renders without a Clerk session and the API server has
    // its own matching ENABLE_AUTH_DEV_BYPASS that returns the tenant's
    // locations without needing a verified token. Without this, the location
    // picker stays empty in the local preview because we'd skip the fetch.
    const devBypass = import.meta.env.VITE_ENABLE_AUTH_DEV_BYPASS === 'true';
    if (!isSignedIn && !devBypass) {
      // Public/unauthenticated pages have no locations to load — make that
      // state explicit so callers don't render perpetual loading skeletons.
      setLocationsLoading(false);
      return;
    }
    let cancelled = false;
    setLocationsLoading(true);
    (async () => {
      const endpoint = '/api/locations';
      try {
        const token = isSignedIn ? await getToken() : null;
        const res = await fetch(endpoint, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          // Surface non-2xx responses (e.g. the 401 that previously
          // caused the dropdown to silently render empty in prod).
          reportApiError({ endpoint, status: res.status, label: 'Locations' });
          return;
        }
        const json = (await res.json()) as { data: ApiLocation[] } | null;
        if (cancelled || !json?.data?.length) return;
        setLocations(json.data);

        const stored = localStorage.getItem(LOCATION_STORAGE_KEY);
        if (stored === ALL_LOCATIONS_SENTINEL) {
          // Honor the persisted All-locations choice — null means "show
          // everything" and modules are the union across locations.
          setCurrentLocationIdState(null);
          setModules(unionModules(json.data));
          return;
        }

        setCurrentLocationIdState((prev) => {
          const validId = json.data.find((l) => l.id === prev)?.id ?? json.data[0].id;
          localStorage.setItem(LOCATION_STORAGE_KEY, validId);
          const loc = json.data.find((l) => l.id === validId) ?? json.data[0];
          setModules(featuresToModules(loc));
          return validId;
        });
      } catch (err) {
        // Network / parse failures still need a visible signal — the
        // dropdown stays empty either way, but at least operators get
        // a toast + structured console.warn instead of a silent shell.
        reportApiError({ endpoint, error: err, label: 'Locations' });
      } finally {
        if (!cancelled) setLocationsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  const setCurrentLocationId = useCallback((id: string | null) => {
    if (id === null) {
      localStorage.setItem(LOCATION_STORAGE_KEY, ALL_LOCATIONS_SENTINEL);
      setCurrentLocationIdState(null);
      setModules(unionModules(locations));
      return;
    }
    localStorage.setItem(LOCATION_STORAGE_KEY, id);
    setCurrentLocationIdState(id);
    const loc = locations.find((l) => l.id === id);
    if (loc) setModules(featuresToModules(loc));
  }, [locations]);

  const setModule = useCallback(
    async (key: keyof ModulesConfig, enabled: boolean) => {
      // No-op in All-locations mode: there's no single location to write the
      // toggle against, and silently writing to a chosen "first" location
      // would surprise the operator.
      if (!currentLocationId) return;

      const apiKey = MODULE_TO_API[key];

      setModules((prev) => ({ ...prev, [key]: enabled }));
      setLocations((prev) =>
        prev.map((l) =>
          l.id === currentLocationId ? { ...l, [apiKey]: enabled } : l,
        ),
      );

      const endpoint = `/api/locations/${currentLocationId}/features`;
      try {
        const token = await getToken();
        const res = await fetch(endpoint, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ [apiKey]: enabled }),
        });
        if (!res.ok) {
          reportApiError({ endpoint, status: res.status, label: 'Module toggle' });
          throw new Error(`PATCH failed with ${res.status}`);
        }
      } catch (err) {
        // Roll back the optimistic update so the UI matches server state.
        // The status-aware branch above already toasted; only report here
        // if this was a non-HTTP failure (network/parse).
        if (!(err instanceof Error) || !err.message.startsWith('PATCH failed')) {
          reportApiError({ endpoint, error: err, label: 'Module toggle' });
        }
        setModules((prev) => ({ ...prev, [key]: !enabled }));
        setLocations((prev) =>
          prev.map((l) =>
            l.id === currentLocationId ? { ...l, [apiKey]: !enabled } : l,
          ),
        );
      }
    },
    [currentLocationId, getToken],
  );

  // When in All-locations mode, keep `modules` in sync as locations are
  // toggled elsewhere — otherwise a user toggling rentals on at one
  // location wouldn't see the nav item appear under "All locations".
  const effectiveModules = useMemo(() => {
    if (currentLocationId !== null) return modules;
    return unionModules(locations);
  }, [currentLocationId, modules, locations]);

  return (
    <ModulesContext.Provider
      value={{
        locations,
        locationsLoading,
        currentLocationId,
        setCurrentLocationId,
        modules: effectiveModules,
        setModule,
      }}
    >
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  return useContext(ModulesContext);
}
