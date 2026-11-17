import type { Theme } from './trailreelTypes';

/** Video colour themes: route line, its outline, and the HUD accent. */
const THEMES: Theme[] = [
  { id: 'ember', name: 'Ember', route: '#ff6a1f', casing: '#ffffff', accent: '#ff6a1f', onAccent: '#ffffff' },
  { id: 'sunburst', name: 'Sunburst', route: '#ffd21f', casing: '#1d1d1f', accent: '#ffd21f', onAccent: '#1d1d1f' },
  { id: 'glacier', name: 'Glacier', route: '#38bdf8', casing: '#ffffff', accent: '#38bdf8', onAccent: '#08222f' },
  { id: 'alpine', name: 'Alpine', route: '#22c55e', casing: '#ffffff', accent: '#22c55e', onAccent: '#062612' },
  { id: 'berry', name: 'Berry', route: '#ff3d7f', casing: '#ffffff', accent: '#ff3d7f', onAccent: '#ffffff' },
  { id: 'violet', name: 'Violet', route: '#a78bfa', casing: '#ffffff', accent: '#8b5cf6', onAccent: '#ffffff' },
  { id: 'lava', name: 'Lava', route: '#ef4444', casing: '#ffffff', accent: '#ef4444', onAccent: '#ffffff' },
  { id: 'lagoon', name: 'Lagoon', route: '#2dd4bf', casing: '#0f2f2b', accent: '#14b8a6', onAccent: '#04201c' },
  { id: 'sand', name: 'Sand', route: '#f0c987', casing: '#2b2116', accent: '#e7c08a', onAccent: '#2b2116' },
  { id: 'snow', name: 'Snow', route: '#ffffff', casing: '#111418', accent: '#f4f6f8', onAccent: '#111418' },
  { id: 'night', name: 'Night', route: '#c084fc', casing: '#120a1f', accent: '#1e1b4b', onAccent: '#e9e3ff' },
  { id: 'citrus', name: 'Citrus', route: '#a3e635', casing: '#1a2e05', accent: '#a3e635', onAccent: '#1a2e05' },
];

export const trailreelThemes = {
  all: THEMES,
  get(id: string): Theme {
    return THEMES.find((t) => t.id === id) ?? THEMES[0];
  },
};
