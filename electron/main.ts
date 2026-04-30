import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

const require = createRequire(import.meta.url);

// Pin the user-visible name early — affects app menu, dock label, and
// `app.name` everywhere. Without this we'd fall through to the bundled
// Electron's "Electron" name in dev.
app.setName('Marko');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const sendToRenderer = (channel: string, ...args: unknown[]) => {
    BrowserWindow.getFocusedWindow()?.webContents.send(channel, ...args);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Preferences…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendToRenderer('menu:preferences'),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer('menu:new'),
        },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToRenderer('menu:open-file'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendToRenderer('menu:open-folder'),
        },
        {
          label: 'Quick Open…',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendToRenderer('menu:quick-open'),
        },
        {
          label: 'Quick Open (Replace)…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendToRenderer('menu:quick-open-replace'),
        },
        {
          label: 'Go to Path…',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendToRenderer('menu:goto-path'),
        },
        {
          label: 'Go to Path (Replace)…',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => sendToRenderer('menu:goto-path-replace'),
        },
        {
          label: 'New Terminal',
          click: () => sendToRenderer('menu:new-terminal'),
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => sendToRenderer('menu:focus-address'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToRenderer('menu:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToRenderer('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendToRenderer('menu:close-tab'),
        },
        ...(isMac ? [] : ([{ role: 'quit' }] satisfies Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToRenderer('menu:toggle-sidebar'),
        },
        {
          label: 'Toggle Outline',
          accelerator: 'CmdOrCtrl+Shift+\\',
          click: () => sendToRenderer('menu:toggle-outline'),
        },
        { type: 'separator' },
        {
          label: 'Split Right',
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendToRenderer('menu:split-right'),
        },
        {
          label: 'Split Down',
          accelerator: 'CmdOrCtrl+=',
          click: () => sendToRenderer('menu:split-down'),
        },
        {
          label: 'Close Pane',
          accelerator: 'CmdOrCtrl+Alt+W',
          click: () => sendToRenderer('menu:close-pane'),
        },
        {
          label: 'Next Pane',
          accelerator: 'CmdOrCtrl+`',
          click: () => sendToRenderer('menu:focus-pane-next'),
        },
        {
          label: 'Previous Pane',
          accelerator: 'CmdOrCtrl+Shift+`',
          click: () => sendToRenderer('menu:focus-pane-prev'),
        },
        {
          label: 'Process Viewer',
          accelerator: 'CmdOrCtrl+Y',
          click: () => sendToRenderer('menu:process-viewer'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        // Move zoom-in off ⌘= so ⌘= can be Split Down. ⌘⇧= is the
        // explicit "+" key, which is what macOS already labels for zoom-in.
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+Shift+=' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => sendToRenderer('menu:prev-tab'),
        },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => sendToRenderer('menu:next-tab'),
        },
        { type: 'separator' },
        { role: 'minimize' },
        // Close Window uses Shift+Cmd+W so it doesn't steal Cmd+W from
        // File > Close Tab. Standard role still handles the action.
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Set the dock icon in dev (production builds get the icon from .icns).
  // Try a few candidate paths since __dirname differs between dev and prod.
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.cwd(), 'build', 'icon.png'),
    path.resolve(__dirname, '..', '..', 'build', 'icon.png'),
  ];
  let setIconResult: 'ok' | string = 'no candidate matched';
  for (const candidate of candidates) {
    try {
      const icon = nativeImage.createFromPath(candidate);
      if (icon.isEmpty()) {
        setIconResult = `empty image at ${candidate}`;
        continue;
      }
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(icon);
      }
      setIconResult = `ok (${candidate})`;
      break;
    } catch (err) {
      setIconResult = (err as Error).message;
    }
  }
  console.log('[marko] dock icon:', setIconResult);

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('file:read', async (_e, filePath: string) => {
  const text = await fs.readFile(filePath, 'utf-8');
  return text;
});

ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('dialog:open-file', async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] },
      {
        name: 'Code & Text',
        extensions: [
          'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'log', 'env',
          'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
          'py', 'rb', 'go', 'rs', 'c', 'cc', 'cpp', 'h', 'hpp', 'java', 'kt', 'scala',
          'php', 'lua', 'swift', 'dart', 'zig',
          'html', 'htm', 'css', 'scss', 'sass', 'less',
          'sh', 'bash', 'zsh', 'fish', 'ps1',
          'sql', 'graphql', 'gql', 'proto',
          'vue', 'svelte', 'astro',
          'gitignore', 'gitattributes', 'editorconfig', 'dockerfile',
        ],
      },
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'],
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];

  // Detect image / binary up front to avoid reading binary as utf-8 garbage.
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'];
  if (IMAGE_EXTS.includes(ext)) {
    return { filePath, content: '' };
  }
  const content = await fs.readFile(filePath, 'utf-8');
  return { filePath, content };
});

