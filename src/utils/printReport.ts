/**
 * Fungsi bantu untuk mencetak laporan.
 */

/**
 * Meng-escape karakter khusus HTML (&, <, >, ") untuk mencegah XSS dan tampilan rusak.
 */
export function escapeHtml(s: string): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isMobileDevice(): boolean {
  const ua = navigator.userAgent || '';
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS;
}

/**
 * KOMPUTER: mencetak lewat iframe tersembunyi lalu mengembalikan judul dokumen (fungsi lama).
 */
function printViaIframe(html: string, title: string): void {
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

/**
 * HP / TABLET: laporan dimasukkan sementara ke halaman ini, aplikasi disembunyikan saat cetak,
 * lalu window.print() dipanggil. Safari iPhone tidak bisa mencetak iframe (yang tercetak malah
 * halaman aplikasi), dan tidak memerlukan pop-up.
 */
function printInPage(html: string, title: string): void {
  // Buang sisa cetak sebelumnya (kalau ada)
  document.getElementById('print-root')?.remove();
  document.getElementById('print-style')?.remove();

  const parsed = new DOMParser().parseFromString(html, 'text/html');

  // Aturan "body" milik laporan dipindahkan ke #print-root agar tidak memengaruhi aplikasi
  const reportCss = Array.from(parsed.querySelectorAll('style'))
    .map(s => s.textContent || '')
    .join('\n')
    .replace(/(^|[}\s])body(\s*\{)/g, '$1#print-root$2');

  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = `
    #print-root { display: none; }
    @media print {
      body > *:not(#print-root) { display: none !important; }
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
      }
      #print-root { display: block !important; }
      ${reportCss}
    }
  `;

  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = parsed.body.innerHTML;

  document.head.appendChild(style);
  document.body.appendChild(root);

  // Judul dokumen dipakai sebagai nama file saat "Simpan PDF"
  const originalTitle = document.title;
  document.title = title;

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    window.removeEventListener('pointerdown', cleanup, true);
    document.title = originalTitle;
    style.remove();
    root.remove();
  };

  // Dibersihkan saat layar disentuh lagi setelah dialog cetak ditutup, atau setelah 5 menit.
  // (Tidak dibersihkan lebih awal karena iPhone menyusun ulang pratinjau saat ukuran kertas diubah.)
  window.addEventListener('pointerdown', cleanup, true);
  setTimeout(cleanup, 300000);

  setTimeout(() => {
    try {
      window.print();
    } catch {
      cleanup();
    }
  }, 300);
}

/**
 * Mencetak laporan HTML. Komputer memakai iframe, HP memakai cetak langsung di halaman.
 */
export function printHtml(html: string, title: string): void {
  if (isMobileDevice()) {
    printInPage(html, title);
  } else {
    printViaIframe(html, title);
  }
}
