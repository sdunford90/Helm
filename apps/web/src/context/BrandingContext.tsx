import { createContext, useContext, useEffect, useCallback, useState, ReactNode } from 'react';

const DEFAULT_PRIMARY = '#0A2342';
const DEFAULT_SECONDARY = '#00D4FF';

interface BrandingContextValue {
  primaryColor: string;
  secondaryColor: string;
  applyBranding: (primary: string, secondary: string) => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  primaryColor: DEFAULT_PRIMARY,
  secondaryColor: DEFAULT_SECONDARY,
  applyBranding: () => {},
});

function setCssVars(primary: string, secondary: string) {
  document.documentElement.style.setProperty('--brand-primary', primary);
  document.documentElement.style.setProperty('--brand-secondary', secondary);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY);

  useEffect(() => {
    setCssVars(DEFAULT_PRIMARY, DEFAULT_SECONDARY);

    fetch('/api/settings/branding', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const primary = data.primaryColor || DEFAULT_PRIMARY;
        const secondary = data.secondaryColor || DEFAULT_SECONDARY;
        setPrimaryColor(primary);
        setSecondaryColor(secondary);
        setCssVars(primary, secondary);
      })
      .catch(() => {});
  }, []);

  const applyBranding = useCallback((primary: string, secondary: string) => {
    setPrimaryColor(primary);
    setSecondaryColor(secondary);
    setCssVars(primary, secondary);
  }, []);

  return (
    <BrandingContext.Provider value={{ primaryColor, secondaryColor, applyBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
