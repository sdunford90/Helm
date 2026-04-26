import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface ApiLocation {
  id: string;
  name: string;
  transientEnabled: boolean;
  rentalsEnabled: boolean;
}

export interface ModulesConfig {
  transient: boolean;
  rentals: boolean;
}

const FALLBACK: ModulesConfig = { transient: true, rentals: true };

interface ModulesContextValue {
  locations: ApiLocation[];
  locationsLoading: boolean;
  currentLocationId: string | null;
  setCurrentLocationId: (id: string) => void;
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

function featuresToModules(loc: ApiLocation): ModulesConfig {
  return { transient: loc.transientEnabled, rentals: loc.rentalsEnabled };
}

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(
    () => localStorage.getItem(LOCATION_STORAGE_KEY),
  );
  const [modules, setModules] = useState<ModulesConfig>(FALLBACK);

  useEffect(() => {
    setLocationsLoading(true);
    fetch('/api/locations', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data: ApiLocation[] } | null) => {
        if (!json?.data?.length) return;
        setLocations(json.data);

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

  const setCurrentLocationId = useCallback((id: string) => {
    localStorage.setItem(LOCATION_STORAGE_KEY, id);
    setCurrentLocationIdState(id);
    const loc = locations.find((l) => l.id === id);
    if (loc) setModules(featuresToModules(loc));
  }, [locations]);

  const setModule = useCallback(
    async (key: keyof ModulesConfig, enabled: boolean) => {
      if (!currentLocationId) return;

      const apiKey: keyof ApiLocation =
        key === 'transient' ? 'transientEnabled' : 'rentalsEnabled';

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

  return (
    <ModulesContext.Provider
      value={{ locations, locationsLoading, currentLocationId, setCurrentLocationId, modules, setModule }}
    >
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  return useContext(ModulesContext);
}
