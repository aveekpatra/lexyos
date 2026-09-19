"use client";

import { createContext, useContext, useEffect, useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}>({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

const STORAGE_KEY = "unifocus-theme";

const listeners = new Set<() => void>();
function readTheme(): Theme {
  try { const t = localStorage.getItem(STORAGE_KEY); return t === "dark" ? "dark" : "light"; } catch { return "light"; }
}
const themeStore = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  get: readTheme,
  getServer: (): Theme => "light",
  set(t: Theme) { try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ } listeners.forEach((l) => l()); },
};

/**
 * Lightweight provider: lives above ConvexProvider in the tree and reads and
 * writes localStorage only; Convex sync is handled by <ThemeSyncer />. The
 * value goes through useSyncExternalStore so the server frame ("light") and
 * the first client frame agree, and the inline script in app/layout.tsx has
 * already set the class before paint, so there is no flash either way.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.getServer);

  // Apply class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);

  const setTheme = useCallback((t: Theme) => themeStore.set(t), []);
  const toggleTheme = useCallback(() => themeStore.set(theme === "light" ? "dark" : "light"), [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
