import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

export type FileKind = 'markdown' | 'code' | 'image' | 'media' | 'pdf' | 'csv' | 'json' | 'excalidraw' | 'binary';

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx']);

const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff',
]);

const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv']);

const BINARY_EXT = new Set([
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'jar', 'wasm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'sqlite', 'db',
]);

function getExt(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot < 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function detectKind(path: string): FileKind {
  const ext = getExt(path);
  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) return 'media';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'excalidraw') return 'excalidraw';
  if (ext === 'json') return 'json';
  if (BINARY_EXT.has(ext)) return 'binary';
  return 'code';
}

export function isTsvPath(path: string): boolean {
  return getExt(path) === 'tsv';
}

/** True if a media path is video (so the viewer renders <video> rather than
 *  <audio>). Cheap ext check — no IPC. */
export function isVideoExt(path: string): boolean {
  return VIDEO_EXT.has(getExt(path));
}

export function looksBinary(text: string): boolean {
  // Quick null-byte heuristic on the first 8KB. Most text files won't contain \x00.
  const sample = text.length > 8192 ? text.slice(0, 8192) : text;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) return true;
  }
  return false;
}

export function findLanguage(path: string): LanguageDescription | null {
  const name = path.split('/').pop() ?? path;
  const byFilename = LanguageDescription.matchFilename(languages, name);
  if (byFilename) return byFilename;
  const ext = getExt(path);
  if (!ext) return null;
  return languages.find((l) => l.extensions.includes(ext)) ?? null;
}
