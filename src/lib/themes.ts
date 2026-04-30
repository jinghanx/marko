/**
 * Color themes inspired by Ghostty's curated theme catalog.
 * Each theme defines the app palette (sidebar, tabs, editor) and a 16-color
 * ANSI palette for the embedded terminal. Pick a light theme + a dark theme;
 * Marko picks between them based on the App Theme setting (system/light/dark).
 */

export interface Theme {
  id: string;
  name: string;
  kind: 'light' | 'dark';
  // App
  bg: string;
  bgMuted: string;
  bgElev: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  // Terminal — 16 ANSI colors: black, red, green, yellow, blue, magenta, cyan, white,
  //                            then bright variants in the same order.
  ansi: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
  // Optional terminal-specific overrides.
  termBg?: string;
  termFg?: string;
  termCursor?: string;
}

export const LIGHT_THEMES: Theme[] = [
  {
    id: 'default-light',
    name: 'Default Light',
    kind: 'light',
    bg: '#ffffff',
    bgMuted: '#f7f7f6',
    bgElev: '#fbfbfa',
    text: '#1f1f1e',
    textMuted: '#6b6b67',
    border: '#e8e8e6',
    borderStrong: '#d8d8d4',
    accent: '#2d6cdf',
    ansi: [
      '#1f1f1e', '#c0392b', '#3a8a3a', '#b58900', '#2d6cdf', '#9c4dcc', '#2aa1b3', '#d8d8d4',
      '#6b6b67', '#e74c3c', '#4caf50', '#d4a300', '#3b82f6', '#a855f7', '#06b6d4', '#fbfbfa',
    ],
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    kind: 'light',
    bg: '#ffffff',
    bgMuted: '#f6f8fa',
    bgElev: '#ffffff',
    text: '#1f2328',
    textMuted: '#656d76',
    border: '#d0d7de',
    borderStrong: '#afb8c1',
    accent: '#0969da',
    ansi: [
      '#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f',
    ],
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    kind: 'light',
    bg: '#fdf6e3',
    bgMuted: '#eee8d5',
    bgElev: '#f5efdc',
    text: '#586e75',
    textMuted: '#93a1a1',
    border: '#e4dcc4',
    borderStrong: '#c5bfa3',
    accent: '#268bd2',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#586e75', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
    ],
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    kind: 'light',
    bg: '#eff1f5',
    bgMuted: '#e6e9ef',
    bgElev: '#dce0e8',
    text: '#4c4f69',
    textMuted: '#6c6f85',
    border: '#bcc0cc',
    borderStrong: '#9ca0b0',
    accent: '#1e66f5',
    ansi: [
      '#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
      '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc',
    ],
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    kind: 'light',
    bg: '#faf4ed',
    bgMuted: '#f2e9e1',
    bgElev: '#fffaf3',
    text: '#575279',
    textMuted: '#797593',
    border: '#dfdad9',
    borderStrong: '#cecacd',
    accent: '#286983',
    ansi: [
      '#575279', '#b4637a', '#56949f', '#ea9d34', '#286983', '#907aa9', '#d7827e', '#f2e9e1',
      '#9893a5', '#b4637a', '#56949f', '#ea9d34', '#286983', '#907aa9', '#d7827e', '#cecacd',
    ],
  },
];

