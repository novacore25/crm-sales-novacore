'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Inbox, 
  Search, 
  CheckSquare, 
  Square, 
  UserPlus, 
  EyeOff, 
  Trash2, 
  ExternalLink, 
  Phone, 
  Mail, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Copy, 
  Check, 
  AlertCircle, 
  GitMerge, 
  ChevronRight,
  ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';
import type { ScrapedLeadRow } from '@/app/actions/scraped-lead-actions';
import { 
  promoteScrapedLeadsToMain, 
  ignoreScrapedLeads, 
  deleteScrapedLeads,
  mergeScrapedLeadIntoExisting,
  saveScrapedBatch
} from '@/app/actions/scraped-lead-actions';
import type { UserProfile } from '@/lib/auth-users';

interface ScrapedLeadsClientProps {
  initialLeads: ScrapedLeadRow[];
  users: UserProfile[];
  categories: string[];
}

export type StagingFilterView = 'pending_all' | 'pending_new' | 'pending_matched' | 'promoted' | 'ignored' | 'all';

function formatScrapedDate(dateStr?: string | null) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

function formatScrapedTime(dateStr?: string | null) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' WIB';
  } catch {
    return '';
  }
}

function getRelativeTime(dateStr?: string | null) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return 'Baru saja';
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return `${diffMin} mnt lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    if (diffDays === 1) return 'Kemarin';
    if (diffDays < 7) return `${diffDays} hr lalu`;
    return '';
  } catch {
    return '';
  }
}

export default function ScrapedLeadsClient({
  initialLeads,
  users,
  categories,
}: ScrapedLeadsClientProps) {
  const [leadsList, setLeadsList] = useState<ScrapedLeadRow[]>(initialLeads);
  const [filterView, setFilterView] = useState<StagingFilterView>('pending_all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [selectedLeadForMerge, setSelectedLeadForMerge] = useState<ScrapedLeadRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);

  // Form Tarik ke Leads Utama
  const [selectedPic, setSelectedPic] = useState<string>(users[0]?.name || '');
  const [selectedCategory, setSelectedCategory] = useState<string>(categories[0] || 'Beauty & Personal Care');
  const [selectedProduct, setSelectedProduct] = useState<string>('TNT');

  // Bookmarklet Super Cerdas: Auto-Scroll, Cap Stempel, Input Target Jumlah, Deteksi Kategori, Polling Cepat, dan CSP Bypass via postMessage & Clipboard
  const bookmarkletCode = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://sales.tntkreatif.com';

    const code = `(async function(){
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      const getCategory = async () => {
        const cascader = document.querySelector('[data-tid="m4b_cascader"], .arco-cascader');
        if (!cascader) return null;

        const valEl = cascader.querySelector('.arco-cascader-view-value');
        if (!valEl) return null;
        const rawVal = (valEl.innerText || '').trim();
        if (!rawVal || rawVal.toLowerCase() === 'category') return null;

        let fullText = '';
        const hoverTarget = cascader.querySelector('.arco-tooltip-open') || valEl || cascader;
        hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await wait(350);

        const tooltips = Array.from(document.querySelectorAll('.arco-tooltip-content, .arco-tooltip, [role="tooltip"]'));
        for (const tip of tooltips) {
          const t = (tip.innerText || '').trim();
          if (t && (t.includes('/') || t.length > 3)) {
            fullText = t;
            break;
          }
        }

        hoverTarget.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        document.querySelectorAll('.arco-tooltip').forEach((el) => el.style.setProperty('display', 'none', 'important'));

        if (!fullText) {
          const titleNode = cascader.querySelector('[title]');
          if (titleNode && titleNode.getAttribute('title')) {
            fullText = titleNode.getAttribute('title');
          } else {
            fullText = rawVal;
          }
        }

        if (fullText) {
          const first = fullText.split('/')[0].split('>')[0].split('\\n')[0].trim();
          if (first && first !== '...' && first.toLowerCase() !== 'category') {
            return first;
          }
        }
        return null;
      };

      const selectedCategory = await getCategory();
      if (!selectedCategory) {
        alert('⚠️ Kategori produk belum dipilih!\\n\\nSilakan pilih filter Kategori terlebih dahulu di TikTok Shop sebelum mengambil leads.');
        return;
      }

      const targetStr = prompt('Kategori: [' + selectedCategory + ']\\n\\nBerapa banyak leads yang ingin diambil?', '50');
      if (!targetStr) return;
      const targetCount = parseInt(targetStr, 10);
      if (isNaN(targetCount) || targetCount <= 0) {
        alert('Jumlah tidak valid');
        return;
      }

      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999999;background:#0f172a;color:#fff;padding:16px 22px;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,0.5);font-family:system-ui,-apple-system,sans-serif;font-size:13px;max-width:340px;line-height:1.5;border:1px solid #334155;';
      box.innerHTML = '<b>🚀 TNT CRM Scraper</b><div style="font-size:12px;color:#38bdf8;margin-top:2px;font-weight:600;">📁 ' + selectedCategory + '</div><div id="tnt-status" style="margin-top:6px;color:#94a3b8;">Menyiapkan...</div>';
      document.body.appendChild(box);
      const update = (msg) => {
        const el = document.getElementById('tnt-status');
        if (el) el.innerText = msg;
      };

      try {
        update('📡 Menghubungkan ke CRM untuk mengambil buku catatan...');

        const knownBrands = new Set();
        let syncSuccess = false;

        const syncWin = window.open(
          '${origin}/sync-brands',
          'tnt_sync_popup',
          'width=380,height=300,left=150,top=150'
        );

        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            cleanup();
            if (syncWin && !syncWin.closed) {
              try { syncWin.close(); } catch(e) {}
            }
            resolve();
          }, 8000);

          const onMsg = (event) => {
            if (event.data && event.data.type === 'TNT_SYNC_BRANDS' && Array.isArray(event.data.brands)) {
              cleanup();
              syncSuccess = true;
              event.data.brands.forEach((b) => {
                if (b && typeof b === 'string') knownBrands.add(b.toLowerCase().trim());
              });
              try {
                localStorage.setItem('tnt_known_brands', JSON.stringify(Array.from(knownBrands)));
              } catch(e) {}
              if (syncWin && !syncWin.closed) {
                try {
                  syncWin.postMessage({ type: 'TNT_SYNC_ACK' }, '*');
                  syncWin.close();
                } catch(e) {}
              }
              resolve();
            }
          };

          const cleanup = () => {
            clearTimeout(timeout);
            window.removeEventListener('message', onMsg);
          };

          window.addEventListener('message', onMsg);
        });

        if (!syncSuccess) {
          box.style.background = '#881337';
          box.innerHTML = '<b>❌ Gagal Sinkronisasi Buku Catatan CRM</b><div style="font-size:12px;margin-top:6px;line-height:1.4;color:#fecdd3;">Koneksi ke CRM timeout/gagal. Scraper dihentikan agar tidak terjadi data dobel.<br/><br/>Silakan pastikan internet lancar, lalu <b>klik lagi bookmarklet</b>.</div>';
          setTimeout(() => box.remove(), 7000);
          return;
        }

        update('✅ ' + knownBrands.size + ' Brand tercatat! Memulai...');
        await wait(600);

        const items = [];
        let idleScrolls = 0;
        let isStopped = false;

        const stopBtn = document.createElement('button');
        stopBtn.innerText = '⏹️ Stop & Simpan Sekarang';
        stopBtn.style.cssText = 'margin-top:8px;background:#334155;color:#f1f5f9;border:1px solid #475569;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;width:100%;font-weight:600;';
        stopBtn.onclick = () => { isStopped = true; stopBtn.innerText = '⏳ Menghentikan...'; };
        box.appendChild(stopBtn);

        while (items.length < targetCount && idleScrolls < 45 && !isStopped) {
          const allCards = Array.from(document.querySelectorAll('.rounded-4'));
          const pendingCards = allCards.filter((c) => !c.hasAttribute('data-tnt-scraped'));

          if (!pendingCards.length) {
            idleScrolls++;
            update('[' + items.length + '/' + targetCount + '] Memuat data...');

            // Trik jiggle/bounce scroll jika mentok: scroll ke atas sedikit, tunggu, lalu scroll ke bawah lagi
            if (idleScrolls % 2 === 0) {
              window.scrollBy({ top: -500, behavior: 'smooth' });
              await wait(900);
            }

            // Infinite scroll: gulir window & kontainer scrollable ke bawah
            window.scrollBy({ top: 2000, behavior: 'instant' });
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
            document.documentElement.scrollTop = document.documentElement.scrollHeight;
            document.body.scrollTop = document.body.scrollHeight;
            window.dispatchEvent(new Event('scroll', { bubbles: true }));

            const scrollables = Array.from(document.querySelectorAll('*')).filter((el) => {
              const ov = window.getComputedStyle(el).overflowY;
              return (ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight;
            });
            for (const el of scrollables) {
              if (idleScrolls % 2 === 0) {
                el.scrollTop -= 500;
              }
              el.scrollTop += 2000;
              if (idleScrolls >= 2) el.scrollTop = el.scrollHeight;
              el.dispatchEvent(new Event('scroll', { bubbles: true }));
            }

            await wait(1600);
            continue;
          }

          // Urutkan kartu secara presisi: Baris atas duluan (top), lalu kiri ke kanan (left)
          pendingCards.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            const topDiff = (window.scrollY + ra.top) - (window.scrollY + rb.top);
            if (Math.abs(topDiff) > 60) return topDiff;
            return (window.scrollX + ra.left) - (window.scrollX + rb.left);
          });

          idleScrolls = 0;

          for (let i = 0; i < pendingCards.length && items.length < targetCount && !isStopped; i++) {
            const card = pendingCards[i];
            card.setAttribute('data-tnt-scraped', 'true');

            // 1. Ekstrak Nama Brand terlebih dahulu
            const brandEl = card.querySelector('.bg-neutral-bg3 .arco-typography') || card.querySelector('.bg-neutral-bg3');
            let brand = '-';
            if (brandEl) {
              const titleNode = brandEl.getAttribute('title') ? brandEl : brandEl.querySelector('[title]');
              if (titleNode && titleNode.getAttribute('title')) {
                brand = titleNode.getAttribute('title').split('(')[0].trim();
              } else {
                brand = (brandEl.innerText || '').split('(')[0].trim();
              }

              // Jika nama brand masih terpotong elipsis (... atau …), hover untuk membaca tooltip Arco
              if (brand.includes('...') || brand.includes('…')) {
                const hoverEl = brandEl.querySelector('.arco-typography') || brandEl;
                hoverEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                hoverEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                await wait(220);

                const tooltips = Array.from(document.querySelectorAll('.arco-tooltip-content, .arco-tooltip, [role="tooltip"]'));
                for (const tip of tooltips) {
                  const tipTxt = (tip.innerText || '').split('(')[0].trim();
                  if (tipTxt && !tipTxt.includes('...') && !tipTxt.includes('…') && tipTxt.length > 2) {
                    brand = tipTxt;
                    break;
                  }
                }
                hoverEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                document.querySelectorAll('.arco-tooltip').forEach((el) => el.style.setProperty('display', 'none', 'important'));
              }
            }

            // 2. Lewati langsung jika brand ini sudah ada di CRM atau sudah didapatkan di sesi ini
            if (brand && brand !== '-') {
              const bLower = brand.toLowerCase().trim();
              if (knownBrands.has(bLower) || items.some((it) => it.brand.toLowerCase().trim() === bLower)) {
                continue;
              }
            }

            // 3. Hover KARTU produk agar redup & memunculkan overlay tombol aksi (Copy, Chat, Select)
            card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await wait(180);

            // 4. Cari tombol chat (baik via ikon chat maupun tombol persis di sebelah kiri tombol Select)
            let chatBtn = null;
            for (let waitLoad = 0; waitLoad < 6; waitLoad++) {
              let chatImg = card.querySelector('img[src*="data:image/svg+xml"], svg[class*="chat"], .arco-icon-message');
              if (chatImg) {
                const btn = chatImg.closest('button, div');
                if (btn && !(btn.innerText || '').includes('Select')) {
                  chatBtn = btn;
                  break;
                }
              }

              // Fallback: tombol persis di sebelah kiri tombol 'Select'
              const selectBtn = Array.from(card.querySelectorAll('button, div')).find((el) => (el.innerText || '').trim() === 'Select');
              if (selectBtn && selectBtn.previousElementSibling) {
                chatBtn = selectBtn.previousElementSibling;
                break;
              }

              await wait(200);
            }

            if (!chatBtn) {
              card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
              continue;
            }

            const titleEl = card.querySelector('.text-body-m-regular');
            let product = titleEl ? titleEl.innerText.trim() : '-';

            chatBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            chatBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            chatBtn.click();
            await wait(350);

            const allPopovers = document.querySelectorAll('.arco-popover-inner-content');
            const popover = allPopovers[allPopovers.length - 1];
            let phone = '';
            let email = '';

            if (popover) {
              let eye = popover.querySelector('svg[class*="eye"], .arco-icon-eye, .arco-icon-eye-invisible, .arco-icon-eye_invisible, [class*="eye"]');
              if (!eye) {
                const headerEl = Array.from(popover.querySelectorAll('div, p, span')).find((el) => (el.innerText || '').includes('Contact'));
                if (headerEl) eye = headerEl.querySelector('svg');
              }
              if (!eye) {
                eye = popover.querySelector('svg');
              }

              if (eye) {
                const eyeBtn = eye.closest('.arco-icon-hover, button, span, div') || eye;
                [eyeBtn, eye].forEach((el) => {
                  try {
                    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    if (typeof el.click === 'function') el.click();
                  } catch(e) {}
                });

                for (let poll = 0; poll < 35; poll++) {
                  await wait(50);
                  const pTxt = popover.innerText;
                  if (!pTxt.includes('*')) break;
                  if (poll === 8) {
                    [eyeBtn, eye].forEach((el) => {
                      try {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        if (typeof el.click === 'function') el.click();
                      } catch(e) {}
                    });
                  }
                }
              }

              const txt = popover.innerText;

              // Syarat mutlak: hanya ambil data jika teks di popover TIDAK lagi mengandung bintang '*'
              if (!txt.includes('*')) {
                for (const line of txt.split('\\n')) {
                  const trimmed = line.trim();
                  if (trimmed.includes('@')) {
                    const mMail = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
                    if (mMail) email = mMail[0];
                    continue;
                  }
                  // Ekstrak nomor WA/telepon: dukung semua negara di dunia secara presisi
                  if (trimmed.includes('+') || /^[A-Z]{2}\\s*[\\+\\d]/i.test(trimmed) || trimmed.replace(/[^\\d]/g, '').length >= 8) {
                    let clean = '';
                    if (trimmed.includes('+')) {
                      // Ambil angka persis setelah '+' agar kode negara internasional (+86, +60, +65, dsb) tetap utuh
                      clean = trimmed.slice(trimmed.indexOf('+') + 1).replace(/[^\\d]/g, '');
                    } else {
                      // Buang 2 huruf kode negara jika ada di depan teks (misal 'ID ', 'CN ', 'MY ')
                      clean = trimmed.replace(/^[A-Z]{2}\\s*/i, '').replace(/[^\\d]/g, '');
                    }

                    // Khusus nomor Indonesia:
                    // Jika tertulis '08xxx' lokal tanpa +62, jadikan '628xxx'
                    // Jika tertulis '6208xxx' (ada angka 0 redundan setelah +62), rapikan jadi '628xxx'
                    if (clean.startsWith('08')) {
                      clean = '628' + clean.slice(2);
                    } else if (clean.startsWith('6208')) {
                      clean = '628' + clean.slice(4);
                    }

                    // Untuk negara lain (China '86...', Malaysia '60...', Singapura '65...', AS '1...', dsb): simpan apa adanya
                    if (clean.length >= 8) {
                      phone = clean;
                      break;
                    }
                  }
                }
              }

              if (popover.closest('.arco-trigger')) {
                popover.closest('.arco-trigger').style.setProperty('display', 'none', 'important');
              }
            }
            chatBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

            if (brand && (phone || email)) {
              items.push({ brand, phone, email, product, category: selectedCategory });
              knownBrands.add(brand.toLowerCase().trim());

              try {
                localStorage.setItem('tnt_scraped_backup', JSON.stringify(items));
                if (items.length % 5 === 0) {
                  navigator.clipboard.writeText(JSON.stringify(items));
                }
              } catch(e) {}
            }

            update('[' + items.length + '/' + targetCount + '] ' + brand + ' (' + (phone || email) + ')');
            await wait(60);
          }
        }

        document.querySelectorAll('.arco-trigger.arco-popover').forEach((el) => el.style.setProperty('display', 'none', 'important'));

        try {
          await navigator.clipboard.writeText(JSON.stringify(items));
        } catch(e){}

        if (items.length === 0) {
          box.style.background = '#334155';
          box.innerHTML = '<b>⚠️ Tidak ada data baru</b><div style="font-size:12px;margin-top:4px;">Semua kartu yang terlihat sudah pernah ditarik sebelumnya.</div>';
          setTimeout(() => box.remove(), 4000);
          return;
        }

        box.style.background = '#1e1b4b';
        box.innerHTML = '<b>🎉 Sukses Ambil ' + items.length + ' Leads!</b><div style="font-size:12px;color:#c7d2fe;margin-top:4px;">Tersalin aman di clipboard & memori. Klik tombol di bawah untuk membuka & menyimpan ke CRM:</div><button id="tnt-crm-btn" style="margin-top:10px;width:100%;padding:10px 14px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:bold;cursor:pointer;font-size:13px;">🚀 Buka & Simpan ke CRM (' + items.length + ' Leads)</button>';

        const sendToCRM = () => {
          const btn = document.getElementById('tnt-crm-btn');
          if (btn) btn.innerText = '📡 Membuka CRM...';
          const crmWin = window.open('${origin}/scraped-leads#incoming', '_blank');

          let saved = false;
          const msgHandler = (ev) => {
            if (ev.data && ev.data.type === 'CRM_IMPORT_DONE') {
              saved = true;
              window.removeEventListener('message', msgHandler);
              box.style.background = '#065f46';
              box.innerHTML = '<b>✅ Sukses Tersimpan!</b><div style="margin-top:4px;">' + items.length + ' leads sudah masuk ke database CRM.</div>';
              setTimeout(() => box.remove(), 4000);
            }
          };
          window.addEventListener('message', msgHandler);

          let tries = 0;
          const timer = setInterval(() => {
            tries++;
            if (saved || tries > 25) {
              clearInterval(timer);
              return;
            }
            if (crmWin && !crmWin.closed) {
              crmWin.postMessage({ type: 'TNT_LEADS_DATA', items, scrapedBy: 'Bookmarklet' }, '*');
            }
          }, 600);
        };

        const crmBtn = document.getElementById('tnt-crm-btn');
        if (crmBtn) crmBtn.onclick = sendToCRM;
      } catch (err) {
        box.style.background = '#991b1b';
        box.innerHTML = '<b>❌ Error</b><div>' + err.message + '</div>';
        setTimeout(() => box.remove(), 8000);
      }
    })()`;

    // Minifikasi aman: buang komentar satu baris penuh saja (agar URL https:// tidak terpotong)
    const minified = code
      .replace(/^\s*\/\/[^\r\n]*/gm, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return 'javascript:' + minified;
  }, []);

  // Pasang href langsung ke DOM via ref agar tidak diblokir/disanitasi oleh React
  const bookmarkletAnchorRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (bookmarkletAnchorRef.current && bookmarkletCode) {
      bookmarkletAnchorRef.current.setAttribute('href', bookmarkletCode);
    }
  }, [bookmarkletCode]);

  // Listener inter-window: Terima data leads dari bookmarklet TikTok via postMessage (kebal 100% CSP TikTok)
  useEffect(() => {
    const handleIncomingMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'TNT_LEADS_DATA' && Array.isArray(event.data.items)) {
        const items = event.data.items;
        toast.info(`Menerima ${items.length} leads dari TikTok Shop, sedang menyimpan ke database...`);
        try {
          const res = await saveScrapedBatch(items, event.data.scrapedBy || 'Bookmarklet');
          if (res.inserted > 0 || res.skipped > 0) {
            toast.success(`Berhasil menyimpan ${res.inserted} leads baru (${res.skipped} duplikat dilewati).`);
            if (event.source && 'postMessage' in event.source) {
              (event.source as Window).postMessage({ type: 'CRM_IMPORT_DONE', total: res.inserted }, '*');
            }
            window.location.reload();
          } else {
            toast.error(res.error || 'Gagal menyimpan data leads');
          }
        } catch {
          toast.error('Terjadi kesalahan saat menyimpan data leads');
        }
      }
    };

    window.addEventListener('message', handleIncomingMessage);

    // Beri tahu opener jika CRM baru saja terbuka
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'CRM_READY' }, '*');
      } catch {}
    }

    return () => window.removeEventListener('message', handleIncomingMessage);
  }, []);

  // Fungsi Tempel (Paste) Manual dari Clipboard jika pengguna menyalinnya
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        toast.info(`Membaca ${parsed.length} leads dari clipboard, sedang menyimpan...`);
        const res = await saveScrapedBatch(parsed, 'Clipboard');
        if (res.inserted > 0 || res.skipped > 0) {
          toast.success(`Berhasil menyimpan ${res.inserted} leads (${res.skipped} duplikat dilewati).`);
          window.location.reload();
        } else {
          toast.error('Data tidak valid atau sudah ada.');
        }
      } else {
        toast.error('Isi clipboard bukan format leads yang valid.');
      }
    } catch {
      toast.error('Gagal membaca clipboard. Pastikan izin akses clipboard disetujui.');
    }
  };

  // Statistik Scorecard
  const stats = useMemo(() => {
    let pendingAll = 0;
    let pendingNew = 0;
    let pendingMatched = 0;
    let promoted = 0;
    let ignored = 0;

    for (const item of leadsList) {
      if (item.status === 'pending') {
        pendingAll++;
        if (item.matchedLead) {
          pendingMatched++;
        } else {
          pendingNew++;
        }
      } else if (item.status === 'promoted') {
        promoted++;
      } else if (item.status === 'ignored') {
        ignored++;
      }
    }

    return {
      total: leadsList.length,
      pendingAll,
      pendingNew,
      pendingMatched,
      promoted,
      ignored,
    };
  }, [leadsList]);

  // Filter Data
  const filteredLeads = useMemo(() => {
    return leadsList.filter((item) => {
      if (filterView === 'pending_all') {
        if (item.status !== 'pending') return false;
      } else if (filterView === 'pending_new') {
        if (item.status !== 'pending' || !!item.matchedLead) return false;
      } else if (filterView === 'pending_matched') {
        if (item.status !== 'pending' || !item.matchedLead) return false;
      } else if (filterView === 'promoted') {
        if (item.status !== 'promoted') return false;
      } else if (filterView === 'ignored') {
        if (item.status !== 'ignored') return false;
      }

      if (search) {
        const q = search.toLowerCase();
        const b = (item.brandName || '').toLowerCase();
        const c = (item.contact || '').toLowerCase();
        const e = (item.email || '').toLowerCase();
        const p = (item.productName || '').toLowerCase();
        const m = (item.matchedLead?.brandName || '').toLowerCase();
        if (!b.includes(q) && !c.includes(q) && !e.includes(q) && !p.includes(q) && !m.includes(q)) return false;
      }
      return true;
    });
  }, [leadsList, filterView, search]);

  const availableCategories = useMemo(() => {
    const set = new Set(categories);
    leadsList.forEach((l) => {
      if (l.category) set.add(l.category);
    });
    return Array.from(set);
  }, [categories, leadsList]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Aksi Tarik ke Leads Utama
  const handlePromoteConfirm = async () => {
    if (!selectedIds.size) return;
    setIsSubmitting(true);
    try {
      const res = await promoteScrapedLeadsToMain({
        scrapedLeadIds: Array.from(selectedIds),
        picName: selectedPic,
        category: selectedCategory,
        productOffered: [selectedProduct],
      });

      if (res.success) {
        toast.success(`Berhasil menarik ${res.promotedCount} leads ke database utama!`);
        setLeadsList((prev) =>
          prev.map((l) => (selectedIds.has(l.id) ? { ...l, status: 'promoted' } : l))
        );
        setSelectedIds(new Set());
        setIsPromoteModalOpen(false);
      } else {
        toast.error(res.error || 'Gagal mempromosikan leads');
      }
    } catch {
      toast.error('Terjadi kesalahan saat mempromosikan leads');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Aksi Gabungkan Kontak ke Lead yang Sudah Ada
  const handleMergeConfirm = async () => {
    if (!selectedLeadForMerge || !selectedLeadForMerge.matchedLead) return;
    setIsSubmitting(true);
    try {
      const res = await mergeScrapedLeadIntoExisting({
        scrapedLeadId: selectedLeadForMerge.id,
        targetLeadId: selectedLeadForMerge.matchedLead.id,
      });

      if (res.success) {
        toast.success(`Kontak berhasil digabungkan ke lead ${selectedLeadForMerge.matchedLead.brandName}!`);
        setLeadsList((prev) =>
          prev.map((l) => (l.id === selectedLeadForMerge.id ? { ...l, status: 'promoted' } : l))
        );
        setIsMergeModalOpen(false);
        setSelectedLeadForMerge(null);
      } else {
        toast.error(res.error || 'Gagal menggabungkan kontak');
      }
    } catch {
      toast.error('Terjadi kesalahan saat menggabungkan kontak');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Aksi Abaikan
  const handleIgnore = async () => {
    if (!selectedIds.size) return;
    try {
      const ids = Array.from(selectedIds);
      await ignoreScrapedLeads(ids);
      toast.success(`${ids.length} leads diubah statusnya menjadi diabaikan`);
      setLeadsList((prev) =>
        prev.map((l) => (selectedIds.has(l.id) ? { ...l, status: 'ignored' } : l))
      );
      setSelectedIds(new Set());
    } catch {
      toast.error('Gagal mengabaikan leads');
    }
  };

  // Aksi Hapus Banyak (Bulk)
  const handleDelete = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Hapus ${selectedIds.size} leads terpilih secara permanen dari penampungan?`)) return;
    try {
      const ids = Array.from(selectedIds);
      await deleteScrapedLeads(ids);
      toast.success(`${ids.length} leads berhasil dihapus`);
      setLeadsList((prev) => prev.filter((l) => !selectedIds.has(l.id)));
      setSelectedIds(new Set());
    } catch {
      toast.error('Gagal menghapus leads');
    }
  };

  // Aksi Hapus Satuan (Single)
  const handleDeleteSingle = async (id: string, brandName: string) => {
    if (!confirm(`Hapus lead "${brandName}" dari penampungan?`)) return;
    try {
      await deleteScrapedLeads([id]);
      toast.success(`Lead "${brandName}" berhasil dihapus`);
      setLeadsList((prev) => prev.filter((l) => l.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      toast.error('Gagal menghapus lead');
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(bookmarkletCode);
    setCopiedBookmarklet(true);
    toast.success('Kode Bookmarklet berhasil disalin ke clipboard!');
    setTimeout(() => setCopiedBookmarklet(false), 3000);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 w-full max-w-[1700px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-600">
              <Inbox className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Penampungan Leads (Staging)
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Data leads hasil scraping marketplace sebelum disetujui dan ditarik ke database utama.
              </p>
            </div>
          </div>
        </div>

        {/* Counter Info */}
        <div className="flex items-center gap-2">
          <span className="px-3.5 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 text-xs font-bold">
            Total {stats.total} Leads di Penampungan
          </span>
        </div>
      </div>

      {/* Scorecards Interaktif (Klik untuk filter instan) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        {/* 1. Menunggu Dipilah */}
        <button
          type="button"
          onClick={() => {
            setFilterView('pending_all');
            setSelectedIds(new Set());
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden group ${
            filterView === 'pending_all'
              ? 'bg-amber-50/80 border-amber-400 ring-2 ring-amber-400/30 shadow-md'
              : 'bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50/30 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Menunggu Dipilah</span>
            <div className={`p-2 rounded-xl transition-colors ${
              filterView === 'pending_all' ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700 group-hover:bg-amber-200'
            }`}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {stats.pendingAll}
            </span>
            <span className="text-xs text-amber-700 font-medium">Semua antrean</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Total data baru dari TikTok Shop
          </p>
          {filterView === 'pending_all' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500 rounded-b-2xl" />
          )}
        </button>

        {/* 2. Brand Baru (Fresh) */}
        <button
          type="button"
          onClick={() => {
            setFilterView('pending_new');
            setSelectedIds(new Set());
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden group ${
            filterView === 'pending_new'
              ? 'bg-indigo-50/80 border-indigo-400 ring-2 ring-indigo-400/30 shadow-md'
              : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Brand Baru</span>
            <div className={`p-2 rounded-xl transition-colors ${
              filterView === 'pending_new' ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 group-hover:bg-indigo-200'
            }`}>
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {stats.pendingNew}
            </span>
            <span className="text-xs text-indigo-700 font-semibold">100% Fresh</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Siap ditarik ke Leads Utama
          </p>
          {filterView === 'pending_new' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-b-2xl" />
          )}
        </button>

        {/* 3. Data Mirip / Kembar */}
        <button
          type="button"
          onClick={() => {
            setFilterView('pending_matched');
            setSelectedIds(new Set());
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden group ${
            filterView === 'pending_matched'
              ? 'bg-purple-50/80 border-purple-400 ring-2 ring-purple-400/30 shadow-md'
              : 'bg-white border-slate-200 hover:border-purple-300 hover:bg-purple-50/30 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Data Mirip</span>
            <div className={`p-2 rounded-xl transition-colors ${
              filterView === 'pending_matched' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 group-hover:bg-purple-200'
            }`}>
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {stats.pendingMatched}
            </span>
            <span className="text-xs text-purple-700 font-semibold">Perlu Cek</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Mirip/dobel dengan lead utama
          </p>
          {filterView === 'pending_matched' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-600 rounded-b-2xl" />
          )}
        </button>

        {/* 4. Sudah Ditarik */}
        <button
          type="button"
          onClick={() => {
            setFilterView('promoted');
            setSelectedIds(new Set());
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden group ${
            filterView === 'promoted'
              ? 'bg-emerald-50/80 border-emerald-400 ring-2 ring-emerald-400/30 shadow-md'
              : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sudah Ditarik</span>
            <div className={`p-2 rounded-xl transition-colors ${
              filterView === 'promoted' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200'
            }`}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {stats.promoted}
            </span>
            <span className="text-xs text-emerald-700 font-medium">Tersimpan</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Sudah masuk pipeline aktif
          </p>
          {filterView === 'promoted' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-600 rounded-b-2xl" />
          )}
        </button>

        {/* 5. Diabaikan */}
        <button
          type="button"
          onClick={() => {
            setFilterView('ignored');
            setSelectedIds(new Set());
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden group col-span-2 sm:col-span-1 ${
            filterView === 'ignored'
              ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-400/30 shadow-md'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Diabaikan</span>
            <div className={`p-2 rounded-xl transition-colors ${
              filterView === 'ignored' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
            }`}>
              <EyeOff className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
              {stats.ignored}
            </span>
            <span className="text-xs text-slate-500 font-medium">Skip</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Dilewati saat kurasi
          </p>
          {filterView === 'ignored' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700 rounded-b-2xl" />
          )}
        </button>
      </div>

      {/* Bookmarklet Tool Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 md:p-6 rounded-2xl shadow-xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold tracking-wide border border-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5" />
            Versi Baru: Auto-Scroll & Deteksi Jumlah
          </div>
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">
            Pasang Tombol Scraper Otomatis di Browser Anda
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Drag tombol biru di samping ke <b>Bookmarks Bar</b> browser Chrome. Saat diklik di TikTok Shop, Anda bisa menentukan ingin ambil berapa data (misal 50 atau 100), dan skrip akan <b>otomatis scroll ke bawah</b> serta membersihkan layar kembali setelah selesai.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto shrink-0">
          <a
            ref={bookmarkletAnchorRef}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              toast.info('Tarik (drag) tombol ini ke baris Bookmark Chrome Anda di bagian atas layar.');
            }}
            className="w-full sm:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2.5 transition-all cursor-grab active:cursor-grabbing border border-indigo-400"
            title="Drag tombol ini ke bookmark bar browser Anda"
          >
            <span>🚀</span>
            <span>Tarik ke Bookmark Bar</span>
          </a>

          <button
            onClick={copyToClipboard}
            className="w-full sm:w-auto px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-colors text-sm"
          >
            {copiedBookmarklet ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copiedBookmarklet ? 'Tersalin' : 'Salin Kode'}</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Tab Status */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-full md:w-auto">
          {[
            { id: 'pending_all', label: 'Menunggu', count: stats.pendingAll },
            { id: 'pending_new', label: 'Brand Baru', count: stats.pendingNew },
            { id: 'pending_matched', label: 'Data Mirip', count: stats.pendingMatched },
            { id: 'promoted', label: 'Ditarik', count: stats.promoted },
            { id: 'ignored', label: 'Diabaikan', count: stats.ignored },
            { id: 'all', label: 'Semua', count: stats.total },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFilterView(tab.id as StagingFilterView);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterView === tab.id
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                filterView === tab.id ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Action & Search */}
        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <button
            onClick={handlePasteClipboard}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-all border border-slate-200 shrink-0"
            title="Tempel data leads yang tersalin di clipboard komputer"
          >
            <span>📥</span>
            <span>Tempel Leads</span>
          </button>

          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari brand, WA, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-800"
            />
          </div>
        </div>
      </div>

      {/* Batch Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-indigo-900 font-bold text-sm">
            <CheckSquare className="w-5 h-5 text-indigo-600" />
            <span>{selectedIds.size} leads terpilih</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPromoteModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-all"
            >
              <UserPlus className="w-4 h-4" />
              <span>Tarik ke Leads Utama</span>
            </button>

            <button
              onClick={handleIgnore}
              className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all"
            >
              <EyeOff className="w-4 h-4" />
              <span>Abaikan</span>
            </button>

            <button
              onClick={handleDelete}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Trash2 className="w-4 h-4" />
              <span>Hapus ({selectedIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Leads Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-xs tracking-wider uppercase">
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={filteredLeads.length > 0 && selectedIds.size === filteredLeads.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                    title="Pilih Semua (Centang Semua)"
                  />
                </th>
                <th className="py-3 px-4">Brand</th>
                <th className="py-3 px-4">Waktu Scraping</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Kontak WhatsApp</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Sampel Produk</th>
                <th className="py-3 px-4">Status & Kemiripan</th>
                <th className="py-3 px-4 text-center">Aksi Cepat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    Tidak ada data leads pada filter ini.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  const isMatched = !!item.matchedLead;

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-indigo-50/40' : ''}`}
                    >
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(item.id)}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                          title="Pilih untuk ditarik atau dihapus"
                        />
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {item.brandName}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{formatScrapedDate(item.scrapedAt)}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 pl-5 flex items-center gap-1.5 mt-0.5">
                            <span>{formatScrapedTime(item.scrapedAt)}</span>
                            {getRelativeTime(item.scrapedAt) && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded font-medium">
                                {getRelativeTime(item.scrapedAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {item.category ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <span>📁</span>
                            <span>{item.category}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs italic">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {item.contact ? (
                          <a
                            href={`https://wa.me/${item.contact}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 font-semibold hover:underline"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>+{item.contact}</span>
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {item.email ? (
                          <a
                            href={`mailto:${item.email}`}
                            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
                          >
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            <span>{item.email}</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 max-w-xs truncate" title={item.productName || ''}>
                        {item.productName || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          {item.status === 'pending' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <Clock className="w-3 h-3" />
                              Pending
                            </span>
                          )}
                          {item.status === 'promoted' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" />
                              Sudah Ditarik
                            </span>
                          )}
                          {item.status === 'ignored' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                              <XCircle className="w-3 h-3" />
                              Diabaikan
                            </span>
                          )}

                          {/* Deteksi Kemiripan dengan Leads Utama */}
                          {isMatched && (
                            <div className="flex flex-col gap-0.5 mt-1 max-w-xs text-left">
                              <div className={`inline-flex items-start gap-1.5 px-2 py-1 rounded-md border text-[11px] ${
                                item.matchedLead?.updateType === 'need_email' || item.matchedLead?.updateType === 'need_phone'
                                  ? 'bg-blue-50 text-blue-900 border-blue-200'
                                  : item.matchedLead?.updateType === 'exact_duplicate'
                                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                                  : 'bg-purple-50 text-purple-900 border-purple-200'
                              }`}>
                                {item.matchedLead?.updateType === 'need_email' ? (
                                  <Mail className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                                ) : item.matchedLead?.updateType === 'need_phone' ? (
                                  <Phone className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                                ) : item.matchedLead?.updateType === 'exact_duplicate' ? (
                                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                                ) : (
                                  <GitMerge className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                                )}
                                <div className="flex flex-col text-left">
                                  <span className="font-semibold leading-tight">
                                    {item.matchedLead?.matchReason}
                                  </span>
                                  <span className="text-[10px] text-slate-500 mt-0.5">
                                    Lead Utama: <b>{item.matchedLead?.brandName}</b> • PIC: <b>{item.matchedLead?.picName || 'Belum ada'}</b>
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {item.status === 'pending' && (
                            <>
                              {isMatched ? (
                                <>
                                  {item.matchedLead?.updateType === 'need_email' ? (
                                    <button
                                      onClick={() => {
                                        setSelectedLeadForMerge(item);
                                        setIsMergeModalOpen(true);
                                      }}
                                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
                                      title="Lengkapi email lead utama dengan data baru dari TikTok"
                                    >
                                      <Mail className="w-3 h-3" />
                                      <span>Update Email</span>
                                    </button>
                                  ) : item.matchedLead?.updateType === 'need_phone' ? (
                                    <button
                                      onClick={() => {
                                        setSelectedLeadForMerge(item);
                                        setIsMergeModalOpen(true);
                                      }}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
                                      title="Lengkapi nomor WA lead utama dengan data baru dari TikTok"
                                    >
                                      <Phone className="w-3 h-3" />
                                      <span>Update No. WA</span>
                                    </button>
                                  ) : item.matchedLead?.updateType === 'exact_duplicate' ? (
                                    <button
                                      onClick={() => {
                                        setSelectedLeadForMerge(item);
                                        setIsMergeModalOpen(true);
                                      }}
                                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold flex items-center gap-1 border border-slate-200 transition-all"
                                      title="Leads sudah 100% ada di database utama"
                                    >
                                      <Check className="w-3 h-3 text-slate-500" />
                                      <span>Sudah Ada</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setSelectedLeadForMerge(item);
                                        setIsMergeModalOpen(true);
                                      }}
                                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
                                      title="Gabungkan nomor kontak ini ke lead yang sudah ada"
                                    >
                                      <GitMerge className="w-3 h-3" />
                                      <span>Gabung Kontak</span>
                                    </button>
                                  )}
                                </>
                              ) : (
                                <button
                                  onClick={() => {
                                    setSelectedIds(new Set([item.id]));
                                    if (item.category) setSelectedCategory(item.category);
                                    setIsPromoteModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
                                  title="Tarik ke Leads Utama"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  <span>Tarik Baru</span>
                                </button>
                              )}
                            </>
                          )}

                          <button
                            onClick={() => handleDeleteSingle(item.id, item.brandName)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                            title="Hapus lead ini dari penampungan"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Tarik Sebagai Lead Baru */}
      {isPromoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Tarik ke Leads Utama ({selectedIds.size} Brand)
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Data akan resmi dibuat sebagai data baru di tabel database Leads utama dan pipeline sales.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Tugaskan ke PIC Sales
                </label>
                <select
                  value={selectedPic}
                  onChange={(e) => setSelectedPic(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Kategori Industri
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {availableCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Produk yang Ditawarkan
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['TNT', 'MCN', 'HYPE'].map((prod) => (
                    <button
                      key={prod}
                      type="button"
                      onClick={() => setSelectedProduct(prod)}
                      className={`py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all ${
                        selectedProduct === prod
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {prod}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsPromoteModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handlePromoteConfirm}
                disabled={isSubmitting}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                {isSubmitting ? 'Memproses...' : 'Konfirmasi & Tarik Baru'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Gabungkan / Update Kontak */}
      {isMergeModalOpen && selectedLeadForMerge && selectedLeadForMerge.matchedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95">
            <div>
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border mb-2 ${
                selectedLeadForMerge.matchedLead.updateType === 'need_email' || selectedLeadForMerge.matchedLead.updateType === 'need_phone'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : selectedLeadForMerge.matchedLead.updateType === 'exact_duplicate'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-purple-50 text-purple-700 border-purple-200'
              }`}>
                {selectedLeadForMerge.matchedLead.updateType === 'need_email' ? (
                  <>
                    <Mail className="w-3.5 h-3.5" />
                    <span>Lengkapi Email Lead</span>
                  </>
                ) : selectedLeadForMerge.matchedLead.updateType === 'need_phone' ? (
                  <>
                    <Phone className="w-3.5 h-3.5" />
                    <span>Lengkapi No. WA Lead</span>
                  </>
                ) : selectedLeadForMerge.matchedLead.updateType === 'exact_duplicate' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Data Sudah Ada di CRM</span>
                  </>
                ) : (
                  <>
                    <GitMerge className="w-3.5 h-3.5" />
                    <span>Gabungkan Kontak Tambahan</span>
                  </>
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                {selectedLeadForMerge.matchedLead.updateType === 'need_email'
                  ? 'Update Email ke Lead Utama'
                  : selectedLeadForMerge.matchedLead.updateType === 'need_phone'
                  ? 'Update No. WA ke Lead Utama'
                  : selectedLeadForMerge.matchedLead.updateType === 'exact_duplicate'
                  ? 'Sinkronisasi Riwayat Lead Utama'
                  : 'Perbarui Kontak Lead yang Sudah Ada'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Data kontak dan email dari TikTok Shop ini akan disinkronkan ke lead yang sudah ada tanpa menghapus data kontak yang lama.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-2.5 text-xs">
              <div className="flex justify-between items-start pb-2 border-b border-slate-200">
                <span className="font-semibold text-slate-500 shrink-0">Status Sistem:</span>
                <span className="font-bold text-slate-800 text-right">{selectedLeadForMerge.matchedLead.matchReason}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="font-semibold text-slate-500">Lead Target di CRM:</span>
                <span className="font-bold text-slate-900">{selectedLeadForMerge.matchedLead.brandName}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="font-semibold text-slate-500">PIC yang Memegang:</span>
                <span className="font-bold text-slate-900">{selectedLeadForMerge.matchedLead.picName || 'Belum ada PIC'}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="font-semibold text-slate-500">No. WA di CRM:</span>
                <span className="font-medium text-slate-700">{selectedLeadForMerge.matchedLead.contact || '(Belum ada)'}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="font-semibold text-slate-500">Email di CRM:</span>
                <span className="font-medium text-slate-700">{selectedLeadForMerge.matchedLead.email || '(Belum ada)'}</span>
              </div>
              <div className="flex justify-between items-start text-indigo-900 font-bold bg-indigo-50/70 border border-indigo-100 p-2.5 rounded-lg mt-1">
                <span className="shrink-0">Data Baru (TikTok):</span>
                <div className="text-right">
                  <div>WA: +{selectedLeadForMerge.contact || '-'}</div>
                  {selectedLeadForMerge.email && <div className="text-indigo-700 font-semibold mt-0.5">Email: {selectedLeadForMerge.email}</div>}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500 italic">
              *Catatan riwayat kontak TikTok Shop ini juga akan otomatis dicatat di riwayat catatan (Notes) lead terkait.
            </p>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsMergeModalOpen(false);
                  setSelectedIds(new Set([selectedLeadForMerge.id]));
                  setIsPromoteModalOpen(true);
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline"
              >
                Tetap Buat Sebagai Lead Terpisah
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleMergeConfirm}
                  disabled={isSubmitting}
                  className={`px-5 py-2 text-white rounded-xl text-sm font-bold shadow-md disabled:opacity-50 transition-all ${
                    selectedLeadForMerge.matchedLead.updateType === 'need_email' || selectedLeadForMerge.matchedLead.updateType === 'need_phone'
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                      : 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/20'
                  }`}
                >
                  {isSubmitting
                    ? 'Memproses...'
                    : selectedLeadForMerge.matchedLead.updateType === 'need_email'
                    ? 'Update Email'
                    : selectedLeadForMerge.matchedLead.updateType === 'need_phone'
                    ? 'Update No. WA'
                    : 'Konfirmasi Gabung'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
