import { db } from '@/db';
import { leads, scrapedLeads } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function SyncBrandsPage() {
  const scrapedRows = await db
    .select({ brand: scrapedLeads.brandName })
    .from(scrapedLeads);

  const set = new Set<string>();
  for (const r of scrapedRows) {
    if (r.brand && r.brand.trim()) set.add(r.brand.trim());
  }
  const brands = Array.from(set);

  return (
    <html lang="id">
      <head>
        <title>Syncing Brands - NovaCore CRM</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          padding: 24,
          background: '#0f172a',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 16,
            padding: '24px 28px',
            maxWidth: 320,
            width: '100%',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
          <h2 style={{ fontSize: 16, margin: '0 0 6px 0', fontWeight: 700, color: '#38bdf8' }}>
            Menyinkronkan Buku Catatan
          </h2>
          <p style={{ fontSize: 13, margin: '0 0 12px 0', color: '#94a3b8', lineHeight: 1.4 }}>
            Mengirim {brands.length} brand terdaftar ke TikTok Shop...
          </p>
          <div style={{ fontSize: 11, color: '#64748b' }}>Jendela ini akan menutup otomatis.</div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var brands = ${JSON.stringify(brands)};
                function send() {
                  if (window.opener) {
                    try {
                      window.opener.postMessage({ type: 'TNT_SYNC_BRANDS', brands: brands }, '*');
                    } catch(e) {}
                  }
                }
                send();
                window.addEventListener('message', function(e) {
                  if (e.data && e.data.type === 'TNT_SYNC_ACK') {
                    window.close();
                  }
                });
                var retryTimer = setInterval(send, 400);
                setTimeout(function() {
                  clearInterval(retryTimer);
                  window.close();
                }, 7500);
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
