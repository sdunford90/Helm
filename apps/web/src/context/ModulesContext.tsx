import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';

export interface ApiLocation {
  id: string;
  name: string;
  transientEnabled: boolean;
  rentalsEnabled: boolean;
  rampEnabled: boolean;
  conciergeEnabled: boolean;
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
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(() => {
    const stored = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (stored === ALL_LOCATIONS_SENTINEL) return null;
    return stored;
  });
  const [modules, setModules] = useState<ModulesConfig>(FALLBACK);

  useEffect(() => {
    setLocationsLoading(true);
    fetch('/api/locations', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data: ApiLocation[] } | null) => {
        if (!json?.data?.length) return;
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
      })
      .catch(() => {})
      .finally(() => setLocationsLoading(false));
  }, []);

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

      try {
        await fetch(`/api/locations/${currentLocationId}/features`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [apiKey]: enabled }),
        });
      } catch {
        setModules((prev) => ({ ...prev, [key]: !enabled }));
        setLocations((prev) =>
          prev.map((l) =>
            l.id === currentLocationId ? { ...l, [apiKey]: !enabled } : l,
          ),
        );
      }
    },
    [currentLocationId],
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
