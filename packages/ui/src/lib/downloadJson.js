// Triggers a browser download of a JSON payload. Shared by the bulk scene
// export (SceneGrid) and the single-scene export (Editor) so the blob/anchor
// dance only exists once.
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Filesystem/URL-safe stand-in for a scene name in a filename.
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scene';
}
