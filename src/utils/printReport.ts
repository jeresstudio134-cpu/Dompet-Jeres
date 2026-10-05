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

/**
 * Membuka laporan di tab baru lalu mencetaknya. Cara ini bekerja di komputer dan di iPhone
 * (cetak lewat iframe tersembunyi tidak berfungsi di Safari iPhone).
 */
export function printHtml(html: string, title: string): void {
  // Judul disisipkan aman ke dalam script (tanda "<" dilarikan agar tidak menutup tag script)
  const safeTitle = JSON.stringify(title).replace(/</g, '\\u003c');

  const toolbar = `
    <div class="no-print" style="position:fixed;top:10px;right:10px;z-index:9;font-family:Arial,sans-serif">
      <button onclick="window.print()" style="padding:10px 16px;border:1px solid #333;background:#111;color:#fff;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer">Cetak / Simpan PDF</button>
    </div>
    <style>@media print { .no-print { display: none !important; } }</style>
    <script>
      document.title = ${safeTitle};
      window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 500); });
    </script>`;

  let doc = html.includes('</body>') ? html.replace('</body>', () => toolbar + '</body>') : html + toolbar;

  // Lebar halaman A4 (794px) supaya tata letaknya sama di HP dan di komputer
  if (doc.includes('<head>')) {
    doc = doc.replace('<head>', () => '<head><meta name="viewport" content="width=794, initial-scale=1">');
  }

  const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
  const reportWindow = window.open(url, '_blank');

  if (!reportWindow) {
    URL.revokeObjectURL(url);
    alert('Pop-up diblokir browser. Izinkan pop-up untuk situs ini, lalu coba lagi.');
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 300000);
}
