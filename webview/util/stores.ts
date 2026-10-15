// What the extension last sent, and whether anyone can see the view.

import type { ViewState } from "../../src/shared/types";
import { createStore } from "./store";

export const viewState = createStore<ViewState | null>(null);

// The extension says when the view is hidden (another view in front, the
// sidebar closed); the page's own visibility covers a minimized window.
export const hostVisible = createStore(true);
export const pageVisible = createStore(document.visibilityState !== "hidden");

// Bumped when a pet's color changes, so the rows repaint their bars
export const petColorsVersion = createStore(0);
