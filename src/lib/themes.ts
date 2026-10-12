export const THEMES = [
  { id: 'midnight', name: 'Midnight', swatch: ['#15131f', '#ffb86b'], dark: true },
  { id: 'cassette', name: 'Cassette', swatch: ['#1c1714', '#ff8a5b'], dark: true },
  { id: 'sakura', name: 'Sakura', swatch: ['#1d1420', '#ff8fb8'], dark: true },
  { id: 'matcha', name: 'Matcha', swatch: ['#121815', '#9ad77f'], dark: true },
  { id: 'paper', name: 'Paper', swatch: ['#f4efe6', '#d9622b'], dark: false },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'midnight';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** Runs before hydration to avoid a flash of the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('lofiloop:v2:prefs')||'{}');var t=p.theme;var ok=${JSON.stringify(
  THEMES.map((t) => t.id),
)};document.documentElement.dataset.theme=ok.indexOf(t)>-1?t:'${DEFAULT_THEME}';}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})();`;