ipcMain.handle('dialog:open-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:save-as', async (_e, suggestedName?: string) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const defaultPath = suggestedName ?? 'untitled.md';
  // Derive the extension from the suggested name so the Format dropdown
  // defaults to the correct type instead of always saying "Markdown".
  const dot = defaultPath.lastIndexOf('.');
  const slash = Math.max(defaultPath.lastIndexOf('/'), defaultPath.lastIndexOf('\\'));
  const ext = dot > slash ? defaultPath.slice(dot + 1).toLowerCase() : '';
  const filters: Electron.FileFilter[] = [];
  if (ext) filters.push({ name: ext.toUpperCase(), extensions: [ext] });
  filters.push({ name: 'All Files', extensions: ['*'] });
  const result = await dialog.showSaveDialog(win, { defaultPath, filters });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

ipcMain.handle('dir:list', async (_e, dirPath: string): Promise<DirEntry[]> => {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  // Return all entries (including dotfiles); the renderer filters per-setting.
  const entries = await Promise.all(
    dirents.map(async (d): Promise<DirEntry> => {
      const full = path.join(dirPath, d.name);
      let size = 0;
      let mtimeMs = 0;
      let ctimeMs = 0;
      try {
        const st = await fs.stat(full);
        size = st.size;
        mtimeMs = st.mtimeMs;
        ctimeMs = st.ctimeMs;
      } catch {
        // ignore (broken symlinks, perm issues)
      }
      return { name: d.name, path: full, isDirectory: d.isDirectory(), size, mtimeMs, ctimeMs };
    }),
  );
  // Default response order: dirs first, then alphabetical. Renderer can re-sort.
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
});

ipcMain.handle('path:basename', async (_e, p: string) => path.basename(p));

ipcMain.handle('path:home', async () => os.homedir());

ipcMain.handle('file:create', async (_e, filePath: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    await fs.writeFile(filePath, '', { flag: 'wx' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('dir:create', async (_e, dirPath: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    await fs.mkdir(dirPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:rename', async (_e, oldPath: string, newPath: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    await fs.rename(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:copy', async (_e, src: string, dest: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:exists', async (_e, p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('fs:trash', async (_e, p: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    await shell.trashItem(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:reveal', async (_e, p: string) => {
  shell.showItemInFolder(p);
});

ipcMain.handle('fs:open-default', async (_e, p: string): Promise<{ ok: boolean; error?: string }> => {
  const err = await shell.openPath(p);
  return err ? { ok: false, error: err } : { ok: true };
});

// ---------- Terminal (PTY) ----------

const ptys = new Map<string, IPty>();

// node-pty's prebuilt spawn-helper sometimes loses its executable bit when
// extracted by npm. Without +x, posix_spawnp fails. Self-heal at startup.
async function ensurePtyHelperExecutable() {
  if (process.platform === 'win32') return;
  try {
    const ptyPkgDir = path.dirname(require.resolve('node-pty/package.json'));
    const candidates = [
      path.join(ptyPkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      path.join(ptyPkgDir, 'build', 'Release', 'spawn-helper'),
    ];
    for (const c of candidates) {
      try {
        await fs.chmod(c, 0o755);
      } catch {
        // file may not exist for this arch — that's fine
      }
    }
  } catch {
    // node-pty not resolvable somehow — let pty:spawn surface the error
  }
}
void ensurePtyHelperExecutable();

ipcMain.handle('pty:spawn', (e, id: string, opts: { cwd?: string; cols?: number; rows?: number }): { ok: boolean; error?: string } => {
  try {
    if (ptys.has(id)) return { ok: true };
    const shell = process.env.SHELL ?? '/bin/zsh';
    const child = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd ?? os.homedir(),
      env: { ...(process.env as Record<string, string>), TERM: 'xterm-256color', LANG: process.env.LANG ?? 'en_US.UTF-8' },
    });
    ptys.set(id, child);
    const win = BrowserWindow.fromWebContents(e.sender);
    child.onData((data) => {
      win?.webContents.send('pty:data', id, data);
    });
    child.onExit(({ exitCode }) => {
      win?.webContents.send('pty:exit', id, exitCode);
      ptys.delete(id);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('pty:write', (_e, id: string, data: string): boolean => {
  const p = ptys.get(id);
  if (!p) return false;
  p.write(data);
  return true;
});

ipcMain.handle('pty:resize', (_e, id: string, cols: number, rows: number): boolean => {
  const p = ptys.get(id);
  if (!p) return false;
  try {
    p.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('pty:kill', (_e, id: string): boolean => {
  const p = ptys.get(id);
  if (!p) return false;
  try {
    p.kill();
  } catch {
    // ignore
  }
  ptys.delete(id);
  return true;
});

ipcMain.handle('fs:stat', async (_e, p: string): Promise<{ exists: boolean; isFile: boolean; isDirectory: boolean; error?: string }> => {
  try {
    const st = await fs.stat(p);
    return { exists: true, isFile: st.isFile(), isDirectory: st.isDirectory() };
  } catch (err) {
    return { exists: false, isFile: false, isDirectory: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:quicklook', async (_e, p: string): Promise<{ ok: boolean; error?: string }> => {
  if (process.platform !== 'darwin') return { ok: false, error: 'Quick Look is macOS-only' };
  try {
    const child = spawn('qlmanage', ['-p', p], { stdio: 'ignore', detached: true });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

const WALK_IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg', '.next', '.nuxt', '.cache',
  'dist', 'build', 'out', 'target', '.venv', 'venv', '__pycache__',
  '.idea', '.vscode', '.DS_Store', '.turbo', '.parcel-cache',
]);
const WALK_FILE_LIMIT = 20000;

ipcMain.handle('dir:walk', async (_e, rootDir: string): Promise<string[]> => {
  const results: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0 && results.length < WALK_FILE_LIMIT) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (WALK_IGNORE.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
        if (results.length >= WALK_FILE_LIMIT) break;
      }
    }
  }
  return results;
});

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
};

interface ProcInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  state: string;
  time: string;
  command: string;
  args: string;
}

interface SystemStats {
  cpus: number[]; // 0..1 per core
  memUsed: number; // bytes
  memTotal: number;
  loadavg: [number, number, number];
  uptime: number; // seconds
}

function runPs(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ps', [
      '-A',
      '-o',
      'pid=,user=,pcpu=,pmem=,vsz=,rss=,state=,time=,args=',
    ]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `ps exited ${code}`));
    });
    child.on('error', reject);
  });
}

function basenameOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

ipcMain.handle('ps:list', async (): Promise<ProcInfo[]> => {
  const text = await runPs();
  const procs: ProcInfo[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const args = m[9];
    const firstSpace = args.indexOf(' ');
    const argv0 = firstSpace < 0 ? args : args.slice(0, firstSpace);
    procs.push({
      pid: parseInt(m[1], 10),
      user: m[2],
      cpu: parseFloat(m[3]) || 0,
      mem: parseFloat(m[4]) || 0,
      vsz: parseInt(m[5], 10) || 0,
      rss: parseInt(m[6], 10) || 0,
      state: m[7],
      time: m[8],
      command: basenameOf(argv0),
      args,
    });
  }
  return procs;
});

let lastCpu: { idle: number; total: number }[] = [];

function cpuTimes(): { idle: number; total: number }[] {
  return os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

ipcMain.handle('system:stats', async (): Promise<SystemStats> => {
  const now = cpuTimes();
  const cpus = now.map((curr, i) => {
    const prev = lastCpu[i];
    if (!prev) return 0;
    const dIdle = curr.idle - prev.idle;
    const dTotal = curr.total - prev.total;
    if (dTotal <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - dIdle / dTotal));
  });
  lastCpu = now;
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  return {
    cpus,
    memUsed: memTotal - memFree,
    memTotal,
    loadavg: os.loadavg() as [number, number, number],
    uptime: os.uptime(),
  };
});

ipcMain.handle('ps:kill', async (_e, pid: number, signal: string = 'SIGTERM'): Promise<{ ok: boolean; error?: string }> => {
  try {
    process.kill(pid, signal as NodeJS.Signals);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('image:load', async (_e, filePath: string) => {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
  const buf = await fs.readFile(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
});
