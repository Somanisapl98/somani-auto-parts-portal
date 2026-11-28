const API_BASE = 'https://func-sapl-parts-api-dev-h6fsevdbe3gfg7cx.centralindia-01.azurewebsites.net/api';

const HERO_4K_SLIDES = [
  {
    url: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1440&q=75&fm=webp',
    kicker: '27 Years of Excellence • Commercial Vehicles Only'
  },
  {
    url: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=1440&q=75&fm=webp',
    kicker: 'Tata • Cummins • Holset • JOST • RSB • SKF • DRiV • Uno Minda'
  },
  {
    url: 'https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?auto=format&fit=crop&w=1440&q=75&fm=webp',
    kicker: 'Raipur HQ & 10 Branches • Parts, Oils & Illiquid Stock'
  }
];

let currentHeroIdx = 0;
let activeHeroLayer = 'A';

let products = [];
let hierarchy = {};
let cart = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem('sapl_parts_cart') || '{}');
    const clean = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
      const key = String(k || '').trim().toUpperCase();
      const qty = parseInt(v, 10) || 0;
      if (key && key !== 'UNDEFINED' && key !== 'NULL' && qty > 0) {
        clean[key] = qty;
      }
    });
    return clean;
  } catch (e) {
    return {};
  }
})();
let activePG = 'ALL';
let activeHierarchy = 'ALL';
let catalogLayout = 'grid';
let page = 1;
const PAGE_SIZE = 24;

let authState = {
  token: sessionStorage.getItem('sapl_token') || '',
  role: sessionStorage.getItem('sapl_role') || '',
  user: sessionStorage.getItem('sapl_user') || '',
  businessName: sessionStorage.getItem('sapl_bname') || '',
  dealerLoginMode: 'password'
};

// Primary camera photo state (stores both auto-enhanced and original dataUrls for Before/After comparison)
let pendingAdminBlob = null;
let showingEnhancedPreview = true;

// Multi-angle gallery state for the currently edited/created product
// Array of { blobName, url, thumbUrl, label }
let adminGalleryItems = [];
let clearAllPhotosFlag = false;

// Product Detail Modal state
let detailProduct = null;
let detailAngles = [];
let detailAngleIndex = 0;
let detailQty = 1;

let parsedExcelParts = [];

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const money = n =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(n || 0));

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showToast(msg) {
  const box = $('#toastBox');
  $('#toastMsg').textContent = msg;
  box.classList.remove('hidden');
  box.classList.add('flex');
  setTimeout(() => {
    box.classList.add('hidden');
    box.classList.remove('flex');
  }, 3600);
}

// ---------------------------------------------------------------------------
// 4K Hero Banner Engine
// ---------------------------------------------------------------------------
function setHeroSlide(idx) {
  currentHeroIdx = idx % HERO_4K_SLIDES.length;
  const slide = HERO_4K_SLIDES[currentHeroIdx];
  const layerA = $('#heroBgLayerA');
  const layerB = $('#heroBgLayerB');
  const kicker = $('#heroKicker');

  if (activeHeroLayer === 'A') {
    layerB.style.backgroundImage = `url('${slide.url}')`;
    layerB.style.opacity = '1';
    layerB.style.transform = 'scale(1)';
    layerA.style.opacity = '0';
    layerA.style.transform = 'scale(1.04)';
    activeHeroLayer = 'B';
  } else {
    layerA.style.backgroundImage = `url('${slide.url}')`;
    layerA.style.opacity = '1';
    layerA.style.transform = 'scale(1)';
    layerB.style.opacity = '0';
    layerB.style.transform = 'scale(1.04)';
    activeHeroLayer = 'A';
  }

  if (kicker) kicker.textContent = slide.kicker;

  const dots = $('#heroDots');
  if (dots) {
    dots.innerHTML = HERO_4K_SLIDES.map(
      (_, i) => `
      <button type="button" onclick="setHeroSlide(${i})" aria-label="Slide ${i + 1}"
        class="h-1.5 rounded-full transition-all cursor-pointer ${
          i === currentHeroIdx ? 'w-7 bg-brand-orange' : 'w-2 bg-slate-400/60 hover:bg-slate-700'
        }">
      </button>`
    ).join('');
  }
}

function initHeroEngine() {
  HERO_4K_SLIDES.forEach(s => {
    const img = new Image();
    img.src = s.url;
  });
  const layerA = $('#heroBgLayerA');
  if (layerA) {
    layerA.style.backgroundImage = `url('${HERO_4K_SLIDES[0].url}')`;
    setHeroSlide(0);
    setInterval(() => setHeroSlide(currentHeroIdx + 1), 6500);
  }
}

// ---------------------------------------------------------------------------
// App Initialization & Live API Connection
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initHeroEngine();
  updateAuthUI();
  updateCart();
  renderAdminGalleryGrid();
  bindEvents();
  checkApiHealth();
  loadCatalogueData();
});

async function checkApiHealth() {
  const badge = $('#apiBadge');
  if (!badge) return;
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    if (res.ok && data.ok) {
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span><span class="text-emerald-700 font-semibold">Live Store Online</span>`;
      badge.className = 'hidden lg:flex items-center gap-1.5 text-xs bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full';
      return;
    }
  } catch (e) {}
  badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span><span class="text-amber-700 font-semibold">Catalogue Mode</span>`;
}

async function loadCatalogueData() {
  const CACHE_KEY = 'sapl_catalog_cache_v1';
  const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const isRefresh = Array.isArray(products) && products.length > 0;
  let renderedEarly = false;

  function applyCatalogSnapshot(apiParts, inactiveSet, fallbackParts, fallbackHierarchy) {
  const byPartNo = new Map();
    apiParts.forEach(p => {
      const key = String(p.partNo).toUpperCase();
      if (!inactiveSet.has(key)) {
        byPartNo.set(key, { ...p, isLive: true });
      }
    });
    fallbackParts.forEach(p => {
      const key = String(p.partNo).toUpperCase();
      if (!inactiveSet.has(key) && !byPartNo.has(key)) {
        byPartNo.set(key, { ...p, description: p.description || '', gallery: p.gallery || [], isLive: false });
      }
    });

    products = Array.from(byPartNo.values());

    const mergedHier = {};
    Object.entries(fallbackHierarchy).forEach(([pg, list]) => {
      mergedHier[pg] = new Set(list);
    });
    products.forEach(p => {
      const pg = p.pg || 'PG1';
      if (!mergedHier[pg]) mergedHier[pg] = new Set();
      if (p.hierarchy) mergedHier[pg].add(p.hierarchy);
    });

    hierarchy = {};
    Object.entries(mergedHier).forEach(([pg, setObj]) => {
      hierarchy[pg] = Array.from(setObj).sort();
    });

    $('#kpiTotal').textContent = products.length.toLocaleString('en-IN');
    $('#kpiSourceText').textContent =
      apiParts.length > 0
        ? `${apiParts.length} live DB items + ${products.length - apiParts.length} catalogue`
        : 'Verified OEM commercial parts';

    buildPG();
    updateHierarchy();
    renderCatalog();
    renderAdminPartsTable();
  }

  // 1. Instant <30ms paint from localStorage on initial visit (eliminates cold-start blank screen)
  if (!isRefresh) {
    try {
      const rawCache = localStorage.getItem(CACHE_KEY);
      if (rawCache) {
        const cached = JSON.parse(rawCache);
        if (cached && (Date.now() - Number(cached.ts || 0)) < CACHE_MAX_AGE_MS) {
          const cApi = Array.isArray(cached.apiParts) ? cached.apiParts : [];
          const cInact = new Set(Array.isArray(cached.inactiveList) ? cached.inactiveList : []);
          const cFall = Array.isArray(cached.fallbackParts) ? cached.fallbackParts : [];
          const cHier = cached.fallbackHierarchy && typeof cached.fallbackHierarchy === 'object' ? cached.fallbackHierarchy : {};
          if (cApi.length > 0 || cFall.length > 0) {
            applyCatalogSnapshot(cApi, cInact, cFall, cHier);
            renderedEarly = true;
          }
        }
      }
    } catch (_) {}
  }

  let apiParts = [];
  let inactiveSet = new Set();
  let fallbackParts = [];
  let fallbackHierarchy = {};
  let apiDone = false;

  // 2. Fetch live API + static catalogue files in PARALLEL (removes sequential waterfall)
  const apiFetchOpts = isRefresh ? { cache: 'no-store' } : undefined;
  const apiPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/parts`, apiFetchOpts);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.parts)) {
          apiParts = data.parts;
        }
        if (Array.isArray(data.inactivePartNos)) {
          inactiveSet = new Set(data.inactivePartNos.map(x => String(x).toUpperCase()));
        }
      }
    } catch (err) {}
    apiDone = true;
  })();

  const staticPromise = (async () => {
    try {
      const [pRes, hRes] = await Promise.all([
        fetch('data/products.json').then(r => (r.ok ? r.json() : [])),
        fetch('data/product-hierarchy.json').then(r => (r.ok ? r.json() : {}))
      ]);
      fallbackParts = Array.isArray(pRes) ? pRes : [];
      fallbackHierarchy = hRes || {};
      // First-ever visitor progressive render if Azure Function is cold-starting
      if (!isRefresh && !renderedEarly && !apiDone && fallbackParts.length > 0) {
        applyCatalogSnapshot([], new Set(), fallbackParts, fallbackHierarchy);
        renderedEarly = true;
      }
    } catch (e) {}
  })();

  await Promise.all([apiPromise, staticPromise]);

  // 3. Final render with fresh live DB data + update localStorage cache
  applyCatalogSnapshot(apiParts, inactiveSet, fallbackParts, fallbackHierarchy);

  if (apiParts.length > 0 || fallbackParts.length > 0) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          ts: Date.now(),
          apiParts,
          inactiveList: Array.from(inactiveSet),
          fallbackParts,
          fallbackHierarchy
        })
      );
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Storefront Filtering & E-Commerce Product Cards
// ---------------------------------------------------------------------------
function buildPG() {
  const groups = [
    { id: 'ALL', label: 'All Parts' },
    { id: 'PG1', label: 'PG1 • Engine' },
    { id: 'PG2', label: 'PG2 • Brake & Clutch' },
    { id: 'PG3', label: 'PG3 • Axle & Bearing' },
    { id: 'PG4', label: 'PG4 • Electrical' },
    { id: 'PG5', label: 'PG5 • Body & Rubber' },
    { id: 'PG6', label: 'PG6 • Oils & Lubes' }
  ];

  $('#pgFilters').innerHTML = groups
    .map(g => {
      const active = g.id === activePG;
      return `<button type="button" data-pg="${g.id}" class="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition cursor-pointer ${
        active
          ? 'bg-brand-blue text-white shadow-2xs'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }">${g.label}</button>`;
    })
    .join('');

  $$('#pgFilters button').forEach(btn => {
    btn.onclick = () => {
      activePG = btn.dataset.pg;
      activeHierarchy = 'ALL';
      page = 1;
      $('#kpiPgLabel').textContent = activePG === 'ALL' ? 'PG1–PG6' : activePG;
      buildPG();
      updateHierarchy();
      renderCatalog();
    };
  });
}

function updateHierarchy() {
  const list =
    activePG === 'ALL'
      ? [...new Set(Object.values(hierarchy).flat())].sort()
      : hierarchy[activePG] || [];

  $('#hierarchyFilter').innerHTML =
    '<option value="ALL">All Product Hierarchies</option>' +
    list.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');

  $('#hierarchyFilter').value = activeHierarchy;
  $('#kpiHierText').textContent = `${list.length} product categories`;

  const dl = $('#hierarchyDatalist');
  if (dl) {
    dl.innerHTML = [...new Set(Object.values(hierarchy).flat())]
      .sort()
      .map(x => `<option value="${esc(x)}">`)
      .join('');
  }
}

function filteredProducts() {
  const q = $('#searchInput').value.trim().toLowerCase();
  return products.filter(
    p =>
      (activePG === 'ALL' || p.pg === activePG) &&
      (activeHierarchy === 'ALL' || p.hierarchy === activeHierarchy) &&
      (!q ||
        `${p.partNo} ${p.name} ${p.description || ''} ${p.hierarchy} ${p.pg} ${p.brand || ''}`
          .toLowerCase()
          .includes(q))
  );
}

function fallbackImageFor(p) {
  const n = String(p.name || '').toLowerCase();
  const h = String(p.hierarchy || '').toLowerCase();
  if (n.includes('bearing') || h.includes('bearing')) return 'assets/images/products/bearing.jpg';
  if (n.includes('brake') || h.includes('br&') || h.includes('brake')) return 'assets/images/products/brake-disc.jpg';
  if (n.includes('gasket') || n.includes('seal')) return 'assets/images/products/brake-system.jpg';
  if (n.includes('rubber') || n.includes('bush') || n.includes('hose')) return 'assets/images/products/rubber-parts.jpg';
  if (n.includes('clutch')) return 'assets/images/products/brake-pad.jpg';
  return 'assets/images/products/precision-parts.jpg';
}

function imageFor(p) {
  if (p.thumbnailUrl) return p.thumbnailUrl;
  if (p.imageUrl) return p.imageUrl;
  if (Array.isArray(p.gallery) && p.gallery.length > 0) {
    return p.gallery[0].thumbUrl || p.gallery[0].url;
  }
  return fallbackImageFor(p);
}

function priceBlockHtml(p) {
  const mrp = Number(p.mrp || 0);
  const dealer = Number(p.dealerPrice || mrp);

  if (authState.role === 'dealer' && authState.token && dealer > 0) {
    return `
      <div>
        <span class="text-[10px] font-bold uppercase text-emerald-600 block">Dealer Net</span>
        <span class="text-sm sm:text-base font-extrabold text-slate-900 font-mono">${money(dealer)}</span>
        ${mrp > dealer ? `<span class="text-[10px] text-slate-400 line-through ml-1">${money(mrp)}</span>` : ''}
      </div>
    `;
  }
  if (mrp > 0) {
    return `
      <div>
        <span class="text-[10px] font-semibold uppercase text-slate-400 block">MRP</span>
        <span class="text-sm sm:text-base font-extrabold text-slate-900 font-mono">${money(mrp)}</span>
      </div>
    `;
  }
  return `
    <div>
      <span class="text-[10px] font-semibold uppercase text-slate-400 block">Commercial</span>
      <span class="text-xs sm:text-sm font-extrabold text-brand-blue">Quote on Request</span>
    </div>
  `;
}

function setCatalogLayout(mode) {
  catalogLayout = mode;
  $('#btnViewGrid').className =
    mode === 'grid'
      ? 'px-2.5 py-1 rounded-md text-xs font-semibold bg-brand-blue text-white cursor-pointer'
      : 'px-2.5 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer';
  $('#btnViewList').className =
    mode === 'list'
      ? 'px-2.5 py-1 rounded-md text-xs font-semibold bg-brand-blue text-white cursor-pointer'
      : 'px-2.5 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer';
  renderCatalog();
}

