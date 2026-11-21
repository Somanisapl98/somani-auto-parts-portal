const API_BASE = 'https://func-sapl-parts-api-dev-h6fsevdbe3gfg7cx.centralindia-01.azurewebsites.net/api';

const HERO_4K_SLIDES = [
  {
    url: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=2560&q=90',
    kicker: 'Genuine Commercial Vehicle Spares & Lubricants'
  },
  {
    url: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=2560&q=90',
    kicker: 'TATA Motors • Eicher • Heavy-Duty Fleet Parts'
  },
  {
    url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=2560&q=90',
    kicker: 'Somani Auto Pvt. Ltd. • Raipur Wholesale & Dealer Store'
  }
];

let currentHeroIdx = 0;
let activeHeroLayer = 'A';

let products = [];
let hierarchy = {};
let cart = JSON.parse(localStorage.getItem('sapl_parts_cart') || '{}');
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

let pendingAdminBlob = null;
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
  let apiParts = [];
  let fallbackParts = [];
  let fallbackHierarchy = {};

  try {
    const res = await fetch(`${API_BASE}/parts`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.parts)) {
        apiParts = data.parts;
      }
    }
  } catch (err) {}

  try {
    const [pRes, hRes] = await Promise.all([
      fetch('data/products.json').then(r => (r.ok ? r.json() : [])),
      fetch('data/product-hierarchy.json').then(r => (r.ok ? r.json() : {}))
    ]);
    fallbackParts = Array.isArray(pRes) ? pRes : [];
    fallbackHierarchy = hRes || {};
  } catch (e) {}

  const byPartNo = new Map();
  apiParts.forEach(p => byPartNo.set(String(p.partNo).toUpperCase(), { ...p, isLive: true }));
  fallbackParts.forEach(p => {
    const key = String(p.partNo).toUpperCase();
    if (!byPartNo.has(key)) {
      byPartNo.set(key, { ...p, isLive: false });
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
        `${p.partNo} ${p.name} ${p.hierarchy} ${p.pg} ${p.brand || ''}`
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
  return p.thumbnailUrl || p.imageUrl || fallbackImageFor(p);
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
            const hasPhoto = Boolean(p.thumbnailUrl || p.imageUrl);
            const inCartQty = cart[String(p.id)] || 0;
            return `
              <article class="white-card rounded-2xl overflow-hidden flex flex-col shadow-2xs">
                <div class="relative aspect-[4/3] bg-slate-100 border-b border-slate-100 overflow-hidden">
                  <img loading="lazy" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" alt="${esc(p.name)}" class="w-full h-full object-cover" />
                  <span class="absolute top-2 left-2 bg-slate-900/85 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">${esc(p.pg)}</span>
                  ${
                    hasPhoto
                      ? '<span class="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">ACTUAL PHOTO</span>'
                      : ''
                  }
                </div>

                <div class="p-3 sm:p-4 flex flex-col flex-1">
                  <div class="flex items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span class="truncate">${esc(p.brand || 'OEM')}</span>
                    <span class="truncate text-brand-blue">${esc(p.hierarchy)}</span>
                  </div>

                  <h3 class="text-xs sm:text-sm font-bold text-slate-900 mt-1 line-clamp-2 leading-snug">
                    ${esc(p.name)}
                  </h3>

                  <div class="mt-2">
                    <span class="inline-block font-mono text-[11px] font-bold text-brand-orange bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md">
                      ${esc(p.partNo)}
                    </span>
                  </div>

                  <div class="mt-auto pt-3 border-t border-slate-100 flex items-end justify-between gap-2">
                    ${priceBlockHtml(p)}
                    <button type="button" onclick="addToCart('${esc(p.id)}')" class="bg-brand-blue hover:bg-brand-blueDark active:scale-95 text-white font-bold text-xs px-3 py-2 rounded-xl shadow-2xs transition shrink-0 cursor-pointer">
                      ${inCartQty > 0 ? `In Cart (${inCartQty})` : '+ Add'}
                    </button>
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
            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-4">
                  <div class="flex items-center gap-2.5">
                    <img src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" class="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" alt="" />
                    <span class="font-bold text-slate-900 text-xs sm:text-sm">${esc(p.name)}</span>
                  </div>
                </td>
                <td class="py-2.5 px-4"><span class="font-mono text-xs font-bold text-brand-orange bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">${esc(p.partNo)}</span></td>
                <td class="py-2.5 px-4 text-xs text-slate-600">${esc(p.pg)} &bull; ${esc(p.hierarchy)}</td>
                <td class="py-2.5 px-4 text-xs font-semibold text-slate-700">${esc(p.brand || 'OEM')}</td>
                <td class="py-2.5 px-4">${priceBlockHtml(p)}</td>
                <td class="py-2.5 px-4 text-right">
                  <button type="button" onclick="addToCart('${esc(p.id)}')" class="bg-brand-blue hover:bg-brand-blueDark text-white font-bold text-xs px-3 py-1.5 rounded-lg cursor-pointer">+ Add</button>
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
        <button type="button" data-id="${esc(p.id)}" class="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 flex items-center justify-between gap-2 cursor-pointer">
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
      const p = products.find(x => String(x.id) === String(btn.dataset.id));
      if (!p) return;
      $('#searchInput').value = p.partNo;
      activePG = p.pg;
      activeHierarchy = p.hierarchy;
      page = 1;
      buildPG();
      updateHierarchy();
      $('#hierarchyFilter').value = activeHierarchy;
      box.classList.add('hidden');
      renderCatalog();
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
// OTP Request, Dealer Self-Registration, Password Reset & Login Flows
// ---------------------------------------------------------------------------
function openDealerAuth(tab = 'login') {
  if (authState.token && authState.role === 'dealer') {
    if (confirm(`Signed in as Dealer ${authState.user}. Sign out?`)) {
      logoutSession();
    }
    return;
  }
  $('#overlay').classList.remove('hidden');
  $('#dealerModal').classList.remove('hidden');
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

  const active = 'py-2 rounded-lg bg-white text-brand-blue shadow-2xs cursor-pointer';
  const idle = 'py-2 rounded-lg text-slate-600 hover:text-slate-900 cursor-pointer';
  $('#dTabLogin').className = tab === 'login' ? active : idle;
  $('#dTabRegister').className = tab === 'register' ? active : idle;
  $('#dTabReset').className = tab === 'reset' ? active : idle;
}

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

  banner.textContent = 'Generating 6-digit OTP...';
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
      banner.innerHTML = `6-digit OTP sent to <strong>${esc(data.maskedEmail)}</strong> via ${esc((data.channels || []).join(', '))}. Valid for 10 minutes.`;
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
    switchView('store');
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
  const dealerBtn = $('#dealerBtn');
  const adminBtn = $('#adminBtn');

  if (authState.role === 'dealer' && authState.token) {
    dealerBtn.textContent = `Dealer: ${authState.user}`;
    adminBtn.textContent = 'Admin';
    $('#kpiTierLabel').textContent = authState.user;
    $('#kpiTierSub').textContent = `${authState.businessName || 'Dealer'} • Net rates active`;
  } else if (authState.role === 'admin' && authState.token) {
    adminBtn.textContent = 'Admin Studio';
    dealerBtn.textContent = 'Dealer Login';
    $('#kpiTierLabel').textContent = 'Admin Mode';
    $('#kpiTierSub').textContent = 'Backend Studio unlocked';
  } else {
    dealerBtn.textContent = 'Dealer Login';
    adminBtn.textContent = 'Admin';
    $('#kpiTierLabel').textContent = 'Public Store';
    $('#kpiTierSub').textContent = 'Sign in or register via OTP for net rates';
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
    const res = await fetch(`${API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    const data = await res.json();
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
    const res = await fetch(`${API_BASE}/admin/users/${id}/toggle`, {
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
    const res = await fetch(`${API_BASE}/admin/profile`, {
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
// E-Commerce Enquiry Cart
// ---------------------------------------------------------------------------
function addToCart(id) {
  const key = String(id);
  cart[key] = (cart[key] || 0) + 1;
  saveCart();
  updateCart();
  renderCatalog();
  showToast('Added to Enquiry Basket');
}

function changeQty(id, delta) {
  const key = String(id);
  cart[key] = Math.max(0, (cart[key] || 0) + delta);
  if (!cart[key]) delete cart[key];
  saveCart();
  updateCart();
  renderCatalog();
}

function removeCartItem(id) {
  delete cart[String(id)];
  saveCart();
  updateCart();
  renderCatalog();
}

function saveCart() {
  localStorage.setItem('sapl_parts_cart', JSON.stringify(cart));
}

function updateCart() {
  const entries = Object.entries(cart)
    .map(([id, qty]) => {
      const p = products.find(item => String(item.id) === String(id));
      return p ? { ...p, qty } : null;
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
            <span class="font-mono text-[11px] font-bold text-brand-orange">${esc(x.partNo)}</span>
            <p class="text-xs font-bold text-slate-900 truncate">${esc(x.name)}</p>
            <span class="text-[11px] text-slate-500">${esc(x.pg)} &bull; ${esc(x.brand || 'OEM')}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick="changeQty('${esc(x.id)}', -1)" class="w-7 h-7 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer">-</button>
            <span class="w-6 text-center text-xs font-mono font-bold">${x.qty}</span>
            <button type="button" onclick="changeQty('${esc(x.id)}', 1)" class="w-7 h-7 rounded-lg bg-white border border-slate-300 font-bold text-slate-700 cursor-pointer">+</button>
            <button type="button" onclick="removeCartItem('${esc(x.id)}')" class="ml-1 text-xs text-rose-600 font-bold cursor-pointer">&times;</button>
          </div>
        </div>`
        )
        .join('')
    : `<div class="py-12 text-center text-xs text-slate-500">Your enquiry cart is empty.<br>Tap <strong>+ Add</strong> on any part to request a quote.</div>`;
}

async function submitEnquiry() {
  const entries = Object.entries(cart)
    .map(([id, qty]) => {
      const p = products.find(item => String(item.id) === String(id));
      return p
        ? {
            partId: p.id,
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
    alert('Please add at least one part to your enquiry cart.');
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
// ADMIN-ONLY: Camera Capture + Compression + SAS Upload + Vision OCR
// ---------------------------------------------------------------------------
function compressImageFile(file, maxWidth = 1200, quality = 0.82) {
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
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.toBlob(
          blob => {
            if (!blob) return reject(new Error('Image compression failed'));
            resolve({
              blob,
              dataUrl,
              originalBytes: file.size,
              compressedBytes: blob.size,
              width: w,
              height: h
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
  statusBox.textContent = 'Compressing photo for fast warehouse upload...';

  try {
    const comp = await compressImageFile(file, 1200, 0.82);
    pendingAdminBlob = {
      blob: comp.blob,
      dataUrl: comp.dataUrl,
      fileName: file.name || 'part-label.jpg'
    };

    $('#adminPhotoPreview').src = comp.dataUrl;
    $('#adminPhotoPreview').classList.remove('hidden');
    $('#cameraPlaceholder').classList.add('hidden');

    $('#compressionStats').classList.remove('hidden');
    $('#compressionStats').textContent = `Compressed: ${comp.width}x${comp.height}px (${Math.round(
      comp.originalBytes / 1024
    )} KB -> ${Math.round(comp.compressedBytes / 1024)} KB)`;

    $('#btnUploadAndOcr').disabled = false;
    statusBox.textContent = 'Photo ready. Tap "Upload & Scan OCR" to auto-fill details.';
  } catch (err) {
    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700';
    statusBox.textContent = err.message;
  }
}

async function uploadAndScanAdminPhoto() {
  if (!pendingAdminBlob || authState.role !== 'admin' || !authState.token) return;

  const btn = $('#btnUploadAndOcr');
  const statusBox = $('#adminOcrStatus');
  btn.disabled = true;
  statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-blue-50 border border-blue-200 text-brand-blue';
  statusBox.classList.remove('hidden');

  try {
    statusBox.textContent = '1/3 Generating Azure Blob upload ticket...';
    const sasRes = await fetch(`${API_BASE}/uploads/sas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ fileName: pendingAdminBlob.fileName })
    });
    const sasData = await sasRes.json();
    if (!sasRes.ok || !sasData.ok) throw new Error(sasData.error || 'SAS ticket failed');

    statusBox.textContent = '2/3 Uploading compressed photo directly to stgsaplpartsdev...';
    const putRes = await fetch(sasData.uploadUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': 'image/jpeg'
      },
      body: pendingAdminBlob.blob
    });
    if (!putRes.ok) throw new Error(`Blob upload error (${putRes.status})`);

    $('#fBlobName').value = sasData.blobName;
    $('#fImageUrl').value = sasData.readUrl;

    statusBox.textContent = '3/3 Scanning label via Azure Computer Vision OCR...';
    const ocrRes = await fetch(`${API_BASE}/ocr/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({
        blobName: sasData.blobName,
        createThumbnail: true
      })
    });
    const ocrData = await ocrRes.json();
    if (!ocrRes.ok || !ocrData.ok) throw new Error(ocrData.error || 'Vision OCR failed');

    const ext = ocrData.extracted || {};
    if (ext.thumbnailUrl) $('#fThumbnailUrl').value = ext.thumbnailUrl;
    if (ext.partNo) $('#fPartNo').value = ext.partNo;
    if (ext.name) $('#fName').value = ext.name;
    if (ext.brand) $('#fBrand').value = ext.brand;
    if (ext.pg) $('#fPG').value = ext.pg;
    if (ext.hierarchy) $('#fHierarchy').value = ext.hierarchy;
    if (ext.mrp) {
      $('#fMrp').value = ext.mrp;
      $('#fDealerPrice').value = ext.mrp;
    }
    if (ext.stockQty) $('#fStockQty').value = ext.stockQty;
    if (ext.uom) $('#fUom').value = ext.uom;

    if (ext.rawText) {
      $('#adminOcrRawWrap').classList.remove('hidden');
      $('#adminOcrRawText').textContent = ext.rawText;
    }

    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700';
    statusBox.textContent = 'Label scanned & fields auto-filled! Verify below and click Save.';
  } catch (err) {
    statusBox.className = 'rounded-xl px-3.5 py-2.5 text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700';
    statusBox.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function savePartMaster(e) {
  e.preventDefault();
  if (authState.role !== 'admin' || !authState.token) return;

  const btn = $('#btnSavePart');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const payload = {
    partNo: $('#fPartNo').value.trim().toUpperCase(),
    name: $('#fName').value.trim(),
    pg: $('#fPG').value,
    hierarchy: $('#fHierarchy').value.trim() || 'General',
    brand: $('#fBrand').value.trim() || 'TATA / OEM',
    mrp: parseFloat($('#fMrp').value || '0'),
    dealerPrice: parseFloat($('#fDealerPrice').value || '0'),
    stockQty: parseInt($('#fStockQty').value || '0', 10),
    uom: $('#fUom').value,
    blobName: $('#fBlobName').value || null,
    imageUrl: $('#fImageUrl').value || null,
    thumbnailUrl: $('#fThumbnailUrl').value || $('#fImageUrl').value || null,
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

    showToast(`Saved ${payload.partNo} to live catalogue!`);
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
  $('#fBlobName').value = '';
  $('#fThumbnailUrl').value = '';
  $('#fImageUrl').value = '';
  pendingAdminBlob = null;
  $('#adminPhotoPreview').classList.add('hidden');
  $('#cameraPlaceholder').classList.remove('hidden');
  $('#compressionStats').classList.add('hidden');
  $('#adminOcrRawWrap').classList.add('hidden');
  $('#adminOcrStatus').classList.add('hidden');
  $('#btnUploadAndOcr').disabled = true;
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
      'UOM': 'NOS'
    }
  ];
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parts_Upload');
  XLSX.writeFile(wb, 'Somani_Auto_Parts_Template.xlsx');
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

        parsedExcelParts.push({ partNo, name, pg, hierarchy, brand, mrp, dealerPrice, stockQty, uom });
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
  const rows = products.slice(0, 40);
  wrap.innerHTML = rows.length
    ? `
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
            <th class="py-2.5 px-3">Photo</th>
            <th class="py-2.5 px-3">Part No</th>
            <th class="py-2.5 px-3">Description</th>
            <th class="py-2.5 px-3">PG / Hierarchy</th>
            <th class="py-2.5 px-3">MRP / Dealer</th>
            <th class="py-2.5 px-3">Source</th>
            <th class="py-2.5 px-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows
            .map(p => {
              const fallback = fallbackImageFor(p);
              return `
                <tr class="hover:bg-slate-50">
                  <td class="py-2 px-3"><img src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" class="w-9 h-9 rounded-lg object-cover border border-slate-200" alt="" /></td>
                  <td class="py-2 px-3 font-mono font-bold text-brand-orange">${esc(p.partNo)}</td>
                  <td class="py-2 px-3 font-semibold text-slate-800">${esc(p.name)}<br><span class="text-[10px] text-slate-400">${esc(p.brand || 'OEM')}</span></td>
                  <td class="py-2 px-3 text-slate-600">${esc(p.pg)} &bull; ${esc(p.hierarchy)}</td>
                  <td class="py-2 px-3 font-mono">${money(p.mrp)} / ${money(p.dealerPrice || p.mrp)}</td>
                  <td class="py-2 px-3">${
                    p.isLive
                      ? '<span class="bg-blue-50 text-brand-blue border border-blue-200 px-2 py-0.5 rounded-full text-[10px] font-bold">Live DB</span>'
                      : '<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-semibold">Seed</span>'
                  }</td>
                  <td class="py-2 px-3 text-right">
                    ${
                      p.isLive
                        ? `<button onclick="deleteDbPart(${p.id})" class="text-rose-600 hover:underline font-semibold cursor-pointer">Archive</button>`
                        : '<span class="text-slate-400">—</span>'
                    }
                  </td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
    : '<p class="py-6 text-center text-slate-500">No parts loaded yet.</p>';
}

async function deleteDbPart(id) {
  if (!confirm('Archive this part from the active store?')) return;
  try {
    const res = await fetch(`${API_BASE}/parts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    if (res.ok) {
      showToast('Part archived');
      await loadCatalogueData();
    }
  } catch (e) {}
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
}

function closeAllOverlays() {
  $('#overlay').classList.add('hidden');
  $('#cartDrawer').style.right = '-420px';
  $('#dealerModal').classList.add('hidden');
  $('#dealerModal').classList.remove('flex');
  $('#adminModal').classList.add('hidden');
  $('#adminModal').classList.remove('flex');
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

  $('#excelFileInput').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleExcelFile(e.target.files[0]);
    }
  });
}

window.switchView = switchView;
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
window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeCartItem = removeCartItem;
window.openCart = openCart;
window.closeAllOverlays = closeAllOverlays;
window.submitEnquiry = submitEnquiry;
window.triggerAdminCamera = triggerAdminCamera;
window.uploadAndScanAdminPhoto = uploadAndScanAdminPhoto;
window.savePartMaster = savePartMaster;
window.resetAdminForm = resetAdminForm;
window.downloadExcelTemplate = downloadExcelTemplate;
window.triggerExcelPicker = triggerExcelPicker;
window.clearExcelPreview = clearExcelPreview;
window.uploadExcelRowsToDb = uploadExcelRowsToDb;
window.deleteDbPart = deleteDbPart;
window.loadEnquiriesList = loadEnquiriesList;
window.loadCatalogueData = loadCatalogueData;
