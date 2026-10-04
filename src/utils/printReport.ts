/**
 * Helper functions for printing reports via hidden iframe.
 */

/**
 * Escapes special HTML characters (&, <, >, ") to prevent XSS and formatting issues.
 */
export function escapeHtml(s: string): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Prints HTML content in an invisible iframe and restores the document title afterwards.
 */
export function printHtml(html: string, title: string): void {
  const originalTitle = document.title;
  document.title = title;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';

  document.body.appendChild(iframe);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    document.title = originalTitle;
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  // Cadangan timeout 2 menit
  const timeoutId = setTimeout(cleanup, 120000);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc) {
    clearTimeout(timeoutId);
    cleanup();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Tunggu sekitar 300 ms, lalu memanggil print() pada iframe
  setTimeout(() => {
    try {
      const win = iframe.contentWindow;
      if (win) {
        win.onafterprint = () => {
          clearTimeout(timeoutId);
          cleanup();
        };
        win.focus();
        win.print();
      } else {
        clearTimeout(timeoutId);
        cleanup();
      }
    } catch {
      clearTimeout(timeoutId);
      cleanup();
    }
  }, 300);
}