function renderCatalog() {
  const list = filteredProducts();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const shown = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const summaryText = `${list.length.toLocaleString('en-IN')} parts available${
    activePG !== 'ALL' ? ` in ${activePG}` : ''
  }`;
  $('#catalogSummary').textContent = summaryText;
  $('#mobileResultSummary').textContent = summaryText;

  const gridEl = $('#productGrid');
  const tableWrap = $('#productTableWrap');

  if (catalogLayout === 'grid') {
    gridEl.classList.remove('hidden');
    tableWrap.classList.add('hidden');

    gridEl.innerHTML = shown.length
      ? shown
          .map(p => {
            const fallback = fallbackImageFor(p);
            const galleryCount = Array.isArray(p.gallery) ? p.gallery.length : 0;
            const hasPhoto = Boolean(p.thumbnailUrl || p.imageUrl || galleryCount > 0);
            const partKey = String(p.partNo || '').trim().toUpperCase();
            const safeKey = esc(partKey);
            const inCartQty = cart[partKey] || 0;
            return `
              <article class="white-card rounded-2xl overflow-hidden flex flex-col shadow-2xs">
                <div onclick="openProductDetail('${safeKey}')" class="relative aspect-[4/3] bg-slate-100 border-b border-slate-100 overflow-hidden cursor-pointer group">
                  <img loading="lazy" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" alt="${esc(p.name)}" class="w-full h-full object-cover" />
                  <span class="absolute top-2 left-2 bg-slate-900/85 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">${esc(p.pg)}</span>
                  <button type="button" onclick="event.stopPropagation();openProductZoomByPartNo('${safeKey}')" aria-label="Zoom image" title="Zoom image" class="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/95 hover:bg-brand-blue text-slate-700 hover:text-white border border-slate-200 shadow-xs flex items-center justify-center text-xs transition cursor-zoom-in">
                    &#128269;
                  </button>
                  ${
                    galleryCount > 1
                      ? `<span class="absolute top-2 right-2 bg-brand-blue/95 text-white text-[9px] font-bold px-2 py-0.5 rounded-md shadow-2xs">${galleryCount} VIEWS</span>`
                      : hasPhoto
                      ? '<span class="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">ENHANCED</span>'
                      : ''
                  }
                </div>

                <div class="p-2.5 sm:p-4 flex flex-col flex-1">
                  <div class="flex items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span class="truncate max-w-[45%]">${esc(p.brand || 'OEM')}</span>
                    <span class="truncate text-brand-blue text-right">${esc(p.hierarchy)}</span>
                  </div>

                  <h3 onclick="openProductDetail('${safeKey}')" class="text-xs sm:text-sm font-bold text-slate-900 hover:text-brand-blue mt-1 line-clamp-2 leading-snug cursor-pointer">
                    ${esc(p.name)}
                  </h3>

                  <div class="mt-2">
                    <button type="button" onclick="event.stopPropagation();openProductDetail('${safeKey}')" title="Open product details &amp; options" class="inline-flex items-center gap-1 font-mono text-[10px] sm:text-[11px] font-bold text-brand-orange hover:bg-brand-orange hover:text-white bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md max-w-full truncate transition cursor-pointer">
                      <span>${safeKey}</span>
                      <span class="text-[9px] opacity-75">&rsaquo;</span>
                    </button>
                  </div>

                  <div class="mt-auto pt-2.5 border-t border-slate-100 space-y-2">
                    <div class="flex items-center justify-between gap-1">
                      ${priceBlockHtml(p)}
                      ${
                        inCartQty > 0
                          ? `<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md shrink-0">Added</span>`
                          : ''
                      }
                    </div>

                    <div class="flex items-center justify-between gap-1.5">
                      <button type="button" onclick="event.stopPropagation();openProductDetail('${safeKey}')" class="flex-1 min-w-0 py-1.5 px-2 rounded-lg border border-brand-blue/30 bg-blue-50/70 hover:bg-brand-blue text-brand-blue hover:text-white font-bold text-[11px] transition truncate cursor-pointer">
                        View Details
                      </button>

                      <div onclick="event.stopPropagation()" class="inline-flex items-center border ${
                        inCartQty > 0 ? 'border-brand-orange bg-orange-50/60' : 'border-slate-300 bg-slate-50'
                      } rounded-lg overflow-hidden shrink-0">
                        <button type="button" aria-label="Decrease quantity" onclick="event.stopPropagation();changeQty('${safeKey}', -1)" class="w-7 h-7 flex items-center justify-center font-extrabold text-sm text-slate-700 hover:bg-slate-200 active:bg-slate-300 transition cursor-pointer">
                          &minus;
                        </button>
                        <span class="w-6 text-center font-mono text-xs font-extrabold ${
                          inCartQty > 0 ? 'text-brand-orange' : 'text-slate-700'
                        }">${inCartQty}</span>
                        <button type="button" aria-label="Increase quantity" onclick="event.stopPropagation();changeQty('${safeKey}', 1)" class="w-7 h-7 flex items-center justify-center font-extrabold text-sm bg-brand-blue text-white hover:bg-brand-blueDark active:scale-95 transition cursor-pointer">
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            `;
          })
          .join('')
      : `<div class="col-span-full bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <p class="text-base font-bold text-slate-800">No matching parts found</p>
          <p class="text-xs text-slate-500 mt-1">Try searching by another part number, description, or reset filters.</p>
        </div>`;
  } else {
    gridEl.classList.add('hidden');
    tableWrap.classList.remove('hidden');

    $('#productTableBody').innerHTML = shown.length
      ? shown
          .map(p => {
            const fallback = fallbackImageFor(p);
            const partKey = String(p.partNo || '').trim().toUpperCase();
            const safeKey = esc(partKey);
            const inCartQty = cart[partKey] || 0;
            return `
              <tr class="hover:bg-slate-50">
                <td onclick="openProductDetail('${safeKey}')" class="py-2.5 px-4 cursor-pointer">
                  <div class="flex items-center gap-2.5">
                    <img loading="lazy" decoding="async" onclick="openProductZoomByPartNo('${safeKey}')" title="Click to zoom &amp; inspect" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" class="w-10 h-10 rounded-lg object-cover border border-slate-200 hover:border-brand-blue shrink-0 cursor-zoom-in" alt="" />
                    <div>
                      <span class="font-bold text-slate-900 hover:text-brand-blue text-xs sm:text-sm block">${esc(p.name)}</span>
                      <span class="text-[10px] text-brand-blue font-semibold">View Details</span>
                    </div>
                  </div>
                </td>
                <td onclick="openProductDetail('${safeKey}')" class="py-2.5 px-4 cursor-pointer"><span class="font-mono text-xs font-bold text-brand-orange hover:bg-brand-orange hover:text-white bg-orange-50 border border-orange-200 px-2 py-0.5 rounded transition">${safeKey} &rsaquo;</span></td>
                <td class="py-2.5 px-4 text-xs text-slate-600">${esc(p.pg)} &bull; ${esc(p.hierarchy)}</td>
                <td class="py-2.5 px-4 text-xs font-semibold text-slate-700">${esc(p.brand || 'OEM')}</td>
                <td class="py-2.5 px-4">${priceBlockHtml(p)}</td>
                <td class="py-2.5 px-4 text-right whitespace-nowrap">
                  <div class="inline-flex items-center gap-2">
                    <button type="button" onclick="openProductDetail('${safeKey}')" class="px-2.5 py-1.5 rounded-lg border border-brand-blue/30 bg-blue-50 text-brand-blue hover:bg-brand-blue hover:text-white font-bold text-xs cursor-pointer">
                      View Details
                    </button>
                    <div class="inline-flex items-center border border-slate-300 rounded-lg bg-slate-50 overflow-hidden">
                      <button type="button" onclick="changeQty('${safeKey}', -1)" class="w-7 h-7 font-extrabold text-slate-700 hover:bg-slate-200 cursor-pointer">&minus;</button>
                      <span class="w-6 text-center font-mono text-xs font-bold">${inCartQty}</span>
                      <button type="button" onclick="changeQty('${safeKey}', 1)" class="w-7 h-7 font-extrabold bg-brand-blue text-white hover:bg-brand-blueDark cursor-pointer">+</button>
                    </div>
                  </div>
                </td>
              </tr>
            `;
          })
          .join('')
      : `<tr><td colspan="6" class="py-10 text-center text-slate-500">No matching parts found.</td></tr>`;
  }

  $('#pagination').innerHTML =
    pages <= 1
      ? ''
      : `<button ${page === 1 ? 'disabled' : ''} onclick="goPage(${page - 1})" class="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer">&larr; Prev</button>
         <span class="text-xs font-semibold text-slate-600">Page ${page} of ${pages}</span>
         <button ${page === pages ? 'disabled' : ''} onclick="goPage(${page + 1})" class="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer">Next &rarr;</button>`;

  renderSuggestions(false);
}

// ---------------------------------------------------------------------------
// STOREFRONT PRODUCT DETAIL MODAL (Multi-Angle Photos + Description + Order)
// ---------------------------------------------------------------------------
function openProductDetail(partNoKey) {
  const p = products.find(x => String(x.partNo).toUpperCase() === String(partNoKey).toUpperCase());
  if (!p) return;

  detailProduct = p;
  detailQty = 1;
  detailAngleIndex = 0;

  // Build angles list from gallery, primary image, or fallback
  const angles = [];
  if (Array.isArray(p.gallery) && p.gallery.length > 0) {
    p.gallery.forEach((g, i) => {
      if (g.url || g.thumbUrl) {
        angles.push({
          url: g.url || g.thumbUrl,
          thumbUrl: g.thumbUrl || g.url,
          label: g.label || (i === 0 ? 'Front / Primary' : `Angle ${i + 1}`),
          enhanced: true
        });
      }
    });
  }
  if (!angles.length && (p.imageUrl || p.thumbnailUrl)) {
    angles.push({
      url: p.imageUrl || p.thumbnailUrl,
      thumbUrl: p.thumbnailUrl || p.imageUrl,
      label: 'Front / Primary',
      enhanced: true
    });
  }
  if (!angles.length) {
    const fb = fallbackImageFor(p);
    angles.push({
      url: fb,
      thumbUrl: fb,
      label: 'Catalogue Reference',
      enhanced: false
    });
  }

  detailAngles = angles;

  $('#pdBrand').textContent = p.brand || 'TATA / OEM';
  $('#pdCategory').textContent = `${p.pg} • ${p.hierarchy || 'General'}`;
  if ($('#pdLocationBadge')) {
    $('#pdLocationBadge').textContent = p.location || 'Location 1';
  }
  $('#pdTitle').textContent = p.name;
  $('#pdPartNo').textContent = p.partNo;
  $('#pdQtyVal').textContent = '1';

  const stock = Number(p.stockQty || 0);
  const uom = p.uom || 'NOS';
  const stockBadge = $('#pdStockBadge');
  if (stock > 0) {
    stockBadge.textContent = `In Stock: ${stock} ${uom}`;
    stockBadge.className = 'text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md';
  } else {
    stockBadge.textContent = `Available on Order (${uom})`;
    stockBadge.className = 'text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md';
  }

  const descText =
    (p.description && p.description.trim()) ||
    `Genuine ${p.brand || 'OEM'} commercial vehicle spare part (${p.name}) under ${p.pg} — ${p.hierarchy}. Supplied by Somani Auto Pvt. Ltd., Raipur. Unit: ${uom}.`;
  $('#pdDescription').textContent = descText;

  // Pricing box
  const mrp = Number(p.mrp || 0);
  const dealer = Number(p.dealerPrice || mrp);
  if (authState.role === 'dealer' && authState.token && dealer > 0) {
    $('#pdPriceBox').innerHTML = `
      <div>
        <span class="text-[11px] font-bold uppercase text-emerald-700 block">Dealer Net Price</span>
        <span class="text-xl sm:text-2xl font-extrabold text-slate-900 font-mono">${money(dealer)}</span>
        <span class="text-xs text-slate-500 ml-1">/ ${esc(uom)}</span>
      </div>
      ${
        mrp > dealer
          ? `<div class="text-right">
               <span class="text-[10px] uppercase text-slate-400 block">Public MRP</span>
               <span class="text-sm text-slate-400 line-through font-mono">${money(mrp)}</span>
             </div>`
          : ''
      }
    `;
  } else if (mrp > 0) {
    $('#pdPriceBox').innerHTML = `
      <div>
        <span class="text-[11px] font-bold uppercase text-slate-500 block">Maximum Retail Price (MRP)</span>
        <span class="text-xl sm:text-2xl font-extrabold text-slate-900 font-mono">${money(mrp)}</span>
        <span class="text-xs text-slate-500 ml-1">/ ${esc(uom)}</span>
      </div>
      <button type="button" onclick="closeAllOverlays();openDealerAuth('login')" class="text-xs font-bold text-brand-blue hover:underline cursor-pointer">
        Dealer Login for Net Price &rarr;
      </button>
    `;
  } else {
    $('#pdPriceBox').innerHTML = `
      <div>
        <span class="text-[11px] font-bold uppercase text-slate-500 block">Commercial Pricing</span>
        <span class="text-base font-extrabold text-brand-blue">Quote on Request</span>
      </div>
      <span class="text-xs text-slate-500">Unit: ${esc(uom)}</span>
    `;
  }

  // Show Admin quick-edit button if logged in as Admin
  const adminEditBtn = $('#pdAdminEditBtn');
  if (authState.role === 'admin' && authState.token) {
    adminEditBtn.classList.remove('hidden');
  } else {
    adminEditBtn.classList.add('hidden');
  }

  renderProductDetailAngle();

  $('#overlay').classList.remove('hidden');
  $('#productDetailModal').classList.remove('hidden');
  pushOverlayHistoryState('product-details');
  $('#productDetailModal').classList.add('flex');
}

function renderProductDetailAngle() {
  if (!detailAngles.length) return;
  const current = detailAngles[detailAngleIndex] || detailAngles[0];
  const fallback = detailProduct ? fallbackImageFor(detailProduct) : 'assets/images/products/precision-parts.jpg';

  const mainImg = $('#pdMainImage');
  mainImg.onerror = () => {
    mainImg.onerror = null;
    mainImg.src = fallback;
  };
  mainImg.src = current.url;

  $('#pdAngleBadge').textContent = current.label || `Angle ${detailAngleIndex + 1}`;
  $('#pdAngleCounter').textContent = `${detailAngleIndex + 1} / ${detailAngles.length}`;
  $('#pdEnhanceBadge').classList.toggle('hidden', !current.enhanced);

  const showArrows = detailAngles.length > 1;
  $('#pdPrevBtn').classList.toggle('hidden', !showArrows);
  $('#pdNextBtn').classList.toggle('hidden', !showArrows);

  $('#pdThumbs').innerHTML = detailAngles
    .map(
      (a, idx) => `
      <button type="button" onclick="selectProductDetailAngle(${idx})"
        class="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition cursor-pointer ${
          idx === detailAngleIndex ? 'border-brand-orange ring-2 ring-orange-500/20' : 'border-slate-200 opacity-75 hover:opacity-100'
        }">
        <img loading="lazy" decoding="async" src="${esc(a.thumbUrl || a.url)}" onerror="this.onerror=null;this.src='${fallback}'" class="w-full h-full object-cover" alt="${esc(a.label)}" />
        <span class="absolute bottom-0 inset-x-0 bg-slate-900/75 text-white text-[9px] font-semibold px-1 truncate">${esc(a.label)}</span>
      </button>`
    )
    .join('');
}

function selectProductDetailAngle(idx) {
  if (idx < 0 || idx >= detailAngles.length) return;
  detailAngleIndex = idx;
  renderProductDetailAngle();
}

function stepProductDetailAngle(delta) {
  if (!detailAngles.length) return;
  detailAngleIndex = (detailAngleIndex + delta + detailAngles.length) % detailAngles.length;
  renderProductDetailAngle();
}

function adjustProductDetailQty(delta) {
  detailQty = Math.max(1, detailQty + delta);
  $('#pdQtyVal').textContent = String(detailQty);
}

function addProductDetailToCart() {
  if (!detailProduct) return;
  const key = String(detailProduct.partNo || '').trim().toUpperCase();
  if (!key) return;
  cart[key] = (cart[key] || 0) + detailQty;
  saveCart();
  updateCart();
  renderCatalog();
  closeAllOverlays();
  showToast(`Added ${detailQty} × ${key} to Enquiry Basket`);
}

function editFromProductDetail() {
  if (!detailProduct) return;
  const partNo = detailProduct.partNo;
  closeAllOverlays();
  switchView('admin');
  startEditProduct(partNo);
}

function goPage(n) {
  page = n;
  renderCatalog();
  $('#catalogSection').scrollIntoView({ behavior: 'smooth' });
}

function renderSuggestions(show = true) {
  const box = $('#suggestions');
  const q = $('#searchInput').value.trim().toLowerCase();
  $('#clearSearchBtn').classList.toggle('hidden', q.length === 0);

  if (!show || q.length < 2) {
    box.classList.add('hidden');
    return;
  }

  const matches = products
    .filter(p => `${p.partNo} ${p.name} ${p.brand || ''}`.toLowerCase().includes(q))
    .slice(0, 8);

  box.innerHTML = matches.length
    ? matches
        .map(
          p => `
        <button type="button" data-partno="${esc(p.partNo)}" class="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 flex items-center justify-between gap-2 cursor-pointer">
          <div class="min-w-0">
            <span class="font-mono text-xs font-bold text-brand-orange mr-2">${esc(p.partNo)}</span>
            <span class="text-xs sm:text-sm font-semibold text-slate-800">${esc(p.name)}</span>
          </div>
          <span class="text-[10px] font-bold text-slate-400 shrink-0">${esc(p.pg)}</span>
        </button>`
        )
        .join('')
    : `<div class="p-3 text-xs text-slate-500 text-center">No matching parts</div>`;

  box.classList.remove('hidden');
  $$('#suggestions button').forEach(btn => {
    btn.onclick = () => {
      box.classList.add('hidden');
      openProductDetail(btn.dataset.partno);
    };
  });
}

function clearSearch() {
  $('#searchInput').value = '';
  $('#clearSearchBtn').classList.add('hidden');
  page = 1;
  renderCatalog();
}

function resetAllFilters() {
  activePG = 'ALL';
  activeHierarchy = 'ALL';
  $('#searchInput').value = '';
  $('#clearSearchBtn').classList.add('hidden');
  $('#kpiPgLabel').textContent = 'PG1–PG6';
  page = 1;
  buildPG();
  updateHierarchy();
  renderCatalog();
}

// ---------------------------------------------------------------------------
// OTP Request, Dealer Auto-Account Creation, Forgot Password & Login Flows
// ---------------------------------------------------------------------------
function openDealerAuth(tab = 'login') {
  if (authState.token && authState.role === 'dealer') {
    if (confirm(`Signed in as ${authState.user}. Sign out?`)) {
      logoutSession();
    }
    return;
  }
  $('#overlay').classList.remove('hidden');
  $('#dealerModal').classList.remove('hidden');
  pushOverlayHistoryState('dealer-login');
  $('#dealerModal').classList.add('flex');
  switchDealerTab(tab);
}

function switchDealerTab(tab) {
  $('#dealerOtpBanner').classList.add('hidden');
  $('#dealerError').classList.add('hidden');

  $('#dealerFormLogin').classList.toggle('hidden', tab !== 'login');
  $('#dealerFormRegister').classList.toggle('hidden', tab !== 'register');
  if (tab === 'register') {
    $('#dealerRegInputForm').classList.remove('hidden');
    $('#dealerGeneratedCard').classList.add('hidden');
  }
  $('#dealerFormReset').classList.toggle('hidden', tab !== 'reset');

  const titleEl = $('#signInModalTitle');
  const subEl = $('#signInModalSub');
  if (titleEl && subEl) {
    if (tab === 'register') {
      titleEl.textContent = 'Create Account';
      subEl.textContent = 'Quick 1-step Email OTP setup';
    } else if (tab === 'reset') {
      titleEl.textContent = 'Reset Password';
      subEl.textContent = 'Verify via 6-digit Email OTP';
    } else {
      titleEl.textContent = 'Sign In';
      subEl.textContent = 'Enter your Mobile, Email, or User ID to continue';
    }
  }
}

function toggleSignInPasswordVis(show) {
  const inp = $('#dLoginPass');
  if (inp) inp.type = show ? 'text' : 'password';
}

function toggleSimpleOtpLogin() {
  const nextMode = authState.dealerLoginMode === 'password' ? 'otp' : 'password';
  authState.dealerLoginMode = nextMode;
  $('#dLoginPassWrap').classList.toggle('hidden', nextMode !== 'password');
  $('#dLoginOtpWrap').classList.toggle('hidden', nextMode !== 'otp');
  const toggleBtn = $('#dToggleOtpLoginBtn');
  if (toggleBtn) {
    toggleBtn.textContent = nextMode === 'otp' ? 'Login with Password' : 'Login with Email OTP';
  }
}

window.toggleSignInPasswordVis = toggleSignInPasswordVis;
window.toggleSimpleOtpLogin = toggleSimpleOtpLogin;

function setDealerLoginMode(mode) {
  authState.dealerLoginMode = mode;
  $('#dModePass').className =
    mode === 'password'
      ? 'px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-2xs cursor-pointer'
      : 'px-2.5 py-1 rounded-md text-slate-600 cursor-pointer';
  $('#dModeOtp').className =
    mode === 'otp'
      ? 'px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-2xs cursor-pointer'
      : 'px-2.5 py-1 rounded-md text-slate-600 cursor-pointer';

  $('#dLoginPassWrap').classList.toggle('hidden', mode !== 'password');
  $('#dLoginOtpWrap').classList.toggle('hidden', mode !== 'otp');
  $('#dLoginSendOtpBtn').classList.toggle('hidden', mode !== 'otp');
}

function openAdminPortal() {
  if (authState.role === 'admin' && authState.token) {
    switchView('admin');
    return;
  }
  $('#overlay').classList.remove('hidden');
  $('#adminModal').classList.remove('hidden');
  pushOverlayHistoryState('admin-login');
  $('#adminModal').classList.add('flex');
  switchAdminAuthTab('login');
}

function switchAdminAuthTab(tab) {
  $('#adminOtpBanner').classList.add('hidden');
  $('#adminAuthError').classList.add('hidden');

  $('#adminFormLogin').classList.toggle('hidden', tab !== 'login');
  $('#adminFormReset').classList.toggle('hidden', tab !== 'reset');

  const active = 'py-2 rounded-lg bg-white text-slate-900 shadow-2xs cursor-pointer';
  const idle = 'py-2 rounded-lg text-slate-600 hover:text-slate-900 cursor-pointer';
  $('#aTabLogin').className = tab === 'login' ? active : idle;
  $('#aTabReset').className = tab === 'reset' ? active : idle;
}

async function requestOtpFlow(purpose, inputSelector, bannerId, errorId) {
  const contact = $(inputSelector).value.trim();
  const banner = $(`#${bannerId}`);
  const errBox = $(`#${errorId}`);
  banner.classList.add('hidden');
  errBox.classList.add('hidden');

  if (!contact) {
    errBox.textContent = 'Please enter your Email address or User ID first.';
    errBox.classList.remove('hidden');
    return;
  }

  banner.textContent = 'Sending 6-digit OTP to email...';
  banner.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose, contact })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Could not send OTP');
    }

    if (data.devOtp) {
      banner.innerHTML = `OTP sent to <strong>${esc(data.maskedEmail)}</strong> (valid 10 mins).<br><span class="font-mono font-bold text-brand-orange">Email OTP (Preview): ${esc(data.devOtp)}</span>`;
    } else {
      banner.innerHTML = `6-digit OTP sent to <strong>${esc(data.maskedEmail)}</strong>. Check your inbox (valid 10 minutes).`;
    }
  } catch (err) {
    banner.classList.add('hidden');
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
}

