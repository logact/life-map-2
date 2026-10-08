import { cartographer } from "./cartographer";
import { Theme } from "./types";

// the theme registry: adding a theme (e.g. a "nocturne" dark mode) is a new
// file plus one entry here — components never touch this map directly
const themes: Record<string, Theme> = { cartographer };

// one-line selector: point at another registry entry to re-theme the app
const ACTIVE = "cartographer";

export const THEME = themes[ACTIVE];
