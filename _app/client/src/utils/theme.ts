/**
 * @module Theme
 * Management module for UI theme switching, persistence, and event notifications.
 * Theme preference is stored per-user in localStorage using the key
 * `stratanote_theme_<username>`. The login screen always uses the default
 * `dark-purple` theme regardless of any saved preference.
 */
import { useState, useEffect } from 'react';

/**
 * Supported theme identifiers.
 */
export type ThemeId = 'dark-purple' | 'light-purple' | 'light-clean' | 'nord-dark';

/**
 * Describes a single selectable theme option for the settings UI.
 */
export interface ThemeOption {
  id: ThemeId;
  nameKey: string;
  descKey: string;
  type: 'dark' | 'light';
  previewBg: string;
  previewPanel: string;
  previewPrimary: string;
  previewText: string;
}

/** All available themes. */
export const THEMES: ThemeOption[] = [
  {
    id: 'light-purple',
    nameKey: 'theme_light_purple_name',
    descKey: 'theme_light_purple_desc',
    type: 'light',
    previewBg: '#ede6f7',
    previewPanel: '#ffffff',
    previewPrimary: '#7c3aed',
    previewText: '#1e1b26'
  },
  {
    id: 'light-clean',
    nameKey: 'theme_light_clean_name',
    descKey: 'theme_light_clean_desc',
    type: 'light',
    previewBg: '#e2e8f0',
    previewPanel: '#ffffff',
    previewPrimary: '#2563eb',
    previewText: '#0f172a'
  },
  {
    id: 'dark-purple',
    nameKey: 'theme_dark_purple_name',
    descKey: 'theme_dark_purple_desc',
    type: 'dark',
    previewBg: '#121212',
    previewPanel: '#181818',
    previewPrimary: '#9d4edd',
    previewText: '#e0e0e0'
  },
  {
    id: 'nord-dark',
    nameKey: 'theme_nord_dark_name',
    descKey: 'theme_nord_dark_desc',
    type: 'dark',
    previewBg: '#2e3440',
    previewPanel: '#3b4252',
    previewPrimary: '#88c0d0',
    previewText: '#eceff4'
  }
];

const DEFAULT_THEME: ThemeId = 'dark-purple';
const VALID_THEMES: string[] = ['dark-purple', 'light-purple', 'light-clean', 'nord-dark'];

/** Currently active username for per-user key derivation. */
let _activeUsername: string | null = null;

/**
 * Builds the per-user localStorage key for theme preference.
 * @param username - The authenticated user's name.
 * @returns localStorage key string.
 */
const buildStorageKey = (username: string): string => `stratanote_theme_${username}`;

/**
 * Gets the current active theme identifier for the given user from localStorage.
 * Falls back to `dark-purple` if nothing is saved or the value is invalid.
 * @param username - Optional username. If omitted uses the module-level active user.
 * @returns The resolved ThemeId.
 */
export const getActiveTheme = (username?: string): ThemeId => {
  const user = username || _activeUsername;
  if (!user) return DEFAULT_THEME;
  const saved = localStorage.getItem(buildStorageKey(user));
  if (saved && VALID_THEMES.includes(saved)) {
    return saved as ThemeId;
  }
  return DEFAULT_THEME;
};

/**
 * Applies theme to DOM root. Optionally persists to localStorage for the given user.
 * @param theme - Theme identifier to apply.
 * @param username - If provided, persists the choice for this user.
 */
export const applyTheme = (theme: ThemeId, username?: string): void => {
  document.documentElement.setAttribute('data-theme', theme);
  const user = username || _activeUsername;
  if (user) {
    localStorage.setItem(buildStorageKey(user), theme);
  }
  window.dispatchEvent(new CustomEvent('stratanote-theme-changed', { detail: { theme } }));
};

/**
 * Forces the default dark-purple theme on the DOM without touching any
 * user's stored preference. Call this before rendering the Auth screen.
 */
export const forceDefaultTheme = (): void => {
  document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  _activeUsername = null;
};

/**
 * Initializes the theme for an authenticated user: reads the user's
 * saved preference, applies it, and stores the username for future saves.
 * @param username - The logged-in user's name.
 */
export const initUserTheme = (username: string): void => {
  _activeUsername = username;
  const theme = getActiveTheme(username);
  applyTheme(theme, username);
};

/**
 * React hook to access and change theme state reactively.
 * @returns Tuple of [currentThemeId, setThemeFunction].
 */
export const useTheme = (): [ThemeId, (theme: ThemeId) => void] => {
  const [theme, setPrimaryTheme] = useState<ThemeId>(() => {
    // Read from DOM attribute in case forceDefaultTheme was called
    const domTheme = document.documentElement.getAttribute('data-theme');
    if (domTheme && VALID_THEMES.includes(domTheme)) return domTheme as ThemeId;
    return getActiveTheme();
  });

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: ThemeId }>;
      if (customEvent.detail && customEvent.detail.theme) {
        setPrimaryTheme(customEvent.detail.theme);
      }
    };

    window.addEventListener('stratanote-theme-changed', handleThemeChange);
    return () => {
      window.removeEventListener('stratanote-theme-changed', handleThemeChange);
    };
  }, []);

  const changeTheme = (newTheme: ThemeId) => {
    setPrimaryTheme(newTheme);
    applyTheme(newTheme);
  };

  return [theme, changeTheme];
};
