import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

export type FileKind = 'markdown' | 'code' | 'image' | 'binary';

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx']);

const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff',
]);

const BINARY_EXT = new Set([
  'pdf', 'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'mp3', 'wav', 'flac', 'ogg', 'm4a',
  'mp4', 'mov', 'mkv', 'webm', 'avi',
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
  if (BINARY_EXT.has(ext)) return 'binary';
  return 'code';
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
