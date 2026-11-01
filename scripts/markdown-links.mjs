import { posix } from 'node:path';

export function validateMarkdownLinks(file, text, indexedFiles) {
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const reference = match[1];
    if (/^(https?:|#)/.test(reference)) continue;
    const target = posix.normalize(posix.join(posix.dirname(file), reference.split('#')[0]));
    if (posix.isAbsolute(reference) || !indexedFiles.has(target)) throw new Error(`Markdown target not in the Git index: ${file} -> ${target}`);
  }
}