let lastGeneratedCreds = { id: '', pass: '' };

async function submitDealerRegister(e) {
  e.preventDefault();
  const errBox = $('#dealerError');
  const btn = $('#dRegSubmitBtn');
  errBox.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Creating Account...';

  try {
    const res = await fetch(`${API_BASE}/auth/dealer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('#dRegContact').value.trim(),
        otp: $('#dRegOtp').value.trim(),
        mobile: $('#dRegMobile').value.trim(),
        businessName: $('#dRegBusiness').value.trim(),
        mpmsCode: $('#dRegMpms').value.trim().toUpperCase()
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Account creation failed');

    saveSession(data.token, 'dealer', data.user, data.businessName || data.user);
    renderCatalog();
    switchView('store');

    lastGeneratedCreds = {
      id: data.generatedUserId || data.user,
      pass: data.generatedPassword || ''
    };
    $('#genDealerIdVal').textContent = lastGeneratedCreds.id;
    $('#genDealerPassVal').textContent = lastGeneratedCreds.pass;
    $('#dealerGenEmailNote').textContent = data.emailedCredentials
      ? `Credentials have also been emailed to ${data.email}.`
      : `Please save or copy your auto-generated User ID and Password below:`;

    $('#dealerRegInputForm').classList.add('hidden');
    $('#dealerOtpBanner').classList.add('hidden');
    $('#dealerGeneratedCard').classList.remove('hidden');
    showToast(`Created Dealer ID ${lastGeneratedCreds.id}!`);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify OTP & Auto-Create Account';
  }
}

async function copyGeneratedCredentials() {
  if (!lastGeneratedCreds.id) return;
  const text = `Somani Auto Parts Portal\nDealer ID: ${lastGeneratedCreds.id}\nPassword: ${lastGeneratedCreds.pass}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Dealer ID & Password copied!');
  } catch (e) {
    alert(text);
  }
}

async function submitPasswordReset(e, role) {
  e.preventDefault();
  const isAdmin = role === 'admin';
  const errBox = $(isAdmin ? '#adminAuthError' : '#dealerError');
  const banner = $(isAdmin ? '#adminOtpBanner' : '#dealerOtpBanner');
  const btn = $(isAdmin ? '#aResetSubmitBtn' : '#dResetSubmitBtn');

  errBox.classList.add('hidden');
  btn.disabled = true;

  try {
    const payload = isAdmin
      ? {
          role: 'admin',
          email: $('#aResetContact').value.trim(),
          otp: $('#aResetOtp').value.trim(),
          newPassword: $('#aResetNewPass').value
        }
      : {
          role: 'dealer',
          email: $('#dResetContact').value.trim(),
          otp: $('#dResetOtp').value.trim(),
          newUserId: $('#dResetNewId').value.trim().toUpperCase(),
          newPassword: $('#dResetNewPass').value
        };

    const res = await fetch(`${API_BASE}/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Password reset failed');

    if (isAdmin) {
      switchAdminAuthTab('login');
      $('#adminOtpBanner').textContent = 'Admin password updated! Sign in with your new password below.';
      $('#adminOtpBanner').classList.remove('hidden');
      $('#aLoginUser').value = data.user || 'admin';
    } else {
      switchDealerTab('login');
      banner.textContent = `Updated! Sign in with Dealer ID ${data.user} and your new password.`;
      banner.classList.remove('hidden');
      $('#dLoginId').value = data.user;
    }
    showToast('Password updated via OTP!');
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function submitDealerLogin(e) {
  e.preventDefault();
  const errBox = $('#dealerError');
  const btn = $('#dLoginSubmitBtn');
  errBox.classList.add('hidden');
  btn.disabled = true;

  try {
    const payload = {
      mode: 'dealer',
      loginType: authState.dealerLoginMode,
      username: $('#dLoginId').value.trim(),
      password: $('#dLoginPass').value,
      otp: $('#dLoginOtp').value.trim()
    };

    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Sign in failed');

    saveSession(data.token, 'dealer', data.user, data.businessName || data.user);
    closeAllOverlays();
    renderCatalog();
    if (typeof _pendingShopRedirect === 'function') {
      const fn = _pendingShopRedirect;
      _pendingShopRedirect = null;
      fn();
    } else {
      openShopPortal();
    }
    showToast(`Welcome, ${data.businessName || data.user}`);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function submitAdminLogin(e) {
  e.preventDefault();
  const errBox = $('#adminAuthError');
  const btn = $('#aLoginSubmitBtn');
  errBox.classList.add('hidden');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'admin',
        loginType: 'password',
        username: $('#aLoginUser').value.trim(),
        password: $('#aLoginPass').value
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Invalid Admin credentials');

    saveSession(data.token, 'admin', data.user, 'System Administrator');
    closeAllOverlays();
    switchView('admin');
    showToast(`Signed in as Admin (${data.user})`);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

function saveSession(token, role, user, businessName) {
  authState.token = token;
  authState.role = role;
  authState.user = user;
  authState.businessName = businessName;
  sessionStorage.setItem('sapl_token', token);
  sessionStorage.setItem('sapl_role', role);
  sessionStorage.setItem('sapl_user', user);
  sessionStorage.setItem('sapl_bname', businessName);
  updateAuthUI();
}

function logoutSession() {
  authState = { token: '', role: '', user: '', businessName: '', dealerLoginMode: 'password' };
  sessionStorage.removeItem('sapl_token');
  sessionStorage.removeItem('sapl_role');
  sessionStorage.removeItem('sapl_user');
  sessionStorage.removeItem('sapl_bname');
  updateAuthUI();
  switchView('store');
  renderCatalog();
  showToast('Signed out');
}

function updateAuthUI() {
  const mobLabel = $('#dealerBtnMobile');
  const deskLabel = $('#dealerBtnDesktop');
  const drawerAdminBtn = $('#drawerAdminStudioBtn');

  if (authState.role === 'dealer' && authState.token) {
    if (mobLabel) mobLabel.textContent = authState.user;
    if (deskLabel) deskLabel.textContent = authState.user;
    if (drawerAdminBtn) drawerAdminBtn.classList.add('hidden');
    $('#kpiTierLabel').textContent = authState.user;
    $('#kpiTierSub').textContent = `${authState.businessName || 'Partner'} • Net rates active`;
  } else if (authState.role === 'admin' && authState.token) {
    if (mobLabel) mobLabel.textContent = 'Sign In';
    if (deskLabel) deskLabel.textContent = 'Sign In';
    if (drawerAdminBtn) drawerAdminBtn.classList.remove('hidden');
    $('#kpiTierLabel').textContent = 'Partner Store';
    $('#kpiTierSub').textContent = 'Sign In for Net Pricing';
  } else {
    if (mobLabel) mobLabel.textContent = 'Sign In';
    if (deskLabel) deskLabel.textContent = 'Sign In';
    if (drawerAdminBtn) drawerAdminBtn.classList.add('hidden');
    $('#kpiTierLabel').textContent = 'Public Store';
    $('#kpiTierSub').textContent = 'Sign In for Net Pricing';
  }
}

// ---------------------------------------------------------------------------
// Admin Users & Recovery Contact Management
// ---------------------------------------------------------------------------
async function loadAdminUsers() {
  if (authState.role !== 'admin' || !authState.token) return;
  const wrap = $('#adminUsersTableWrap');
  if (!wrap) return;

  wrap.innerHTML = '<p class="py-4 text-slate-500">Loading accounts...</p>';
  try {
    const res = await fetch(`${API_BASE}/manage/users`, {
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    const rawText = await res.text();
    const data = rawText ? JSON.parse(rawText) : { ok: false, error: `Endpoint /api/manage/users returned status ${res.status}` };
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load users');

    const users = data.users || [];
    const adminRec = users.find(u => u.role === 'admin');
    if (adminRec) {
      if (adminRec.email) $('#adminRecEmail').value = adminRec.email;
      if (adminRec.mobile) $('#adminRecMobile').value = adminRec.mobile;
    }

    wrap.innerHTML = users.length
      ? `
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
              <th class="py-2.5 px-3">Role</th>
              <th class="py-2.5 px-3">User ID</th>
              <th class="py-2.5 px-3">Business / MPMS</th>
              <th class="py-2.5 px-3">Verified Contact</th>
              <th class="py-2.5 px-3">Status</th>
              <th class="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${users
              .map(
                u => `
              <tr>
                <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  u.role === 'admin' ? 'bg-orange-50 text-brand-orange border border-orange-200' : 'bg-blue-50 text-brand-blue border border-blue-200'
                }">${esc(u.role)}</span></td>
                <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${esc(u.userId)}</td>
                <td class="py-2.5 px-3">${esc(u.businessName || '—')} ${u.mpmsCode ? `<span class="font-mono text-[10px] text-slate-500">(${esc(u.mpmsCode)})</span>` : ''}</td>
                <td class="py-2.5 px-3 text-slate-600">${esc(u.email || u.mobile || 'Env Default')}</td>
                <td class="py-2.5 px-3">${
                  u.isActive
                    ? '<span class="text-emerald-700 font-bold">Active</span>'
                    : '<span class="text-rose-600 font-bold">Suspended</span>'
                }</td>
                <td class="py-2.5 px-3 text-right">
                  ${
                    u.role === 'dealer'
                      ? `<button onclick="toggleDealerAccount(${u.id})" class="text-brand-blue hover:underline font-semibold cursor-pointer">${
                          u.isActive ? 'Suspend' : 'Activate'
                        }</button>`
                      : '<span class="text-slate-400">Primary Admin</span>'
                  }
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      : '<p class="py-4 text-slate-500">No accounts found.</p>';
  } catch (err) {
    wrap.innerHTML = `<p class="py-4 text-rose-600">${esc(err.message)}</p>`;
  }
}

async function toggleDealerAccount(id) {
  try {
    const res = await fetch(`${API_BASE}/manage/users/${id}/toggle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    if (res.ok) {
      showToast('Dealer account status updated');
      loadAdminUsers();
    }
  } catch (e) {}
}

async function saveAdminRecoveryProfile(e) {
  e.preventDefault();
  try {
    const res = await fetch(`${API_BASE}/manage/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({
        email: $('#adminRecEmail').value.trim(),
        mobile: $('#adminRecMobile').value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not update profile');
    showToast('Admin OTP recovery contact saved!');
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// E-Commerce Enquiry Cart (Strictly Keyed by Unique Part Number)
// ---------------------------------------------------------------------------
function addToCart(partNoKey) {
  const key = String(partNoKey || '').trim().toUpperCase();
  if (!key) return;
  cart[key] = (cart[key] || 0) + 1;
  saveCart();
  updateCart();
  renderCatalog();
  showToast(`Added ${key} to Enquiry Basket`);
}

function changeQty(partNoKey, delta) {
  const key = String(partNoKey || '').trim().toUpperCase();
  if (!key) return;
  const prev = cart[key] || 0;
  const next = Math.max(0, prev + delta);
  if (next === 0) {
    delete cart[key];
  } else {
    cart[key] = next;
  }
  saveCart();
  updateCart();
  renderCatalog();
  if (delta > 0) {
    showToast(`${key}: ${next} in basket`);
  }
}

function removeCartItem(partNoKey) {
  const key = String(partNoKey || '').trim().toUpperCase();
  delete cart[key];
  saveCart();
  updateCart();
  renderCatalog();
}

function saveCart() {
  localStorage.setItem('sapl_parts_cart', JSON.stringify(cart));
}

function updateCart() {
  const entries = Object.entries(cart)
    .map(([partKey, qty]) => {
      const p = products.find(item => String(item.partNo || '').trim().toUpperCase() === String(partKey).toUpperCase());
      return p ? { ...p, partKey: String(p.partNo).trim().toUpperCase(), qty } : null;
    })
    .filter(Boolean);

  const totalQty = entries.reduce((sum, x) => sum + x.qty, 0);
  $('#cartCount').textContent = totalQty;
  $('#kpiBasketCount').textContent = `${totalQty} NOS`;
  $('#cartSubtotal').textContent = `${totalQty} NOS (${entries.length} SKUs)`;

  $('#cartItems').innerHTML = entries.length
    ? entries
        .map(
          x => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <span class="font-mono text-[11px] font-bold text-brand-orange">${esc(x.partKey)}</span>
            <p class="text-xs font-bold text-slate-900 truncate">${esc(x.name)}</p>
            <span class="text-[11px] text-slate-500">${esc(x.pg)} &bull; ${esc(x.brand || 'OEM')}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick="changeQty('${esc(x.partKey)}', -1)" class="w-7 h-7 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer">&minus;</button>
            <span class="w-6 text-center text-xs font-mono font-bold">${x.qty}</span>
            <button type="button" onclick="changeQty('${esc(x.partKey)}', 1)" class="w-7 h-7 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer">+</button>
            <button type="button" onclick="removeCartItem('${esc(x.partKey)}')" class="ml-1 text-xs text-rose-600 font-bold cursor-pointer">&times;</button>
          </div>
        </div>`
        )
        .join('')
    : `<div class="py-12 text-center text-xs text-slate-500">Your enquiry cart is empty.<br>Use <strong>+</strong> on any part card to build your enquiry.</div>`;
}

async function submitEnquiry() {
  const entries = Object.entries(cart)
    .map(([partKey, qty]) => {
      const p = products.find(item => String(item.partNo || '').trim().toUpperCase() === String(partKey).toUpperCase());
      return p
        ? {
            partId: p.id || 0,
            partNo: p.partNo,
            name: p.name,
            pg: p.pg,
            hierarchy: p.hierarchy,
            qty
          }
        : null;
    })
    .filter(Boolean);

  if (!entries.length) {
    alert('Please select at least one part before submitting your enquiry.');
    return;
  }

  const btn = $('#submitEnquiryBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const payload = {
    companyName: $('#enqCompany').value.trim() || authState.businessName,
    contactName: $('#enqName').value.trim(),
    contactPhone: $('#enqPhone').value.trim(),
    notes: $('#enqNotes').value.trim(),
    items: entries
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authState.token) headers.Authorization = `Bearer ${authState.token}`;

    const res = await fetch(`${API_BASE}/enquiries`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Submission error');

    showToast(`Enquiry ${data.ref} sent to Somani Auto Raipur!`);
    cart = {};
    saveCart();
    updateCart();
    renderCatalog();
    closeAllOverlays();
    if (authState.token) loadEnquiriesList();
  } catch (err) {
    alert(`Could not submit enquiry: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Quotation Enquiry';
  }
}

// ---------------------------------------------------------------------------
// STUDIO AUTO-ENHANCE ENGINE (Auto-Levels + Adaptive Contrast + Unsharp Mask)
// ---------------------------------------------------------------------------
function autoEnhanceImageFile(file, maxWidth = 1200, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }

        // 1. Capture raw resized original for Before/After comparison
        const rawCanvas = document.createElement('canvas');
        rawCanvas.width = w;
        rawCanvas.height = h;
        const rawCtx = rawCanvas.getContext('2d');
        rawCtx.drawImage(img, 0, 0, w, h);
        const originalDataUrl = rawCanvas.toDataURL('image/jpeg', 0.80);

        // 2. Analyze luminance histogram (2nd to 98th percentile auto-levels)
        const imgData = rawCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const hist = new Uint32Array(256);
        let sumLum = 0;
        const totalPixels = w * h;

        for (let i = 0; i < data.length; i += 4) {
          const lum = Math.min(255, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
          hist[lum]++;
          sumLum += lum;
        }

        const lowCut = Math.floor(totalPixels * 0.015);
        const highCut = Math.floor(totalPixels * 0.985);
        let acc = 0;
        let minLum = 0;
        let maxLum = 255;

        for (let l = 0; l < 256; l++) {
          acc += hist[l];
          if (acc >= lowCut) {
            minLum = l;
            break;
          }
        }
        acc = 0;
        for (let l = 0; l < 256; l++) {
          acc += hist[l];
          if (acc >= highCut) {
            maxLum = l;
            break;
          }
        }

        const span = Math.max(40, maxLum - minLum);
        const scale = 255 / span;
        const avgLum = sumLum / Math.max(1, totalPixels);
        const gamma = avgLum < 115 ? 0.90 : avgLum > 175 ? 1.06 : 0.96;
        const saturationBoost = 1.10;

        // Build lookup table for auto-levels + gamma + S-curve contrast
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) {
          let norm = Math.max(0, Math.min(1, ((v - minLum) * scale) / 255));
          norm = Math.pow(norm, gamma);
          // Subtle S-curve contrast boost
          norm = norm < 0.5 ? 2 * norm * norm * 0.25 + norm * 0.75 : 1 - 2 * (1 - norm) * (1 - norm) * 0.25 - (1 - norm) * 0.75;
          lut[v] = Math.max(0, Math.min(255, Math.round(norm * 255)));
        }

        const leveled = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4) {
          let r = lut[data[i]];
          let g = lut[data[i + 1]];
          let b = lut[data[i + 2]];

          // Subtle vibrance/saturation boost so labels & logos pop
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = gray + (r - gray) * saturationBoost;
          g = gray + (g - gray) * saturationBoost;
          b = gray + (b - gray) * saturationBoost;

          leveled[i] = Math.max(0, Math.min(255, r));
          leveled[i + 1] = Math.max(0, Math.min(255, g));
          leveled[i + 2] = Math.max(0, Math.min(255, b));
          leveled[i + 3] = 255;
        }

        // 3. Apply 3x3 Unsharp Mask (edge sharpening for part numbers & stickers)
        const sharpAmount = 0.42;
        const out = imgData.data;
        const rowStride = w * 4;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = y * rowStride + x * 4;
            for (let c = 0; c < 3; c++) {
              const center = leveled[idx + c];
              const blur =
                (leveled[idx - rowStride + c] +
                  leveled[idx + rowStride + c] +
                  leveled[idx - 4 + c] +
                  leveled[idx + 4 + c]) *
                0.25;
              const sharpened = center + sharpAmount * (center - blur);
              out[idx + c] = Math.max(0, Math.min(255, Math.round(sharpened)));
            }
          }
        }

        const enhCanvas = document.createElement('canvas');
        enhCanvas.width = w;
        enhCanvas.height = h;
        enhCanvas.getContext('2d').putImageData(imgData, 0, 0);

        const enhancedDataUrl = enhCanvas.toDataURL('image/jpeg', quality);
        const brightnessDelta = Math.round(((128 - Math.min(128, avgLum)) / 128) * 28 + 6);

        enhCanvas.toBlob(
          blob => {
            if (!blob) return reject(new Error('Image enhancement failed'));
            resolve({
              blob,
              enhancedDataUrl,
              originalDataUrl,
              originalBytes: file.size,
              compressedBytes: blob.size,
              width: w,
              height: h,
              report: `Auto-Enhanced: Exposure +${Math.max(4, brightnessDelta)}%, Contrast +12%, Sharpness +42% | ${Math.round(
                file.size / 1024
              )} KB -> ${Math.round(blob.size / 1024)} KB`
            });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function toggleEnhanceComparison() {
  if (!pendingAdminBlob) return;
  showingEnhancedPreview = !showingEnhancedPreview;
  const imgEl = $('#adminPhotoPreview');
  const toggleBtn = $('#btnToggleEnhancePreview');
  if (showingEnhancedPreview) {
    imgEl.src = pendingAdminBlob.enhancedDataUrl;
    toggleBtn.innerHTML = '&#10024; Enhanced';
    toggleBtn.className = 'shrink-0 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] font-bold cursor-pointer';
  } else {
    imgEl.src = pendingAdminBlob.originalDataUrl;
    toggleBtn.textContent = 'Original Raw';
    toggleBtn.className = 'shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer';
  }
}

// ---------------------------------------------------------------------------
// ADMIN-ONLY: Primary Photo Capture + SAS Upload + Vision OCR
// ---------------------------------------------------------------------------
function triggerAdminCamera() {
  if (authState.role !== 'admin' || !authState.token) {
    openAdminPortal();
    return;
  }
  $('#adminCamInput').value = '';
  $('#adminCamInput').click();
}

async function handleAdminCameraFile(file) {
  if (!file) return;
  const statusBox = $('#adminOcrStatus');
  statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-blue-50 border border-blue-200 text-brand-blue';
  statusBox.classList.remove('hidden');
  statusBox.textContent = 'Running Studio Auto-Enhance (brightness, contrast & sharpness)...';

  try {
    const comp = await autoEnhanceImageFile(file, 1200, 0.84);
    pendingAdminBlob = {
      blob: comp.blob,
      enhancedDataUrl: comp.enhancedDataUrl,
      originalDataUrl: comp.originalDataUrl,
      fileName: file.name || 'part-label.jpg'
    };
    showingEnhancedPreview = true;

    $('#adminPhotoPreview').src = comp.enhancedDataUrl;
    $('#adminPhotoPreviewWrap').classList.remove('hidden');
    $('#cameraPlaceholder').classList.add('hidden');
    $('#btnToggleEnhancePreview').classList.remove('hidden');
    $('#btnToggleEnhancePreview').innerHTML = '&#10024; Enhanced';

    $('#compressionStats').classList.remove('hidden');
    $('#compressionStats').textContent = comp.report;

    $('#btnUploadAndOcr').disabled = false;
    statusBox.textContent = 'Photo auto-enhanced & ready. Tap "Upload & Scan OCR" to upload and read label.';
  } catch (err) {
    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700';
    statusBox.textContent = err.message;
  }
}

async function uploadEnhancedBlobToAzure(blob, fileName) {
  const sasRes = await fetch(`${API_BASE}/uploads/sas`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authState.token}`
    },
    body: JSON.stringify({ fileName })
  });
  const sasData = await sasRes.json();
  if (!sasRes.ok || !sasData.ok) throw new Error(sasData.error || 'SAS ticket failed');

  const putRes = await fetch(sasData.uploadUrl, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': 'image/jpeg'
    },
    body: blob
  });
  if (!putRes.ok) throw new Error(`Blob upload error (${putRes.status})`);

  return {
    blobName: sasData.blobName,
    url: sasData.readUrl,
    thumbUrl: sasData.readUrl
  };
}

let lastOcrUploadedBlobName = '';

async function uploadAndScanAdminPhoto() {
  if (!pendingAdminBlob || authState.role !== 'admin' || !authState.token) return;

  const btn = $('#btnUploadAndOcr');
  const statusBox = $('#adminOcrStatus');
  btn.disabled = true;
  statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-blue-50 border border-blue-200 text-brand-blue';
  statusBox.classList.remove('hidden');

  try {
    statusBox.textContent = '1/2 Preparing label image for OCR scan...';
    const uploaded = await uploadEnhancedBlobToAzure(pendingAdminBlob.blob, pendingAdminBlob.fileName);
    lastOcrUploadedBlobName = uploaded.blobName;

    statusBox.textContent = '2/2 Reading label text via Azure Computer Vision OCR...';
    const ocrRes = await fetch(`${API_BASE}/ocr/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({
        blobName: uploaded.blobName,
        createThumbnail: true
      })
    });
    const ocrData = await ocrRes.json();
    if (!ocrRes.ok || !ocrData.ok) throw new Error(ocrData.error || 'Vision OCR failed');

    const ext = ocrData.extracted || {};

    if (ext.partNo && !$('#fPartNo').value) $('#fPartNo').value = ext.partNo;
    const scannedKey = ($('#fPartNo').value || ext.partNo || '').trim().toUpperCase();
    const existingMatch = scannedKey
      ? products.find(x => String(x.partNo || '').trim().toUpperCase() === scannedKey)
      : null;

    if (existingMatch && !$('#fEditId').value) {
      applyExistingPartMergeState(existingMatch, ext.stockQty || 1);
    } else {
      if (ext.name && !$('#fName').value) $('#fName').value = ext.name;
      if (ext.brand) $('#fBrand').value = ext.brand;
      if (ext.pg) $('#fPG').value = ext.pg;
      if (ext.hierarchy) $('#fHierarchy').value = ext.hierarchy;
      if (ext.mrp && Number($('#fMrp').value || 0) === 0) {
        $('#fMrp').value = ext.mrp;
        $('#fDealerPrice').value = ext.mrp;
      }
      if (ext.stockQty) $('#fStockQty').value = ext.stockQty;
      if (ext.uom) $('#fUom').value = ext.uom;
    }

    if (ext.rawText) {
      $('#adminOcrRawWrap').classList.remove('hidden');
      $('#adminOcrRawText').textContent = ext.rawText;
    }

    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700';
    statusBox.textContent = 'OCR autofill complete! Click the red × on the photo to cut/remove it, or choose your own thumbnail below.';
  } catch (err) {
    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700';
    statusBox.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function clearAdminOcrPhotoOnly() {
  // Cuts/removes only the OCR label image while preserving all autofilled form fields!
  if (lastOcrUploadedBlobName) {
    adminGalleryItems = adminGalleryItems.filter(item => item.blobName !== lastOcrUploadedBlobName);
    if ($('#fBlobName').value === lastOcrUploadedBlobName) {
      $('#fBlobName').value = '';
      $('#fImageUrl').value = '';
      $('#fThumbnailUrl').value = '';
    }
    lastOcrUploadedBlobName = '';
  }
  pendingAdminBlob = null;
  showingEnhancedPreview = true;

  const camInp = $('#adminCamInput');
  if (camInp) camInp.value = '';

  $('#adminPhotoPreview').src = '';
  $('#adminPhotoPreviewWrap').classList.add('hidden');
  $('#cameraPlaceholder').classList.remove('hidden');
  $('#btnToggleEnhancePreview').classList.add('hidden');
  $('#compressionStats').classList.add('hidden');
  $('#adminOcrRawWrap').classList.add('hidden');
  $('#adminOcrStatus').classList.add('hidden');
  $('#btnUploadAndOcr').disabled = true;

  if (adminGalleryItems.length === 0 && !$('#fThumbnailUrl').value) {
    clearAllPhotosFlag = true;
  }
  renderAdminGalleryGrid();
  showToast('OCR photo removed — autofilled details kept');
}

function triggerCustomThumbnailPicker() {
  if (authState.role !== 'admin' || !authState.token) {
    openAdminPortal();
    return;
  }
  const inp = $('#adminThumbInput');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

async function handleCustomThumbnailFile(file) {
  if (!file) return;
  const statusBox = $('#adminOcrStatus');
  statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-blue-50 border border-blue-200 text-brand-blue';
  statusBox.classList.remove('hidden');
  statusBox.textContent = 'Enhancing & uploading your custom thumbnail...';

  try {
    const comp = await autoEnhanceImageFile(file, 1200, 0.86);
    const uploaded = await uploadEnhancedBlobToAzure(comp.blob, file.name || 'custom-thumbnail.jpg');

    $('#fBlobName').value = uploaded.blobName;
    $('#fImageUrl').value = uploaded.url;
    $('#fThumbnailUrl').value = uploaded.thumbUrl;
    clearAllPhotosFlag = false;

    const thumbEntry = {
      blobName: uploaded.blobName,
      url: uploaded.url,
      thumbUrl: uploaded.thumbUrl,
      label: 'Front / Primary'
    };

    if (adminGalleryItems.length > 0) {
      adminGalleryItems[0] = thumbEntry;
    } else {
      adminGalleryItems.unshift(thumbEntry);
    }
    renderAdminGalleryGrid();

    const row = $('#customThumbPreviewRow');
    if (row) {
      row.classList.remove('hidden');
      row.classList.add('flex');
      $('#customThumbPreviewImg').src = comp.enhancedDataUrl;
      $('#customThumbName').textContent = file.name || 'Custom Thumbnail';
    }

    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700';
    statusBox.textContent = 'Custom thumbnail uploaded and set as primary storefront photo!';
    showToast('Custom thumbnail selected!');
  } catch (err) {
    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700';
    statusBox.textContent = err.message;
  }
}

function clearCustomThumbnail() {
  const row = $('#customThumbPreviewRow');
  if (row) {
    row.classList.add('hidden');
    row.classList.remove('flex');
  }
  $('#customThumbPreviewImg').src = '';
  const inp = $('#adminThumbInput');
  if (inp) inp.value = '';

  if (adminGalleryItems.length > 0) {
    adminGalleryItems.shift();
  }
  if (adminGalleryItems.length > 0) {
    const nextFirst = adminGalleryItems[0];
    $('#fBlobName').value = nextFirst.blobName || '';
    $('#fImageUrl').value = nextFirst.url || '';
    $('#fThumbnailUrl').value = nextFirst.thumbUrl || nextFirst.url || '';
  } else {
    $('#fBlobName').value = '';
    $('#fImageUrl').value = '';
    $('#fThumbnailUrl').value = '';
    clearAllPhotosFlag = true;
  }
  renderAdminGalleryGrid();
  showToast('Custom thumbnail removed');
}


function applyExistingPartMergeState(existingPart, addQty = 1) {
  if (!existingPart) return;
  $('#fPartNo').value = existingPart.partNo;
  $('#fName').value = existingPart.name || '';
  $('#fDescription').value = existingPart.description || '';
  $('#fBrand').value = existingPart.brand || 'TATA / OEM';
  $('#fPG').value = ['PG1', 'PG2', 'PG3', 'PG4', 'PG5', 'PG6'].includes(existingPart.pg) ? existingPart.pg : 'PG1';
  $('#fHierarchy').value = existingPart.hierarchy || 'General';
  $('#fMrp').value = Number(existingPart.mrp || 0);
  $('#fDealerPrice').value = Number(existingPart.dealerPrice || existingPart.mrp || 0);
  $('#fUom').value = existingPart.uom || 'NOS';
  if ($('#fLocation')) {
    $('#fLocation').value = existingPart.location === 'Location 2' ? 'Location 2' : 'Location 1';
  }
  $('#fStockQty').value = Math.max(1, parseInt(addQty, 10) || 1);

  const curStock = Number(existingPart.stockQty || 0);
  const uom = existingPart.uom || 'NOS';
  const loc = existingPart.location || 'Location 1';
  const addVal = parseInt($('#fStockQty').value, 10) || 0;

  const banner = $('#existingPartMatchBanner');
  if (banner) {
    banner.classList.remove('hidden');
    $('#existingPartStockBadge').textContent = `Current Stock: ${curStock} ${uom} (${loc})`;
    $('#existingPartInfoText').textContent =
      `Keeping existing description "${existingPart.name}". Saving will add +${addVal} ${uom} to existing stock (New Total: ${curStock + addVal} ${uom}).`;
  }
  const qtyLbl = $('#fStockQtyLabel');
  if (qtyLbl) qtyLbl.textContent = 'Add Qty (+)';
  const saveBtn = $('#btnSavePart');
  if (saveBtn) saveBtn.textContent = 'Add Quantity to Existing Part';
}

function clearExistingPartMergeBanner() {
  const banner = $('#existingPartMatchBanner');
  if (banner) banner.classList.add('hidden');
  const qtyLbl = $('#fStockQtyLabel');
  if (qtyLbl) qtyLbl.textContent = 'Stock Qty';
  if (!$('#fEditId').value) {
    const saveBtn = $('#btnSavePart');
    if (saveBtn) saveBtn.textContent = 'Save Part to Live Catalogue';
  }
}

function checkPartNoAutoMerge() {
  if ($('#fEditId').value) {
    clearExistingPartMergeBanner();
    return;
  }
  const key = ($('#fPartNo').value || '').trim().toUpperCase();
  if (!key) {
    clearExistingPartMergeBanner();
    return;
  }
  const existing = products.find(x => String(x.partNo || '').trim().toUpperCase() === key);
  if (existing) {
    applyExistingPartMergeState(existing, $('#fStockQty').value || 1);
  } else {
    clearExistingPartMergeBanner();
  }
}

// ---------------------------------------------------------------------------
// ADMIN-ONLY: Multi-Angle Gallery Uploader & Manager
// ---------------------------------------------------------------------------
function triggerAdminGalleryPicker() {
  if (authState.role !== 'admin' || !authState.token) {
    openAdminPortal();
    return;
  }
  $('#adminGalleryInput').value = '';
  $('#adminGalleryInput').click();
}

async function handleAdminGalleryFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const statusEl = $('#galleryUploadStatus');
  statusEl.classList.remove('hidden');

  const defaultLabels = ['Front / Primary', 'Side View', 'Back / Mounting', 'Close-Up View', 'Box / Packaging'];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    statusEl.textContent = `Auto-enhancing & uploading angle ${i + 1} of ${files.length} (${file.name})...`;
    try {
      const comp = await autoEnhanceImageFile(file, 1200, 0.84);
      const uploaded = await uploadEnhancedBlobToAzure(comp.blob, file.name || `angle-${i + 1}.jpg`);
      const nextIdx = adminGalleryItems.length;
      const label = defaultLabels[nextIdx] || `Angle ${nextIdx + 1}`;

      adminGalleryItems.push({
        blobName: uploaded.blobName,
        url: uploaded.url,
        thumbUrl: uploaded.thumbUrl,
        label
      });
      clearAllPhotosFlag = false;

      if (nextIdx === 0) {
        $('#fBlobName').value = uploaded.blobName;
        $('#fImageUrl').value = uploaded.url;
        $('#fThumbnailUrl').value = uploaded.thumbUrl;
        $('#adminPhotoPreview').src = comp.enhancedDataUrl;
        $('#adminPhotoPreviewWrap').classList.remove('hidden');
        $('#cameraPlaceholder').classList.add('hidden');
      }

      renderAdminGalleryGrid();
    } catch (err) {
      alert(`Could not upload ${file.name}: ${err.message}`);
    }
  }

  statusEl.textContent = `All ${files.length} photo(s) auto-enhanced & added to gallery! Remember to click Save/Update.`;
  setTimeout(() => statusEl.classList.add('hidden'), 4500);
}

function renderAdminGalleryGrid() {
  const grid = $('#adminGalleryGrid');
  if (!grid) return;

  if (!adminGalleryItems.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-4 text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white">
      No angle photos added yet. Click <strong>+ Add More Angles / Photos</strong> to upload different views.
    </div>`;
    return;
  }

  grid.innerHTML = adminGalleryItems
    .map(
      (item, idx) => `
      <div class="bg-white border ${idx === 0 ? 'border-brand-blue ring-1 ring-brand-blue/20' : 'border-slate-200'} rounded-xl p-2 space-y-1.5 shadow-2xs">
        <div class="relative aspect-[4/3] bg-slate-100 rounded-lg overflow-hidden">
          <img loading="lazy" decoding="async" onclick="openAdminGalleryZoom(${idx})" title="Click to zoom &amp; inspect" src="${esc(item.thumbUrl || item.url)}" class="w-full h-full object-cover cursor-zoom-in hover:scale-[1.03] transition-transform" alt="${esc(item.label)}" />
          ${
            idx === 0
              ? '<span class="absolute top-1 left-1 bg-brand-blue text-white text-[9px] font-bold px-1.5 py-0.5 rounded">PRIMARY</span>'
              : `<button type="button" onclick="setPrimaryGalleryAngle(${idx})" class="absolute top-1 left-1 bg-white/90 hover:bg-brand-blue hover:text-white text-slate-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 cursor-pointer">Set Primary</button>`
          }
          <button type="button" onclick="removeGalleryAngle(${idx})" aria-label="Remove angle" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center cursor-pointer">&times;</button>
        </div>
        <input
          type="text"
          value="${esc(item.label)}"
          onchange="updateGalleryAngleLabel(${idx}, this.value)"
          placeholder="Angle label"
          class="w-full bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-700 focus:bg-white focus:outline-none focus:border-brand-blue"
        />
      </div>`
    )
    .join('');
}

function setPrimaryGalleryAngle(idx) {
  if (idx <= 0 || idx >= adminGalleryItems.length) return;
  const [chosen] = adminGalleryItems.splice(idx, 1);
  adminGalleryItems.unshift(chosen);

  $('#fBlobName').value = chosen.blobName || '';
  $('#fImageUrl').value = chosen.url || '';
  $('#fThumbnailUrl').value = chosen.thumbUrl || chosen.url || '';
  $('#adminPhotoPreview').src = chosen.url || chosen.thumbUrl;
  $('#adminPhotoPreviewWrap').classList.remove('hidden');
  $('#cameraPlaceholder').classList.add('hidden');

  renderAdminGalleryGrid();
  showToast('Primary cover photo updated');
}

function updateGalleryAngleLabel(idx, newLabel) {
  if (!adminGalleryItems[idx]) return;
  adminGalleryItems[idx].label = String(newLabel || '').trim() || `Angle ${idx + 1}`;
}

function removeGalleryAngle(idx) {
  adminGalleryItems.splice(idx, 1);
  if (adminGalleryItems.length > 0) {
    const first = adminGalleryItems[0];
    $('#fBlobName').value = first.blobName || '';
    $('#fImageUrl').value = first.url || '';
    $('#fThumbnailUrl').value = first.thumbUrl || first.url || '';
    $('#adminPhotoPreview').src = first.url || first.thumbUrl;
  } else {
    $('#fBlobName').value = '';
    $('#fImageUrl').value = '';
    $('#fThumbnailUrl').value = '';
    $('#adminPhotoPreviewWrap').classList.add('hidden');
    $('#cameraPlaceholder').classList.remove('hidden');
    clearAllPhotosFlag = true;
  }
  renderAdminGalleryGrid();
}

// ---------------------------------------------------------------------------
// ADMIN-ONLY: Edit Product, Save Product & Remove Product
// ---------------------------------------------------------------------------
function startEditProduct(partNoKey) {
  const p = products.find(x => String(x.partNo).toUpperCase() === String(partNoKey).toUpperCase());
  if (!p) return;

  switchAdminTab('single');

  $('#fEditId').value = p.isLive && Number(p.id) > 0 ? String(p.id) : '';
  $('#fPartNo').value = p.partNo || '';
  $('#fBrand').value = p.brand || 'TATA / OEM';
  $('#fName').value = p.name || '';
  $('#fDescription').value = p.description || '';
  $('#fPG').value = ['PG1', 'PG2', 'PG3', 'PG4', 'PG5', 'PG6'].includes(p.pg) ? p.pg : 'PG1';
  $('#fHierarchy').value = p.hierarchy || 'General';
  $('#fMrp').value = Number(p.mrp || 0);
  $('#fDealerPrice').value = Number(p.dealerPrice || p.mrp || 0);
  $('#fStockQty').value = Number(p.stockQty || 0);
  $('#fUom').value = p.uom || 'NOS';
  if ($('#fLocation')) {
    $('#fLocation').value = p.location === 'Location 2' ? 'Location 2' : 'Location 1';
  }
  clearExistingPartMergeBanner();

  // Populate existing gallery / primary photos
  clearAllPhotosFlag = false;
  adminGalleryItems = [];
  if (Array.isArray(p.gallery) && p.gallery.length > 0) {
    adminGalleryItems = p.gallery.map((g, i) => ({
      blobName: g.blobName || null,
      url: g.url || g.thumbUrl,
      thumbUrl: g.thumbUrl || g.url,
      label: g.label || (i === 0 ? 'Front / Primary' : `Angle ${i + 1}`)
    }));
  } else if (p.imageUrl || p.thumbnailUrl) {
    adminGalleryItems = [
      {
        blobName: p.blobName || null,
        url: p.imageUrl || p.thumbnailUrl,
        thumbUrl: p.thumbnailUrl || p.imageUrl,
        label: 'Front / Primary'
      }
    ];
  }

  if (adminGalleryItems.length > 0) {
    const first = adminGalleryItems[0];
    $('#fBlobName').value = first.blobName || '';
    $('#fImageUrl').value = first.url || '';
    $('#fThumbnailUrl').value = first.thumbUrl || first.url || '';
    $('#adminPhotoPreview').src = first.url || first.thumbUrl;
    $('#adminPhotoPreviewWrap').classList.remove('hidden');
    $('#cameraPlaceholder').classList.add('hidden');
    const thumbRow = $('#customThumbPreviewRow');
    if (thumbRow) {
      thumbRow.classList.remove('hidden');
      thumbRow.classList.add('flex');
      $('#customThumbPreviewImg').src = first.thumbUrl || first.url;
      $('#customThumbName').textContent = first.label || 'Existing Thumbnail';
    }
  } else {
    $('#fBlobName').value = '';
    $('#fImageUrl').value = '';
    $('#fThumbnailUrl').value = '';
    $('#adminPhotoPreviewWrap').classList.add('hidden');
    $('#cameraPlaceholder').classList.remove('hidden');
  }

  renderAdminGalleryGrid();

  $('#editModePartLabel').textContent = p.partNo;
  $('#editModeBanner').classList.remove('hidden');
  $('#formStepKicker').textContent = 'Edit Mode • Update Product & Angles';
  $('#formStepTitle').textContent = `Editing ${p.partNo}`;
  $('#btnSavePart').textContent = 'Update Part in Live Catalogue';

  $('#adminEditorCard').scrollIntoView({ behavior: 'smooth' });
  showToast(`Loaded ${p.partNo} for editing`);
}

async function savePartMaster(e) {
  e.preventDefault();
  if (authState.role !== 'admin' || !authState.token) return;

  const btn = $('#btnSavePart');
  const isEditing = Boolean($('#fEditId').value);
  btn.disabled = true;
  btn.textContent = isEditing ? 'Updating...' : 'Saving...';

  const payload = {
    editId: $('#fEditId').value ? parseInt($('#fEditId').value, 10) : 0,
    partNo: $('#fPartNo').value.trim().toUpperCase(),
    name: $('#fName').value.trim(),
    description: $('#fDescription').value.trim(),
    pg: $('#fPG').value,
    hierarchy: $('#fHierarchy').value.trim() || 'General',
    brand: $('#fBrand').value.trim() || 'TATA / OEM',
    mrp: parseFloat($('#fMrp').value || '0'),
    dealerPrice: parseFloat($('#fDealerPrice').value || '0'),
    stockQty: parseInt($('#fStockQty').value || '0', 10),
    uom: $('#fUom').value,
    location: $('#fLocation') ? $('#fLocation').value : 'Location 1',
    blobName: $('#fBlobName').value || null,
    imageUrl: $('#fImageUrl').value || null,
    thumbnailUrl: $('#fThumbnailUrl').value || $('#fImageUrl').value || null,
    gallery: adminGalleryItems,
    clearPhotos: clearAllPhotosFlag,
    ocrRawText: $('#adminOcrRawText').textContent || null
  };

  try {
    const res = await fetch(`${API_BASE}/parts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');

    if (data.mergedExisting && data.part) {
      showToast(`Added +${payload.stockQty} ${payload.uom} to ${payload.partNo} (New Stock: ${data.part.stockQty} ${data.part.uom} at ${data.part.location})`);
    } else {
      showToast(isEditing ? `Updated ${payload.partNo} (${payload.location})!` : `Saved ${payload.partNo} (${payload.location}) to live catalogue!`);
    }
    resetAdminForm();
    await loadCatalogueData();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Part to Live Catalogue';
  }
}

function resetAdminForm() {
  $('#partMasterForm').reset();
  $('#fEditId').value = '';
  $('#fBlobName').value = '';
  $('#fThumbnailUrl').value = '';
  $('#fImageUrl').value = '';
  pendingAdminBlob = null;
  showingEnhancedPreview = true;
  adminGalleryItems = [];
  clearAllPhotosFlag = false;

  $('#adminPhotoPreviewWrap').classList.add('hidden');
  $('#cameraPlaceholder').classList.remove('hidden');
  $('#btnToggleEnhancePreview').classList.add('hidden');
  $('#compressionStats').classList.add('hidden');
  $('#adminOcrRawWrap').classList.add('hidden');
  $('#adminOcrStatus').classList.add('hidden');
  $('#editModeBanner').classList.add('hidden');
  $('#formStepKicker').textContent = 'Step 2 • Catalogue Entry & Multi-Angle Gallery';
  $('#formStepTitle').textContent = 'Save Part to Live Database';
  lastOcrUploadedBlobName = '';
  const thumbRow = $('#customThumbPreviewRow');
  if (thumbRow) {
    thumbRow.classList.add('hidden');
    thumbRow.classList.remove('flex');
  }
  if ($('#customThumbPreviewImg')) $('#customThumbPreviewImg').src = '';
  if ($('#fLocation')) $('#fLocation').value = 'Location 1';
  clearExistingPartMergeBanner();
  $('#btnSavePart').textContent = 'Save Part to Live Catalogue';
  $('#btnUploadAndOcr').disabled = true;
  renderAdminGalleryGrid();
}

// ---------------------------------------------------------------------------
// ADMIN-ONLY: Bulk Excel Upload
// ---------------------------------------------------------------------------
function downloadExcelTemplate() {
  if (typeof XLSX === 'undefined') return;
  const sampleRows = [
    {
      'Part No': '278613995301',
      'Part Name': 'Gasket Acc Drive Cover',
      'PG': 'PG1',
      'Hierarchy': 'Gasket & Seals',
      'Brand': 'TATA',
      'MRP': 684,
      'Dealer Price': 580,
      'Stock Qty': 24,
      'UOM': 'NOS',
      'Location': 'Location 1',
      'Details': 'Genuine OEM gasket for commercial vehicle engine'
    }
  ];
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 18 }, { wch: 34 }, { wch: 8 }, { wch: 20 }, { wch: 14 },
    { wch: 10 }, { wch: 13 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 36 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parts_Upload');
  XLSX.writeFile(wb, 'Somani_Auto_Parts_Template.xlsx');
}

async function exportCatalogToExcel() {
  if (authState.role !== 'admin' || !authState.token) {
    showToast('Admin login required to export catalog.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    showToast('Excel library not loaded. Refresh the page and try again.');
    return;
  }

  const btn = $('#btnExportCatalogExcel');
  const banner = $('#excelStatusBanner');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Exporting Live Parts...';
  }

  try {
    let list = Array.isArray(products) ? products : [];
    try {
      const res = await fetch(`${API_BASE}/parts`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.parts) && data.parts.length > 0) {
          list = data.parts;
        }
      }
    } catch (_) {}

    if (!list.length) {
      showToast('No parts available to export.');
      return;
    }

    const exportRows = list.map(p => ({
      'Part No': String(p.partNo || '').trim().toUpperCase(),
      'Part Name': String(p.name || '').trim(),
      'PG': String(p.pg || 'PG1').trim().toUpperCase(),
      'Hierarchy': String(p.hierarchy || 'General').trim(),
      'Brand': String(p.brand || 'TATA / OEM').trim(),
      'MRP': Number(p.mrp || 0),
      'Dealer Price': Number(p.dealerPrice || 0),
      'Stock Qty': Number(p.stockQty || 0),
      'UOM': String(p.uom || 'NOS').trim().toUpperCase(),
      'Location': String(p.location || 'Location 1').trim(),
      'Details': String(p.description || '').trim()
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws['!cols'] = [
      { wch: 18 }, { wch: 36 }, { wch: 8 }, { wch: 22 }, { wch: 15 },
      { wch: 11 }, { wch: 13 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 38 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Live_Parts_Catalog');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Somani_Auto_Live_Catalog_${stamp}.xlsx`);

    if (banner) {
      banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700';
      banner.classList.remove('hidden');
      banner.textContent = `Exported ${exportRows.length} live parts! Edit Stock Qty, MRP, Dealer Price, Location, or Details in Excel and re-upload below to bulk update (existing product photos are preserved).`;
    }
    showToast(`Exported ${exportRows.length} live parts to Excel!`);
  } catch (err) {
    if (banner) {
      banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700';
      banner.classList.remove('hidden');
      banner.textContent = `Export error: ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

function triggerExcelPicker() {
  if (authState.role !== 'admin' || !authState.token) return;
  $('#excelFileInput').value = '';
  $('#excelFileInput').click();
}

function normalizeExcelColumn(row, candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const found = keys.find(k => k.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === cand);
    if (found && row[found] !== undefined && row[found] !== null) {
      return String(row[found]).trim();
    }
  }
  return '';
}

function handleExcelFile(file) {
  if (!file || typeof XLSX === 'undefined') return;
  const banner = $('#excelStatusBanner');
  banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-blue-50 border border-blue-200 text-brand-blue';
  banner.classList.remove('hidden');
  banner.textContent = `Reading ${file.name}...`;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

      parsedExcelParts = [];
      let skipped = 0;

      rawRows.forEach(r => {
        const partNo = normalizeExcelColumn(r, ['partno', 'partnumber', 'partcode', 'itemcode', 'sku']).toUpperCase();
        const name = normalizeExcelColumn(r, ['partname', 'name', 'description', 'partdescription', 'itemname']);
        if (!partNo || !name) {
          skipped++;
          return;
        }
        let pg = normalizeExcelColumn(r, ['pg', 'productgroup', 'group']).toUpperCase();
        if (!['PG1', 'PG2', 'PG3', 'PG4', 'PG5', 'PG6'].includes(pg)) pg = 'PG1';

        const hierarchy = normalizeExcelColumn(r, ['hierarchy', 'producthierarchy', 'category', 'subgroup']) || 'General';
        const brand = normalizeExcelColumn(r, ['brand', 'oem', 'make']) || 'TATA / OEM';
        const mrp = parseFloat(normalizeExcelColumn(r, ['mrp', 'listprice', 'price']).replace(/[^\d.]/g, '')) || 0;
        const dealerPrice =
          parseFloat(normalizeExcelColumn(r, ['dealerprice', 'netprice', 'rate', 'dlp']).replace(/[^\d.]/g, '')) || mrp;
        const stockQty = parseInt(normalizeExcelColumn(r, ['stockqty', 'qty', 'stock', 'quantity']).replace(/[^\d]/g, ''), 10) || 0;
        const uom = (normalizeExcelColumn(r, ['uom', 'unit']) || 'NOS').toUpperCase();

        const rawLoc = normalizeExcelColumn(r, ['location', 'warehouse', 'branch']);
        const location = rawLoc ? (/2/.test(rawLoc) ? 'Location 2' : 'Location 1') : '';
        const detailsKey = Object.keys(r).find(k => ['details', 'productdescription', 'longdescription', 'notes'].includes(k.trim().toLowerCase().replace(/[^a-z0-9]/g, '')));
        const hasDescription = Boolean(detailsKey);
        const description = detailsKey ? String(r[detailsKey] ?? '').trim() : '';
        parsedExcelParts.push({ partNo, name, pg, hierarchy, brand, mrp, dealerPrice, stockQty, uom, location, description, hasDescription });
      });

      if (!parsedExcelParts.length) {
        banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700';
        banner.textContent = 'No valid rows found. Ensure columns "Part No" and "Part Name" exist.';
        $('#excelPreviewSection').classList.add('hidden');
        return;
      }

      banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700';
      banner.textContent = `Parsed ${parsedExcelParts.length} parts from "${file.name}".`;
      $('#excelValidCount').textContent = parsedExcelParts.length;
      $('#excelSkippedNote').textContent = skipped > 0 ? ` (${skipped} blank rows skipped)` : '';

      $('#excelPreviewBody').innerHTML = parsedExcelParts
        .slice(0, 100)
        .map(
          (p, i) => `
          <tr>
            <td class="py-2 px-3 text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 font-mono font-bold text-brand-orange">${esc(p.partNo)}</td>
            <td class="py-2 px-3 font-semibold text-slate-800">${esc(p.name)}</td>
            <td class="py-2 px-3">${esc(p.pg)}</td>
            <td class="py-2 px-3">${esc(p.brand)}</td>
            <td class="py-2 px-3 font-mono">${money(p.mrp)}</td>
            <td class="py-2 px-3 font-mono">${money(p.dealerPrice)}</td>
            <td class="py-2 px-3 font-mono font-bold text-emerald-700">${esc(p.stockQty)}</td>
          </tr>`
        )
        .join('');

      $('#excelPreviewSection').classList.remove('hidden');
    } catch (err) {
      banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700';
      banner.textContent = `Excel error: ${err.message}`;
    }
  };
  reader.readAsArrayBuffer(file);
}

function clearExcelPreview() {
  parsedExcelParts = [];
  $('#excelPreviewSection').classList.add('hidden');
  $('#excelStatusBanner').classList.add('hidden');
}

async function uploadExcelRowsToDb() {
  if (!parsedExcelParts.length || authState.role !== 'admin' || !authState.token) return;
  const btn = $('#btnConfirmExcelImport');
  const banner = $('#excelStatusBanner');
  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const res = await fetch(`${API_BASE}/parts/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ parts: parsedExcelParts })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Import failed');

    banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700';
    banner.textContent = `Imported ${data.importedCount} parts into sapl_parts_db!`;
    showToast(`Imported ${data.importedCount} parts!`);
    parsedExcelParts = [];
    $('#excelPreviewSection').classList.add('hidden');
    await loadCatalogueData();
  } catch (err) {
    banner.className = 'rounded-xl px-4 py-3 text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700';
    banner.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import All to Live Database';
  }
}

function renderAdminPartsTable() {
  const wrap = $('#adminPartsTableWrap');
  if (!wrap) return;

  const q = ($('#adminPartsSearch')?.value || '').trim().toLowerCase();
  const filtered = q
    ? products.filter(p => `${p.partNo} ${p.name} ${p.brand || ''} ${p.pg} ${p.hierarchy}`.toLowerCase().includes(q))
    : products;

  const rows = filtered.slice(0, 60);
  if (!rows.length) {
    wrap.innerHTML = '<p class="py-6 text-center text-slate-500">No matching parts found.</p>';
    return;
  }

  // Mobile-friendly interactive cards (< 768px) + Desktop table (>= 768px)
  const mobileCardsHtml = `
    <div class="md:hidden space-y-2.5">
      ${rows
        .map(p => {
          const fallback = fallbackImageFor(p);
          const angleCount = Array.isArray(p.gallery) ? p.gallery.length : 0;
          const safeKey = esc(p.partNo);
          return `
            <div onclick="openAdminPartActions('${safeKey}')" class="border border-slate-200 hover:border-brand-blue rounded-xl p-3 bg-slate-50/60 active:bg-blue-50/40 transition cursor-pointer space-y-2.5">
              <div class="flex items-start gap-3">
                <div class="relative shrink-0">
                  <img loading="lazy" decoding="async" onclick="event.stopPropagation();openProductZoomByPartNo('${safeKey}')" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" class="w-14 h-14 rounded-xl object-cover border border-slate-200 bg-white cursor-zoom-in" alt="" />
                  ${
                    angleCount > 1
                      ? `<span class="absolute -bottom-1 -right-1 bg-brand-blue text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full">${angleCount}</span>`
                      : ''
                  }
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1.5">
                    <span class="font-mono text-xs font-extrabold text-brand-orange bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md truncate">
                      ${safeKey} &rsaquo;
                    </span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      p.isLive ? 'bg-blue-50 text-brand-blue border border-blue-200' : 'bg-slate-200/70 text-slate-600'
                    }">${p.isLive ? 'Live DB' : 'Seed'}</span>
                  </div>
                  <p class="text-xs font-bold text-slate-900 mt-1 line-clamp-2">${esc(p.name)}</p>
                  <p class="text-[11px] text-slate-500 mt-0.5">${esc(p.brand || 'OEM')} &bull; <strong class="text-slate-700">${esc(p.location || 'Location 1')}</strong> &bull; Qty: <strong class="font-mono text-slate-800">${Number(p.stockQty || 0)}</strong> &bull; MRP ${money(p.mrp)}</p>
                </div>
              </div>

              <div onclick="event.stopPropagation()" class="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-200/80">
                <button type="button" onclick="startEditProduct('${safeKey}')" class="py-1.5 px-2 rounded-lg bg-brand-blue text-white font-bold text-[11px] text-center cursor-pointer">
                  &#9998; Edit / Photos
                </button>
                <button type="button" onclick="openProductDetail('${safeKey}')" class="py-1.5 px-2 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold text-[11px] text-center cursor-pointer">
                  Preview
                </button>
                <button type="button" onclick="removeProduct('${safeKey}')" class="py-1.5 px-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px] text-center cursor-pointer">
                  Remove
                </button>
              </div>
            </div>`;
        })
        .join('')}
    </div>`;

  const desktopTableHtml = `
    <div class="hidden md:block overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
            <th class="py-2.5 px-3">Photo / Angles</th>
            <th class="py-2.5 px-3">Part No (Click to Open)</th>
            <th class="py-2.5 px-3">Description</th>
            <th class="py-2.5 px-3">PG / Hierarchy</th>
            <th class="py-2.5 px-3">MRP / Dealer</th>
            <th class="py-2.5 px-3">Source</th>
            <th class="py-2.5 px-3 text-right">Edit / Remove</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows
            .map(p => {
              const fallback = fallbackImageFor(p);
              const angleCount = Array.isArray(p.gallery) ? p.gallery.length : 0;
              const safeKey = esc(p.partNo);
              return `
                <tr class="hover:bg-slate-50">
                  <td class="py-2 px-3">
                    <div class="flex items-center gap-1.5">
                      <img loading="lazy" decoding="async" onclick="openProductZoomByPartNo('${safeKey}')" title="Click to zoom &amp; inspect" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" class="w-10 h-10 rounded-lg object-cover border border-slate-200 hover:border-brand-blue shrink-0 cursor-zoom-in" alt="" />
                      ${
                        angleCount > 1
                          ? `<span class="bg-blue-50 text-brand-blue border border-blue-200 px-1.5 py-0.5 rounded text-[10px] font-bold">${angleCount} views</span>`
                          : ''
                      }
                    </div>
                  </td>
                  <td class="py-2 px-3">
                    <button type="button" onclick="openAdminPartActions('${safeKey}')" title="Click to open part options" class="font-mono font-bold text-brand-orange hover:bg-brand-orange hover:text-white bg-orange-50 border border-orange-200 px-2 py-0.5 rounded transition cursor-pointer">
                      ${safeKey} &rsaquo;
                    </button>
                  </td>
                  <td onclick="openAdminPartActions('${safeKey}')" class="py-2 px-3 font-semibold text-slate-800 hover:text-brand-blue max-w-xs cursor-pointer">
                    <div class="truncate">${esc(p.name)}</div>
                    <span class="text-[10px] text-slate-400">${esc(p.brand || 'OEM')}</span>
                  </td>
                  <td class="py-2 px-3 text-slate-600">${esc(p.pg)} &bull; ${esc(p.hierarchy)}<span class="block text-[10px] font-bold text-brand-blue">${esc(p.location || 'Location 1')} &bull; Stock: ${Number(p.stockQty || 0)} ${esc(p.uom || 'NOS')}</span></td>
                  <td class="py-2 px-3 font-mono">${money(p.mrp)} / ${money(p.dealerPrice || p.mrp)}</td>
                  <td class="py-2 px-3">${
                    p.isLive
                      ? '<span class="bg-blue-50 text-brand-blue border border-blue-200 px-2 py-0.5 rounded-full text-[10px] font-bold">Live DB</span>'
                      : '<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-semibold">Catalogue</span>'
                  }</td>
                  <td class="py-2 px-3 text-right whitespace-nowrap">
                    <div class="inline-flex items-center gap-1.5">
                      <button type="button" onclick="startEditProduct('${safeKey}')" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-brand-blue text-brand-blue hover:text-white border border-blue-200 font-bold text-[11px] transition cursor-pointer">
                        Edit
                      </button>
                      <button type="button" onclick="removeProduct('${safeKey}')" class="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 font-bold text-[11px] transition cursor-pointer">
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;

  wrap.innerHTML = mobileCardsHtml + desktopTableHtml;
}

