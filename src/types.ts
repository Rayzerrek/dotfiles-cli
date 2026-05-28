/** Platform labels accepted in config `systemPath` maps. */
export const PLATFORM_KEYS = ["windows", "macos", "linux"] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/**
 * User-provided target path for a link.
 *
 * A plain string applies on every platform. An object applies only when it
 * contains the current platform key.
 */
export type SystemPathSpec = string | Partial<Record<PlatformKey, string>>;

export interface DotfileLink {
  name: string;
  systemPath: SystemPathSpec;
}

/** Raw optional configuration before defaults and path resolution are applied. */
export interface DotConfig {
  dotfilesDir?: string;
  links?: DotfileLink[];
}

/** Link entry after config defaults, platform selection, and path normalization. */
export interface ResolvedLink {
  name: string;
  repoPath: string;
  systemPath: string;
}

/** Fully resolved application configuration used by command handlers. */
export interface AppConfig {
  dotfilesDir: string;
  links: ResolvedLink[];
}

export interface LinkCheckResult {
  linked: boolean;
  message: string;
}
