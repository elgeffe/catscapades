export interface GameSettings {
  masterVolume: number;
  effectsVolume: number;
  graphics: "low" | "high";
  reducedMotion: boolean;
  highContrast: boolean;
}

const KEY = "catscapades-settings-v1";
export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8, effectsVolume: 0.8, graphics: "high", reducedMotion: false, highContrast: false,
};

export function loadSettings(storage: Pick<Storage, "getItem"> | null = safeStorage()): GameSettings {
  try {
    const value = storage?.getItem(KEY);
    if (!value) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(value) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(settings)); } catch { /* In-memory settings remain active. */ }
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
