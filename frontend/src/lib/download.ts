/**
 * Saves text as a file through the webview's own download, like any browser download
 * (normally into the Downloads folder). Nothing leaves this PC.
 */
export function downloadText(fileName: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Kept long enough for the webview to take the blob over.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
