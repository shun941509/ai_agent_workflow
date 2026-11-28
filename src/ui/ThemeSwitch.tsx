'use client';

import { Moon, Sun } from 'lucide-react';
import { useThemePreference } from './theme-preference';
import './ThemeSwitch.css';

export function ThemeSwitch() {
  const [theme, setTheme] = useThemePreference();
  const dark = theme === 'dark';

  return (
    <button className="theme-switch" type="button" role="switch"
      aria-label="다크 모드" aria-checked={dark} title={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}>
      <Sun className="theme-switch-sun" size={18} aria-hidden="true" />
      <Moon className="theme-switch-moon" size={18} aria-hidden="true" />
    </button>
  );
}
