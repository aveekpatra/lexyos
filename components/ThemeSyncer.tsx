"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Syncs theme preference between the lightweight ThemeProvider (localStorage)
 * and Convex (database). Must be rendered inside ConvexProvider.
 *
 * - On mount: once Convex prefs load, applies DB value as source of truth.
 * - On toggle: writes to Convex so it persists across devices.
 */
export function ThemeSyncer() {
  const { theme, setTheme } = useTheme();
  const prefs = useQuery(api.userPreferences.get);
  const setPrefs = useMutation(api.userPreferences.set);
  const hydratedFromDb = useRef(false);
  const prevTheme = useRef(theme);

  // Hydrate from Convex once (overrides localStorage if different)
  useEffect(() => {
    if (hydratedFromDb.current || prefs === undefined) return;
    if (prefs?.theme === "light" || prefs?.theme === "dark") {
      setTheme(prefs.theme);
    }
    hydratedFromDb.current = true;
  }, [prefs, setTheme]);

  // When user toggles theme, persist to Convex
  useEffect(() => {
    if (!hydratedFromDb.current) return;
    if (theme === prevTheme.current) return;
    prevTheme.current = theme;
    setPrefs({ theme }).catch(() => {});
  }, [theme, setPrefs]);

  return null;
}
