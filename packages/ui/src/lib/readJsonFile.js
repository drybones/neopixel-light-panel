/*
 * Reads a picked File as JSON.
 *
 * FileReader is callback-shaped and the two callers (the settings page's
 * import rows and the switcher's empty state) both want to `await` it and
 * report one message, so the promise wrapper lives here rather than twice in
 * JSX. Rejections carry a clause that reads correctly after "Import failed:",
 * because that is the only thing either caller does with them.
 */
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(JSON.parse(e.target.result));
      } catch {
        reject(new Error('the file is not valid JSON.'));
      }
    };
    reader.onerror = () => reject(new Error('the file could not be read.'));
    reader.readAsText(file);
  });
}
