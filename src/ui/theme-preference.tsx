'use client';

import { useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark';
const storageKey = 'workflow-studio:theme';

function saveTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // The current page still uses the selected theme if storage is unavailable.
  }
}

function observeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

export function useThemePreference() {
  const theme = useSyncExternalStore<ThemePreference>(
    observeTheme,
    () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    () => 'light',
  );
  return [theme, saveTheme] as const;
}

// Choose before the first paint. Older versions stored no key when following Windows.
const initialTheme = `{
  const key = ${JSON.stringify(storageKey)};
  let theme;
  try { theme = localStorage.getItem(key); } catch {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    try { localStorage.setItem(key, theme); } catch {}
  }
  document.documentElement.dataset.theme = theme;
}`;

export function ThemeBootstrap() {
  useEffect(() => {
    function restore() {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
      } catch { /* Keep the current page's theme when storage is disabled. */ }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) restore();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) restore();
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    restore();
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return <script dangerouslySetInnerHTML={{ __html: initialTheme }} />;
}
