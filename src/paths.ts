import { homedir } from "os";
import { join, normalize, resolve } from "path";

/**
 * Resolves and normalizes a system path, expanding home directory shortcuts (~).
 *
 * @param p - The raw path to normalize.
 * @returns The absolute, normalized path.
 */
export function normalizePath(p: string): string {
  const expanded = p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
  return resolve(normalize(expanded));
}