function openAdminPartActions(partNoKey) {
  // Opens the interactive Product Detail Modal with all options (Zoom Angles, Description, Edit in Studio, Add to Cart)
  openProductDetail(partNoKey);
}

async function removeProduct(partNoKey) {
  const p = products.find(x => String(x.partNo).toUpperCase() === String(partNoKey).toUpperCase());
  if (!p) return;
  if (!confirm(`Remove "${p.partNo} — ${p.name}" from the active store?`)) return;

  try {
    const res = await fetch(`${API_BASE}/parts/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({
        id: p.isLive ? p.id : 0,
        partNo: p.partNo,
        name: p.name,
        pg: p.pg,
        hierarchy: p.hierarchy,
        brand: p.brand
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not remove product');

    showToast(`Removed ${p.partNo} from store`);
    await loadCatalogueData();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// Enquiries List & Navigation
// ---------------------------------------------------------------------------
async function loadEnquiriesList() {
  if (!authState.token) return;
  const target = authState.role === 'admin' ? $('#adminEnquiriesTable') : $('#dealerEnquiriesTable');
  if (!target) return;

  target.innerHTML = '<p class="py-4 text-slate-500">Loading enquiries...</p>';
  try {
    const res = await fetch(`${API_BASE}/enquiries`, {
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load enquiries');

    const rows = data.enquiries || [];
    target.innerHTML = rows.length
      ? `
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
              <th class="py-2.5 px-3">Ref</th>
              <th class="py-2.5 px-3">Company / Dealer</th>
              <th class="py-2.5 px-3">Contact</th>
              <th class="py-2.5 px-3">Items</th>
              <th class="py-2.5 px-3">Status</th>
              <th class="py-2.5 px-3">Date</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows
              .map(
                r => `
              <tr>
                <td class="py-2.5 px-3 font-mono font-bold text-brand-blue">${esc(r.ref)}</td>
                <td class="py-2.5 px-3 font-semibold text-slate-800">${esc(r.companyName || r.dealerCode || 'Walk-in')}</td>
                <td class="py-2.5 px-3">${esc(r.contactName || '—')} ${r.contactPhone ? `(${esc(r.contactPhone)})` : ''}</td>
                <td class="py-2.5 px-3 font-mono">${r.totalItems} NOS (${(r.items || []).length} SKUs)</td>
                <td class="py-2.5 px-3"><span class="bg-orange-50 text-brand-orange border border-orange-200 px-2 py-0.5 rounded-full font-bold text-[10px]">${esc(r.status)}</span></td>
                <td class="py-2.5 px-3 text-slate-500">${new Date(r.createdAt).toLocaleString('en-IN')}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      : '<p class="py-4 text-slate-500">No enquiries submitted yet.</p>';
  } catch (err) {
    target.innerHTML = `<p class="py-4 text-rose-600">${esc(err.message)}</p>`;
  }
}

function switchView(view) {
  if (view === 'admin') {
    if (authState.role !== 'admin' || !authState.token) {
      openAdminPortal();
      return;
    }
    $('#storeView').classList.add('hidden');
    $('#adminView').classList.remove('hidden');
    renderAdminPartsTable();
    loadAdminUsers();
  } else {
    $('#adminView').classList.add('hidden');
    $('#storeView').classList.remove('hidden');
    if ($('#corporateFrontPage') && $('#shopPortalView')) {
      $('#corporateFrontPage').classList.remove('hidden');
      $('#shopPortalView').classList.add('hidden');
    }
    if (authState.role === 'dealer' && authState.token) {
      $('#dealerEnquiriesBox').classList.remove('hidden');
      loadEnquiriesList();
    } else {
      $('#dealerEnquiriesBox').classList.add('hidden');
    }
  }
}

function switchAdminTab(tab) {
  $('#adminPanelSingle').classList.toggle('hidden', tab !== 'single');
  $('#adminPanelExcel').classList.toggle('hidden', tab !== 'excel');
  $('#adminPanelEnquiries').classList.toggle('hidden', tab !== 'enquiries');
  $('#adminPanelUsers').classList.toggle('hidden', tab !== 'users');

  const activeCls = 'px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-brand-blue text-white shadow-xs shrink-0 cursor-pointer';
  const idleCls = 'px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shrink-0 cursor-pointer';

  $('#adminTabSingle').className = tab === 'single' ? activeCls : idleCls;
  $('#adminTabExcel').className = tab === 'excel' ? activeCls : idleCls;
  $('#adminTabEnq').className = tab === 'enquiries' ? activeCls : idleCls;
  $('#adminTabUsers').className = tab === 'users' ? activeCls : idleCls;

  if (tab === 'enquiries') loadEnquiriesList();
  if (tab === 'users') loadAdminUsers();
}

function openCart() {
  $('#overlay').classList.remove('hidden');
  $('#cartDrawer').style.right = '0px';
  pushOverlayHistoryState('enquiry-cart');
}

function closeAllOverlays(skipHistory = false) {
  const lb = $('#imageZoomLightbox');
  if (lb) {
    lb.classList.add('hidden');
    lb.classList.remove('flex');
  }
  $('#overlay').classList.add('hidden');
  $('#cartDrawer').style.right = '-420px';
  $('#productDetailModal').classList.add('hidden');
  $('#productDetailModal').classList.remove('flex');
  $('#dealerModal').classList.add('hidden');
  $('#dealerModal').classList.remove('flex');
  $('#adminModal').classList.add('hidden');
  $('#adminModal').classList.remove('flex');
  if (!skipHistory) {
    clearOverlayHistoryState();
  }
}

function bindEvents() {
  $('#searchInput').addEventListener('input', () => {
    page = 1;
    renderCatalog();
    renderSuggestions(true);
  });
  $('#searchInput').addEventListener('focus', () => renderSuggestions(true));
  $('#searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('#suggestions button');
      if (first) {
        e.preventDefault();
        first.click();
      }
    } else if (e.key === 'Escape') {
      $('#suggestions').classList.add('hidden');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#suggestions') && e.target.id !== 'searchInput') {
      $('#suggestions').classList.add('hidden');
    }
    const menuDrawer = $('#corporateMenuDrawer');
    if (menuDrawer && !menuDrawer.classList.contains('hidden') && !e.target.closest('header')) {
      menuDrawer.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const menuDrawer = $('#corporateMenuDrawer');
      if (menuDrawer && !menuDrawer.classList.contains('hidden')) {
        menuDrawer.classList.add('hidden');
      }
    }
  });

  $('#hierarchyFilter').addEventListener('change', e => {
    activeHierarchy = e.target.value;
    page = 1;
    renderCatalog();
  });

  $('#adminCamInput').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleAdminCameraFile(e.target.files[0]);
    }
  });

  const thumbInp = $('#adminThumbInput');
  if (thumbInp) {
    thumbInp.addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) {
        handleCustomThumbnailFile(e.target.files[0]);
      }
    });
  }
  const thumbCamInp = $('#adminThumbCamInput');
  if (thumbCamInp) {
    thumbCamInp.addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) {
        handleCustomThumbnailFile(e.target.files[0]);
      }
    });
  }

  $('#adminGalleryInput').addEventListener('change', e => {
    if (e.target.files && e.target.files.length > 0) {
      handleAdminGalleryFiles(e.target.files);
    }
  });
  const galCamInp = $('#adminGalleryCamInput');
  if (galCamInp) {
    galCamInp.addEventListener('change', e => {
      if (e.target.files && e.target.files.length) handleAdminGalleryFiles(e.target.files);
    });
  }

  $('#excelFileInput').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleExcelFile(e.target.files[0]);
    }
  });

  const fPartNoEl = $('#fPartNo');
  if (fPartNoEl) {
    fPartNoEl.addEventListener('change', checkPartNoAutoMerge);
    fPartNoEl.addEventListener('blur', checkPartNoAutoMerge);
  }
  const fStockQtyEl = $('#fStockQty');
  if (fStockQtyEl) {
    fStockQtyEl.addEventListener('input', () => {
      if (!$('#fEditId').value && !$('#existingPartMatchBanner').classList.contains('hidden')) {
        checkPartNoAutoMerge();
      }
    });
  }
}

window.switchView = switchView;
function triggerCustomThumbnailCamera() {
  if (authState.role !== 'admin' || !authState.token) return;
  const inp = $('#adminThumbCamInput');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function triggerAdminGalleryCamera() {
  if (authState.role !== 'admin' || !authState.token) return;
  const inp = $('#adminGalleryCamInput');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

window.openAdminPortal = openAdminPortal;
window.switchAdminTab = switchAdminTab;
window.openDealerAuth = openDealerAuth;
window.switchDealerTab = switchDealerTab;
window.setDealerLoginMode = setDealerLoginMode;
window.switchAdminAuthTab = switchAdminAuthTab;
window.requestOtpFlow = requestOtpFlow;
window.submitDealerRegister = submitDealerRegister;
window.copyGeneratedCredentials = copyGeneratedCredentials;
window.submitPasswordReset = submitPasswordReset;
window.submitDealerLogin = submitDealerLogin;
window.submitAdminLogin = submitAdminLogin;
window.logoutSession = logoutSession;
window.loadAdminUsers = loadAdminUsers;
window.toggleDealerAccount = toggleDealerAccount;
window.saveAdminRecoveryProfile = saveAdminRecoveryProfile;
window.setHeroSlide = setHeroSlide;
window.setCatalogLayout = setCatalogLayout;
window.clearSearch = clearSearch;
window.resetAllFilters = resetAllFilters;
window.goPage = goPage;
window.openProductDetail = openProductDetail;
window.selectProductDetailAngle = selectProductDetailAngle;
window.stepProductDetailAngle = stepProductDetailAngle;
window.adjustProductDetailQty = adjustProductDetailQty;
window.addProductDetailToCart = addProductDetailToCart;
window.editFromProductDetail = editFromProductDetail;
window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeCartItem = removeCartItem;
window.openCart = openCart;
window.closeAllOverlays = closeAllOverlays;
window.submitEnquiry = submitEnquiry;
window.triggerAdminCamera = triggerAdminCamera;
window.toggleEnhanceComparison = toggleEnhanceComparison;
window.uploadAndScanAdminPhoto = uploadAndScanAdminPhoto;
window.clearAdminOcrPhotoOnly = clearAdminOcrPhotoOnly;
window.triggerCustomThumbnailPicker = triggerCustomThumbnailPicker;
window.clearCustomThumbnail = clearCustomThumbnail;
window.triggerAdminGalleryPicker = triggerAdminGalleryPicker;
window.setPrimaryGalleryAngle = setPrimaryGalleryAngle;
window.updateGalleryAngleLabel = updateGalleryAngleLabel;
window.removeGalleryAngle = removeGalleryAngle;
window.startEditProduct = startEditProduct;
window.removeProduct = removeProduct;
window.savePartMaster = savePartMaster;
window.resetAdminForm = resetAdminForm;
window.downloadExcelTemplate = downloadExcelTemplate;
window.exportCatalogToExcel = exportCatalogToExcel;
window.triggerCustomThumbnailCamera = triggerCustomThumbnailCamera;
window.triggerAdminGalleryCamera = triggerAdminGalleryCamera;
window.triggerExcelPicker = triggerExcelPicker;
window.clearExcelPreview = clearExcelPreview;
window.uploadExcelRowsToDb = uploadExcelRowsToDb;
window.loadEnquiriesList = loadEnquiriesList;
window.loadCatalogueData = loadCatalogueData;
window.renderAdminPartsTable = renderAdminPartsTable;

// ---------------------------------------------------------------------------
// INTERACTIVE IMAGE ZOOM LIGHTBOX (2-Finger Drag Zoom In/Out + 1-Finger Pan)
// ---------------------------------------------------------------------------
let zoomState = {
  angles: [],
  index: 0,
  scale: 1.0,
  tx: 0,
  ty: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  isTwoFingerZoom: false,
  twoFingerStartDist: 0,
  twoFingerStartMidY: 0,
  twoFingerStartMidX: 0,
  twoFingerStartScale: 1.0
};

function buildAnglesForProduct(p) {
  const angles = [];
  if (Array.isArray(p.gallery) && p.gallery.length > 0) {
    p.gallery.forEach((g, i) => {
      if (g.url || g.thumbUrl) {
        angles.push({
          url: g.url || g.thumbUrl,
          thumbUrl: g.thumbUrl || g.url,
          label: g.label || (i === 0 ? 'Front / Primary' : `Angle ${i + 1}`)
        });
      }
    });
  }
  if (!angles.length && (p.imageUrl || p.thumbnailUrl)) {
    angles.push({
      url: p.imageUrl || p.thumbnailUrl,
      thumbUrl: p.thumbnailUrl || p.imageUrl,
      label: 'Front / Primary'
    });
  }
  if (!angles.length) {
    const fb = fallbackImageFor(p);
    angles.push({ url: fb, thumbUrl: fb, label: 'Catalogue Reference' });
  }
  return angles;
}

function openProductZoomByPartNo(partNoKey) {
  const p = products.find(x => String(x.partNo).toUpperCase() === String(partNoKey).toUpperCase());
  if (!p) return;
  openImageZoomLightbox({
    angles: buildAnglesForProduct(p),
    startIndex: 0,
    initialScale: 1.0
  });
}

function openProductDetailZoom() {
  if (!detailProduct || !detailAngles.length) return;
  openImageZoomLightbox({
    angles: detailAngles,
    startIndex: detailAngleIndex,
    initialScale: 1.0
  });
}

function openAdminStep1Zoom() {
  if (!pendingAdminBlob) return;
  const srcUrl = showingEnhancedPreview ? pendingAdminBlob.enhancedDataUrl : pendingAdminBlob.originalDataUrl;
  openImageZoomLightbox({
    angles: [{ url: srcUrl, thumbUrl: srcUrl, label: 'Preview' }],
    startIndex: 0,
    initialScale: 1.0
  });
}

function openAdminGalleryZoom(startIndex = 0) {
  if (!adminGalleryItems.length) return;
  openImageZoomLightbox({
    angles: adminGalleryItems.map((g, i) => ({
      url: g.url || g.thumbUrl,
      thumbUrl: g.thumbUrl || g.url,
      label: g.label || (i === 0 ? 'Front / Primary' : `Angle ${i + 1}`)
    })),
    startIndex,
    initialScale: 1.0
  });
}

function openImageZoomLightbox({ angles, startIndex = 0, initialScale = 1.0 }) {
  if (!angles || !angles.length) return;
  zoomState.angles = angles;
  zoomState.index = Math.max(0, Math.min(startIndex, angles.length - 1));
  zoomState.scale = initialScale;
  zoomState.tx = 0;
  zoomState.ty = 0;
  zoomState.isDragging = false;
  zoomState.isTwoFingerZoom = false;

  renderZoomAngle();

  const lb = $('#imageZoomLightbox');
  lb.classList.remove('hidden');
  lb.classList.add('flex');
  pushOverlayHistoryState('zoom-view');
}

function closeImageZoom() {
  const lb = $('#imageZoomLightbox');
  if (!lb || lb.classList.contains('hidden')) return;
  lb.classList.add('hidden');
  lb.classList.remove('flex');
  clearOverlayHistoryState();
}

function renderZoomAngle() {
  const current = zoomState.angles[zoomState.index] || zoomState.angles[0];
  if (!current) return;

  const img = $('#zoomImg');
  img.src = current.url;

  const multi = zoomState.angles.length > 1;
  $('#zoomPrevBtn').classList.toggle('hidden', !multi);
  $('#zoomNextBtn').classList.toggle('hidden', !multi);

  const bar = $('#zoomThumbsBar');
  if (multi) {
    bar.classList.remove('hidden');
    bar.innerHTML = zoomState.angles
      .map(
        (a, i) => `
        <button type="button" onclick="selectZoomAngle(${i})" class="shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition cursor-pointer ${
          i === zoomState.index ? 'border-brand-orange scale-105' : 'border-slate-700 opacity-65 hover:opacity-100'
        }">
          <img loading="lazy" decoding="async" src="${esc(a.thumbUrl || a.url)}" class="w-full h-full object-cover" alt="${esc(a.label)}" />
        </button>`
      )
      .join('');
  } else {
    bar.classList.add('hidden');
  }

  applyZoomTransform(true);
}

function selectZoomAngle(idx) {
  if (idx < 0 || idx >= zoomState.angles.length) return;
  zoomState.index = idx;
  zoomState.scale = 1.0;
  zoomState.tx = 0;
  zoomState.ty = 0;
  renderZoomAngle();
}

function stepZoomAngle(delta) {
  if (zoomState.angles.length <= 1) return;
  zoomState.index = (zoomState.index + delta + zoomState.angles.length) % zoomState.angles.length;
  zoomState.scale = 1.0;
  zoomState.tx = 0;
  zoomState.ty = 0;
  renderZoomAngle();
}

function applyZoomTransform(animate = false) {
  const img = $('#zoomImg');
  if (!img) return;
  if (zoomState.scale <= 1.02) {
    zoomState.scale = 1.0;
    zoomState.tx = 0;
    zoomState.ty = 0;
  }
  img.style.transition = animate ? 'transform 0.16s ease-out' : 'none';
  img.style.transform = `translate3d(${zoomState.tx}px, ${zoomState.ty}px, 0) scale(${zoomState.scale})`;
  const badge = $('#zoomLevelBadge');
  if (badge) badge.textContent = `${zoomState.scale.toFixed(1)}×`;
}

function resetZoomTransform() {
  zoomState.scale = 1.0;
  zoomState.tx = 0;
  zoomState.ty = 0;
  applyZoomTransform(true);
}

function getTouchPairMetrics(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return {
    dist: Math.max(10, Math.hypot(dx, dy)),
    midX: (t1.clientX + t2.clientX) * 0.5,
    midY: (t1.clientY + t2.clientY) * 0.5
  };
}

function initZoomViewportControls() {
  const vp = $('#zoomViewport');
  if (!vp) return;

  // Desktop mouse drag (pan when zoomed) & wheel zoom
  vp.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    zoomState.isDragging = true;
    zoomState.startX = e.clientX - zoomState.tx;
    zoomState.startY = e.clientY - zoomState.ty;
    applyZoomTransform(false);
  });

  window.addEventListener('mousemove', e => {
    if (!zoomState.isDragging) return;
    if (zoomState.scale > 1) {
      zoomState.tx = e.clientX - zoomState.startX;
      zoomState.ty = e.clientY - zoomState.startY;
      applyZoomTransform(false);
    }
  });

  window.addEventListener('mouseup', () => {
    zoomState.isDragging = false;
  });

  vp.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.3 : -0.3;
      zoomState.scale = Math.max(1.0, Math.min(5.0, Number((zoomState.scale + delta).toFixed(2))));
      applyZoomTransform(false);
    },
    { passive: false }
  );

  // Mobile touch: 1 finger pans when zoomed, 2-finger drag (up/down or pinch) zooms IN & OUT smoothly
  vp.addEventListener(
    'touchstart',
    e => {
      if (e.target.closest('button')) return;
      if (e.touches.length === 1) {
        zoomState.isTwoFingerZoom = false;
        zoomState.isDragging = true;
        zoomState.startX = e.touches[0].clientX - zoomState.tx;
        zoomState.startY = e.touches[0].clientY - zoomState.ty;
      } else if (e.touches.length >= 2) {
        zoomState.isDragging = false;
        zoomState.isTwoFingerZoom = true;
        const m = getTouchPairMetrics(e.touches[0], e.touches[1]);
        zoomState.twoFingerStartDist = m.dist;
        zoomState.twoFingerStartMidX = m.midX;
        zoomState.twoFingerStartMidY = m.midY;
        zoomState.twoFingerStartScale = zoomState.scale;
      }
    },
    { passive: true }
  );

  vp.addEventListener(
    'touchmove',
    e => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        const m = getTouchPairMetrics(e.touches[0], e.touches[1]);
        const pinchRatio = m.dist / Math.max(10, zoomState.twoFingerStartDist);
        // Two-finger vertical/horizontal drag delta: dragging UP (negative deltaY) or RIGHT zooms IN; DOWN or LEFT zooms OUT
        const dragZoomDelta = ((zoomState.twoFingerStartMidY - m.midY) + (m.midX - zoomState.twoFingerStartMidX)) / 140;
        const nextScale = zoomState.twoFingerStartScale * pinchRatio + dragZoomDelta;
        zoomState.scale = Math.max(1.0, Math.min(5.0, Number(nextScale.toFixed(2))));
        applyZoomTransform(false);
      } else if (e.touches.length === 1 && zoomState.isDragging && !zoomState.isTwoFingerZoom) {
        if (zoomState.scale > 1) {
          e.preventDefault();
          zoomState.tx = e.touches[0].clientX - zoomState.startX;
          zoomState.ty = e.touches[0].clientY - zoomState.startY;
          applyZoomTransform(false);
        }
      }
    },
    { passive: false }
  );

  vp.addEventListener('touchend', e => {
    if (e.touches.length < 2) {
      zoomState.isTwoFingerZoom = false;
    }
    if (e.touches.length === 0) {
      zoomState.isDragging = false;
    }
  });

  document.addEventListener('keydown', e => {
    const lb = $('#imageZoomLightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeImageZoom();
    else if (e.key === 'ArrowRight') stepZoomAngle(1);
    else if (e.key === 'ArrowLeft') stepZoomAngle(-1);
  });
}

document.addEventListener('DOMContentLoaded', initZoomViewportControls);

window.openProductZoomByPartNo = openProductZoomByPartNo;
window.openProductDetailZoom = openProductDetailZoom;
window.openAdminStep1Zoom = openAdminStep1Zoom;
window.openAdminGalleryZoom = openAdminGalleryZoom;
window.closeImageZoom = closeImageZoom;
window.selectZoomAngle = selectZoomAngle;
window.stepZoomAngle = stepZoomAngle;
window.resetZoomTransform = resetZoomTransform;

// ---------------------------------------------------------------------------
// PHONE / BROWSER BACK-BUTTON INTEGRATION (Prevents Accidental Site Exit)
// ---------------------------------------------------------------------------
let _closingFromPopstate = false;

function pushOverlayHistoryState(layerName) {
  try {
    if (!window.history || !window.history.pushState) return;
    if (window.history.state && window.history.state.saplLayer === layerName) return;
    window.history.pushState({ saplLayer: layerName }, '', `#${layerName}`);
  } catch (e) {}
}

function clearOverlayHistoryState() {
  try {
    if (_closingFromPopstate) return;
    if (window.history && window.history.state && window.history.state.saplLayer) {
      window.history.back();
    }
  } catch (e) {}
}

function handleUiBackButton() {
  const zoomLb = $('#imageZoomLightbox');
  if (zoomLb && !zoomLb.classList.contains('hidden')) {
    closeImageZoom();
    return;
  }
  if (window.history && window.history.state && window.history.state.saplLayer) {
    window.history.back();
  } else {
    closeAllOverlays(true);
  }
}

window.addEventListener('popstate', () => {
  _closingFromPopstate = true;
  try {
    const zoomLb = $('#imageZoomLightbox');
    if (zoomLb && !zoomLb.classList.contains('hidden')) {
      zoomLb.classList.add('hidden');
      zoomLb.classList.remove('flex');
      return;
    }
    closeAllOverlays(true);
  } finally {
    setTimeout(() => {
      _closingFromPopstate = false;
    }, 30);
  }
});

window.handleUiBackButton = handleUiBackButton;
window.openAdminPartActions = openAdminPartActions;

// ---------------------------------------------------------------------------
// CORPORATE FRONT PAGE: Vendor Partner Filter & Branch Network Tabs
// ---------------------------------------------------------------------------
function filterByVendorBrand(brandName) {
  switchView('store');
  activePG = 'ALL';
  activeHierarchy = 'ALL';
  const searchEl = $('#searchInput');
  if (searchEl) {
    searchEl.value = brandName;
  }
  page = 1;
  buildPG();
  updateHierarchy();
  renderCatalog();
  const catSec = $('#catalogSection');
  if (catSec) {
    catSec.scrollIntoView({ behavior: 'smooth' });
  }
  showToast(`Showing ${brandName} commercial parts`);
}

function filterBranches(stateCode) {
  const cards = $$('#branchCardsGrid .branch-card');
  cards.forEach(card => {
    const match = stateCode === 'ALL' || card.dataset.state === stateCode;
    card.classList.toggle('hidden', !match);
  });

  const activeCls = 'px-3.5 py-1.5 rounded-md bg-[#0B4F9F] text-white cursor-pointer';
  const idleCls = 'px-3.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 cursor-pointer';

  const tAll = $('#brTabAll');
  const tCG = $('#brTabCG');
  const tMP = $('#brTabMP');
  if (tAll) tAll.className = stateCode === 'ALL' ? activeCls : idleCls;
  if (tCG) tCG.className = stateCode === 'CG' ? activeCls : idleCls;
  if (tMP) tMP.className = stateCode === 'MP' ? activeCls : idleCls;
}

window.filterByVendorBrand = filterByVendorBrand;
window.filterBranches = filterBranches;

function filterByPG(pgCode) {
  switchView('store');
  activePG = pgCode || 'ALL';
  activeHierarchy = 'ALL';
  page = 1;
  $('#kpiPgLabel').textContent = activePG === 'ALL' ? 'PG1–PG6' : activePG;
  buildPG();
  updateHierarchy();
  renderCatalog();
  const catSec = $('#catalogSection');
  if (catSec) catSec.scrollIntoView({ behavior: 'smooth' });
}
window.filterByPG = filterByPG;

// ---------------------------------------------------------------------------
// DEDICATED SHOP NOW PORTAL NAVIGATION (Sign-In Gated)
// ---------------------------------------------------------------------------
let _pendingShopRedirect = null;

function _enterShopPortalNow() {
  $('#adminView').classList.add('hidden');
  $('#storeView').classList.remove('hidden');
  if ($('#corporateFrontPage')) $('#corporateFrontPage').classList.add('hidden');
  if ($('#shopPortalView')) $('#shopPortalView').classList.remove('hidden');
  if (authState.role === 'dealer' && authState.token) {
    $('#dealerEnquiriesBox').classList.remove('hidden');
    loadEnquiriesList();
  } else {
    $('#dealerEnquiriesBox').classList.add('hidden');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function _isStorefrontSignedIn() {
  return Boolean(authState.token && authState.role === 'dealer');
}

function openShopPortal() {
  if (!_isStorefrontSignedIn()) {
    _pendingShopRedirect = () => _enterShopPortalNow();
    const notice = $('#signInGateNotice');
    if (notice) notice.classList.remove('hidden');
    openDealerAuth('login');
    return;
  }
  const notice = $('#signInGateNotice');
  if (notice) notice.classList.add('hidden');
  _enterShopPortalNow();
}

function openCorporateHome() {
  switchView('store');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openShopPortalWithBrand(brandName) {
  const applyBrand = () => {
    _enterShopPortalNow();
    activePG = 'ALL';
    activeHierarchy = 'ALL';
    const searchEl = $('#searchInput');
    if (searchEl) searchEl.value = brandName || '';
    page = 1;
    buildPG();
    updateHierarchy();
    renderCatalog();
    if (brandName) showToast(`Showing ${brandName} in Shop Portal`);
  };
  if (!_isStorefrontSignedIn()) {
    _pendingShopRedirect = applyBrand;
    const notice = $('#signInGateNotice');
    if (notice) notice.classList.remove('hidden');
    openDealerAuth('login');
    return;
  }
  applyBrand();
}

function openShopPortalWithPG(pgCode) {
  const applyPG = () => {
    _enterShopPortalNow();
    activePG = pgCode || 'ALL';
    activeHierarchy = 'ALL';
    page = 1;
    $('#kpiPgLabel').textContent = activePG === 'ALL' ? 'PG1–PG6' : activePG;
    buildPG();
    updateHierarchy();
    renderCatalog();
  };
  if (!_isStorefrontSignedIn()) {
    _pendingShopRedirect = applyPG;
    const notice = $('#signInGateNotice');
    if (notice) notice.classList.remove('hidden');
    openDealerAuth('login');
    return;
  }
  applyPG();
}

window.openShopPortal = openShopPortal;
window.openCorporateHome = openCorporateHome;
window.openShopPortalWithBrand = openShopPortalWithBrand;
window.openShopPortalWithPG = openShopPortalWithPG;

// ---------------------------------------------------------------------------
// UNO MINDA HAMBURGER MENU & DISCREET STAFF ADMIN ACCESS
// ---------------------------------------------------------------------------
function toggleCorporateMenu() {
  const drawer = $('#corporateMenuDrawer');
  if (!drawer) return;
  drawer.classList.toggle('hidden');
}

let _staffTapCount = 0;
let _staffTapTimer = null;

function handleStaffSecretTap() {
  _staffTapCount += 1;
  clearTimeout(_staffTapTimer);
  _staffTapTimer = setTimeout(() => {
    _staffTapCount = 0;
  }, 1200);
  if (_staffTapCount >= 3) {
    _staffTapCount = 0;
    openAdminPortal();
  }
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
    e.preventDefault();
    openAdminPortal();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash === '#staff-admin') {
    openAdminPortal();
  }
});

window.toggleCorporateMenu = toggleCorporateMenu;
window.handleStaffSecretTap = handleStaffSecretTap;