export const DARK_THEMES: Theme[] = [
  {
    id: 'default-dark',
    name: 'Default Dark',
    kind: 'dark',
    bg: '#1e1f1d',
    bgMuted: '#232422',
    bgElev: '#2a2b29',
    text: '#ececea',
    textMuted: '#9a9a93',
    border: '#34352f',
    borderStrong: '#44453f',
    accent: '#79a6ff',
    ansi: [
      '#1e1f1d', '#e74c3c', '#4caf50', '#d4a300', '#79a6ff', '#c678dd', '#56d4ff', '#9a9a93',
      '#34352f', '#ff6363', '#3ed27a', '#f1c40f', '#79a6ff', '#c678dd', '#56d4ff', '#ececea',
    ],
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    kind: 'dark',
    bg: '#0d1117',
    bgMuted: '#161b22',
    bgElev: '#21262d',
    text: '#e6edf3',
    textMuted: '#7d8590',
    border: '#30363d',
    borderStrong: '#484f58',
    accent: '#2f81f7',
    ansi: [
      '#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
      '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff',
    ],
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    kind: 'dark',
    bg: '#002b36',
    bgMuted: '#073642',
    bgElev: '#0a4252',
    text: '#839496',
    textMuted: '#586e75',
    border: '#0a4f63',
    borderStrong: '#1d6f8a',
    accent: '#268bd2',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
    ],
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    kind: 'dark',
    bg: '#1a1b26',
    bgMuted: '#16161e',
    bgElev: '#24283b',
    text: '#c0caf5',
    textMuted: '#737aa2',
    border: '#2a2e44',
    borderStrong: '#414868',
    accent: '#7aa2f7',
    ansi: [
      '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
    ],
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    kind: 'dark',
    bg: '#1e1e2e',
    bgMuted: '#181825',
    bgElev: '#313244',
    text: '#cdd6f4',
    textMuted: '#a6adc8',
    border: '#313244',
    borderStrong: '#45475a',
    accent: '#89b4fa',
    ansi: [
      '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8',
    ],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    kind: 'dark',
    bg: '#282a36',
    bgMuted: '#21222c',
    bgElev: '#343746',
    text: '#f8f8f2',
    textMuted: '#a8a8b3',
    border: '#3a3c4e',
    borderStrong: '#44475a',
    accent: '#bd93f9',
    ansi: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
    ],
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    kind: 'dark',
    bg: '#282828',
    bgMuted: '#1d2021',
    bgElev: '#3c3836',
    text: '#ebdbb2',
    textMuted: '#a89984',
    border: '#3c3836',
    borderStrong: '#504945',
    accent: '#83a598',
    ansi: [
      '#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2',
    ],
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    kind: 'dark',
    bg: '#282c34',
    bgMuted: '#21252b',
    bgElev: '#2c313a',
    text: '#abb2bf',
    textMuted: '#5c6370',
    border: '#3b4048',
    borderStrong: '#4b5263',
    accent: '#61afef',
    ansi: [
      '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#be5046', '#7c9c5c', '#d19a66', '#3b8eea', '#a472b6', '#3aa9b8', '#ffffff',
    ],
  },
  {
    id: 'nord',
    name: 'Nord',
    kind: 'dark',
    bg: '#2e3440',
    bgMuted: '#272c36',
    bgElev: '#3b4252',
    text: '#eceff4',
    textMuted: '#a3acbf',
    border: '#3b4252',
    borderStrong: '#4c566a',
    accent: '#88c0d0',
    ansi: [
      '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
    ],
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    kind: 'dark',
    bg: '#191724',
    bgMuted: '#1f1d2e',
    bgElev: '#26233a',
    text: '#e0def4',
    textMuted: '#908caa',
    border: '#26233a',
    borderStrong: '#403d52',
    accent: '#9ccfd8',
    ansi: [
      '#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
      '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
    ],
  },
];

export const ALL_THEMES: Theme[] = [...LIGHT_THEMES, ...DARK_THEMES];

export function getTheme(id: string): Theme | null {
  return ALL_THEMES.find((t) => t.id === id) ?? null;
}

export const DEFAULT_LIGHT_ID = 'default-light';
export const DEFAULT_DARK_ID = 'default-dark';

export function applyThemeToDom(theme: Theme) {
  const r = document.documentElement;
  r.style.setProperty('--bg', theme.bg);
  r.style.setProperty('--bg-muted', theme.bgMuted);
  r.style.setProperty('--bg-elev', theme.bgElev);
  r.style.setProperty('--text', theme.text);
  r.style.setProperty('--text-muted', theme.textMuted);
  r.style.setProperty('--border', theme.border);
  r.style.setProperty('--border-strong', theme.borderStrong);
  r.style.setProperty('--accent', theme.accent);
  r.style.setProperty('color-scheme', theme.kind);

  // Syntax highlighting tokens — derived from the ANSI palette so each theme's
  // code colors stay coherent with its terminal palette.
  const dark = theme.kind === 'dark';
  // Use bright variants on dark themes (more legible), normal on light.
  const ix = (i: number) => theme.ansi[dark ? i + 8 : i];
  r.style.setProperty('--tok-keyword', ix(5));
  r.style.setProperty('--tok-string', ix(2));
  r.style.setProperty('--tok-number', ix(3));
  r.style.setProperty('--tok-class', ix(4));
  r.style.setProperty('--tok-property', ix(3));
  r.style.setProperty('--tok-function', ix(4));
  r.style.setProperty('--tok-comment', theme.textMuted);
  r.style.setProperty('--tok-operator', theme.textMuted);
  r.style.setProperty('--tok-tag', ix(1));
  r.style.setProperty('--tok-attr', ix(3));
  r.style.setProperty('--tok-variable', theme.text);
  r.style.setProperty('--tok-punctuation', theme.textMuted);
  // Inline-code chip colors derived too.
  r.style.setProperty('--code-fg', ix(1));
  r.style.setProperty('--code-bg', theme.bgMuted);
  r.style.setProperty('--code-border', theme.border);
}

/** Build a theme object suitable for xterm.js. */
export function xtermThemeFor(theme: Theme) {
  return {
    background: theme.termBg ?? theme.bg,
    foreground: theme.termFg ?? theme.text,
    cursor: theme.termCursor ?? theme.accent,
    cursorAccent: theme.bg,
    selectionBackground: theme.accent + '55',
    black: theme.ansi[0],
    red: theme.ansi[1],
    green: theme.ansi[2],
    yellow: theme.ansi[3],
    blue: theme.ansi[4],
    magenta: theme.ansi[5],
    cyan: theme.ansi[6],
    white: theme.ansi[7],
    brightBlack: theme.ansi[8],
    brightRed: theme.ansi[9],
    brightGreen: theme.ansi[10],
    brightYellow: theme.ansi[11],
    brightBlue: theme.ansi[12],
    brightMagenta: theme.ansi[13],
    brightCyan: theme.ansi[14],
    brightWhite: theme.ansi[15],
  };
}
