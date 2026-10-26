import { createContext, useContext, useState, ReactNode } from 'react';

// TODO(phase-1): module toggles are per-browser (localStorage), so one user
// turning a module off does not affect colleagues. There is no tenant-level
// modules endpoint yet (apps/api/src/routes/settings.ts has marina, branding,
// billing, stripe, qbo, team and notifications only). When one exists (e.g.
// GET/PUT /settings/modules), load the initial state from it here and keep
// localStorage only as a cache. The API already enforces some modules on its
// side (e.g. /api/rentals returns 503 MODULE_DISABLED in Phase 0), and pages
// must handle that response regardless of this toggle.
const STORAGE_KEY = 'helm_modules';

export interface ModulesConfig {
  rentals: boolean;
}

const DEFAULTS: ModulesConfig = {
  rentals: true,
};

function load(): ModulesConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

function save(config: ModulesConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable (private mode); keep in-memory state */
  }
}

interface ModulesContextValue {
  modules: ModulesConfig;
  setModule: (key: keyof ModulesConfig, enabled: boolean) => void;
}

const ModulesContext = createContext<ModulesContextValue>({
  modules: DEFAULTS,
  setModule: () => {},
});

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ModulesConfig>(load);

  function setModule(key: keyof ModulesConfig, enabled: boolean) {
    setModules((prev) => {
      const next = { ...prev, [key]: enabled };
      save(next);
      return next;
    });
  }

  return (
    <ModulesContext.Provider value={{ modules, setModule }}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  return useContext(ModulesContext);
}
