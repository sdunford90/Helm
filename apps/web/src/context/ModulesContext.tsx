import { createContext, useContext, useState, ReactNode } from 'react';

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
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
