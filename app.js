const API_BASE = 'https://func-sapl-parts-api-dev-h6fsevdbe3gfg7cx.centralindia-01.azurewebsites.net/api';

let products = [];
let hierarchy = {};
let cart = JSON.parse(localStorage.getItem('sapl_parts_cart') || '{}');
let activePG = 'ALL';
let activeHierarchy = 'ALL';
let displayMode = 'grid';
let page = 1;
const PAGE_SIZE = 24;

let authState = {
  token: sessionStorage.getItem('sapl_token') || '',
  role: sessionStorage.getItem('sapl_role') || '',
  user: sessionStorage.getItem('sapl_user') || '',
  loginMode: 'dealer'
};

let pendingAdminBlob = null;
let lastQuickOcrData = null;
let apiOnline = false;

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

// ---------------------------------------------------------------------------
// Initialization & Live Azure API Connection
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  updateAuthButtons();
  updateCart();
  bindEvents();
  checkApiHealth();
  loadCatalogueData();
});

async function checkApiHealth() {
  const pill = $('#apiStatusPill');
  const txt = $('#apiStatusText');
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    if (res.ok && data.ok) {
      apiOnline = true;
      pill.className = 'statusPill online';
      txt.textContent = 'Azure API Online';
      return;
    }
  } catch (e) {
    // Fallback mode when Function App code is not deployed yet
  }
  apiOnline = false;
  pill.className = 'statusPill offline';
  txt.textContent = 'Local Catalogue Mode';
}

async function loadCatalogueData() {
  let apiParts = [];
  let fallbackParts = [];
  let fallbackHierarchy = {};

  // 1. Try loading live parts from PostgreSQL via Azure Function App
  try {
    const res = await fetch(`${API_BASE}/parts`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.parts)) {
        apiParts = data.parts;
      }
    }
  } catch (err) {
    console.warn('Live API /parts unavailable, using local JSON fallback:', err);
  }

  // 2. Load local JSON catalogue as baseline/fallback
  try {
    const [pRes, hRes] = await Promise.all([
      fetch('data/products.json').then(r => (r.ok ? r.json() : [])),
      fetch('data/product-hierarchy.json').then(r => (r.ok ? r.json() : {}))
    ]);
    fallbackParts = Array.isArray(pRes) ? pRes : [];
    fallbackHierarchy = hRes || {};
  } catch (e) {
    fallbackParts = [];
  }

  // Merge live DB parts on top of fallback parts (deduplicating by partNo)
  const byPartNo = new Map();
  apiParts.forEach(p => byPartNo.set(String(p.partNo).toUpperCase(), { ...p, isLive: true }));
  fallbackParts.forEach(p => {
    const key = String(p.partNo).toUpperCase();
    if (!byPartNo.has(key)) {
      byPartNo.set(key, { ...p, isLive: false });
    }
  });

  products = Array.from(byPartNo.values());

  // Build dynamic hierarchy map combining JSON + live DB hierarchies
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

  $('#kpiTotalParts').textContent = products.length.toLocaleString('en-IN');
  $('#kpiDataSource').textContent =
    apiParts.length > 0
      ? `${apiParts.length} live DB records + ${products.length - apiParts.length} catalogue items`
      : 'Connected to local JSON catalogue';

  buildPG();
  updateHierarchy();
  render();
  renderAdminPartsTable();
}

// ---------------------------------------------------------------------------
// Catalogue Filtering, Rendering (Grid & MPMS Table)
// ---------------------------------------------------------------------------
function buildPG() {
  const groups = ['ALL', 'PG1', 'PG2', 'PG3', 'PG4', 'PG5', 'PG6'];
  $('#pgFilters').innerHTML = groups
    .map(
      g =>
        `<button class="${g === activePG ? 'active' : ''}" data-pg="${g}">${
          g === 'ALL' ? 'ALL PG' : g
        }</button>`
    )
    .join('');

  $$('#pgFilters button').forEach(btn => {
    btn.onclick = () => {
      activePG = btn.dataset.pg;
      activeHierarchy = 'ALL';
      page = 1;
      $('#kpiActivePG').textContent = activePG === 'ALL' ? 'ALL PG' : activePG;
      buildPG();
      updateHierarchy();
      render();
    };
  });
}

function updateHierarchy() {
  const list =
    activePG === 'ALL'
      ? [...new Set(Object.values(hierarchy).flat())].sort()
      : hierarchy[activePG] || [];

  $('#hierarchyFilter').innerHTML =
    '<option value="ALL">All product hierarchies</option>' +
    list.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');

  $('#hierarchyFilter').value = activeHierarchy;
  $('#kpiHierarchyCount').textContent = `${list.length} hierarchies available`;

  const dl = $('#hierarchyDatalist');
  if (dl) {
    dl.innerHTML = [...new Set(Object.values(hierarchy).flat())]
      .sort()
      .map(x => `<option value="${esc(x)}">`)
      .join('');
  }
}

function filtered() {
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

function formatPriceLabel(p) {
  if (authState.token && Number(p.dealerPrice || p.mrp) > 0) {
    return money(authState.role === 'dealer' ? p.dealerPrice || p.mrp : p.mrp);
  }
  if (Number(p.mrp) > 0) {
    return `MRP ${money(p.mrp)}`;
  }
  return 'ON REQUEST';
}

function setDisplayMode(mode) {
  displayMode = mode;
  $('#gridModeBtn').classList.toggle('active', mode === 'grid');
  $('#tableModeBtn').classList.toggle('active', mode === 'table');
  render();
}

function render() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const shown = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  $('#catalogSummary').innerHTML = `<b>${list.length.toLocaleString('en-IN')}</b> parts found${
    activePG !== 'ALL' ? ` in <strong>${esc(activePG)}</strong>` : ''
  }${activeHierarchy !== 'ALL' ? ` &bull; ${esc(activeHierarchy)}` : ''}`;

  const gridEl = $('#grid');
  const tableEl = $('#tableWrap');

  if (displayMode === 'grid') {
    gridEl.classList.remove('hidden');
    tableEl.classList.add('hidden');

    gridEl.innerHTML =
      shown
        .map(p => {
          const fallback = fallbackImageFor(p);
          const hasRealPhoto = Boolean(p.thumbnailUrl || p.imageUrl);
          return `
            <article class="card">
              <div class="visual">
                <img loading="lazy" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" alt="${esc(p.name)}">
                <span class="pgBadge">${esc(p.pg)}</span>
                ${hasRealPhoto ? '<span class="photoBadge">VERIFIED PHOTO</span>' : ''}
              </div>
              <div class="cardBody">
                <span class="tag">${esc(p.hierarchy)}</span>
                <h3>${esc(p.name)}</h3>
                <div class="code">${esc(p.partNo)}</div>
                <p class="meta">${esc(p.brand || 'OEM')} &bull; ${esc(p.pg)} &rarr; ${esc(p.hierarchy)}</p>
                <div class="priceRow">
                  <div>
                    <small>COMMERCIAL</small><br>
                    <b class="requestPrice">${formatPriceLabel(p)}</b>
                  </div>
                  <button class="btnPrimary sm" onclick="add('${esc(p.id)}')">ADD +</button>
                </div>
              </div>
            </article>
          `;
        })
        .join('') ||
      '<div class="noResults"><b>No matching part found</b><span>Try another part number, description, PG group or scan a label with your camera.</span></div>';
  } else {
    gridEl.classList.add('hidden');
    tableEl.classList.remove('hidden');

    tableEl.innerHTML = shown.length
      ? `
        <table class="mpmsTable">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Part Number</th>
              <th>Description</th>
              <th>PG</th>
              <th>Hierarchy</th>
              <th>Brand</th>
              <th>Commercial</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${shown
              .map(p => {
                const fallback = fallbackImageFor(p);
                return `
                  <tr>
                    <td><img class="thumbMini" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" alt=""></td>
                    <td><span class="code">${esc(p.partNo)}</span></td>
                    <td><strong>${esc(p.name)}</strong></td>
                    <td>${esc(p.pg)}</td>
                    <td>${esc(p.hierarchy)}</td>
                    <td>${esc(p.brand || 'OEM')}</td>
                    <td><strong>${formatPriceLabel(p)}</strong></td>
                    <td><button class="btnPrimary sm" onclick="add('${esc(p.id)}')">ADD +</button></td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `
      : '<div class="noResults"><b>No matching part found</b><span>Adjust your filters or scan a label.</span></div>';
  }

  $('#pagination').innerHTML =
    pages <= 1
      ? ''
      : `<button ${page === 1 ? 'disabled' : ''} onclick="goPage(${page - 1})">&larr; PREVIOUS</button>
         <span>PAGE ${page} OF ${pages}</span>
         <button ${page === pages ? 'disabled' : ''} onclick="goPage(${page + 1})">NEXT &rarr;</button>`;

  renderSuggestions(false);
}

function goPage(n) {
  page = n;
  render();
  $('#view-catalog').scrollIntoView({ behavior: 'smooth' });
}

function renderSuggestions(show = true) {
  const box = $('#suggestions');
  const q = $('#searchInput').value.trim().toLowerCase();
  if (!show || q.length < 2) {
    box.classList.remove('show');
    return;
  }
  const matches = products
    .filter(p => `${p.partNo} ${p.name} ${p.brand || ''}`.toLowerCase().includes(q))
    .slice(0, 8);

  box.innerHTML =
    matches
      .map(
        p =>
          `<button type="button" data-id="${esc(p.id)}">
            <b>${esc(p.partNo)}</b>
            <span>${esc(p.name)}</span>
            <small>${esc(p.pg)} | ${esc(p.hierarchy)}</small>
          </button>`
      )
      .join('') || '<div class="emptyNote">No matching suggestions</div>';

  box.classList.add('show');
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
      box.classList.remove('show');
      render();
    };
  });
}

function clearSearchInput() {
  $('#searchInput').value = '';
  page = 1;
  render();
}

// ---------------------------------------------------------------------------
// Browser Image Compression (Shrinks 6 MB phone camera photos to ~250 KB)
// ---------------------------------------------------------------------------
function compressImageFile(file, maxWidth = 1200, quality = 0.8) {
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
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

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
      img.onerror = () => reject(new Error('Could not decode selected image'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read camera file'));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Workflow A: Quick Mobile Camera Label Search (Catalogue Bar)
// ---------------------------------------------------------------------------
function triggerQuickCamera() {
  $('#quickCamInput').value = '';
  $('#quickCamInput').click();
}

async function handleQuickCameraFile(file) {
  if (!file) return;
  const banner = $('#quickOcrBanner');
  const title = $('#quickOcrTitle');
  const sub = $('#quickOcrSub');
  const addBtn = $('#quickOcrUseAdminBtn');

  banner.classList.remove('hidden');
  addBtn.classList.add('hidden');
  title.textContent = 'Compressing photo & scanning label with Azure Vision...';
  sub.textContent = 'Reading part number, brand and MRP...';

  try {
    const compressed = await compressImageFile(file, 1100, 0.78);
    const res = await fetch(`${API_BASE}/ocr/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: compressed.dataUrl,
        createThumbnail: false
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Vision OCR failed');
    }

    const ext = data.extracted || {};
    lastQuickOcrData = { ...ext, dataUrl: compressed.dataUrl, compressedBlob: compressed.blob };

    const detectedCode = ext.partNo || (ext.lines && ext.lines[0]) || '';
    title.textContent = detectedCode
      ? `Detected Part: ${detectedCode} (${ext.brand || 'OEM'})`
      : 'Label text extracted';
    sub.textContent = `${ext.name || 'No description line detected'}${
      ext.mrp ? ` • MRP ₹${ext.mrp}` : ''
    }`;

    if (detectedCode) {
      $('#searchInput').value = detectedCode;
      activePG = 'ALL';
      activeHierarchy = 'ALL';
      page = 1;
      buildPG();
      updateHierarchy();
      render();
    }

    addBtn.classList.remove('hidden');
  } catch (err) {
    title.textContent = 'Camera OCR unavailable';
    sub.textContent = `${err.message}. Ensure Python backend is deployed to func-sapl-parts-api-dev.`;
  }
}

function hideQuickOcr() {
  $('#quickOcrBanner').classList.add('hidden');
}

function sendQuickOcrToAdmin() {
  openAdminWorkspace();
  if (!lastQuickOcrData) return;
  if (lastQuickOcrData.partNo) $('#fPartNo').value = lastQuickOcrData.partNo;
  if (lastQuickOcrData.name) $('#fName').value = lastQuickOcrData.name;
  if (lastQuickOcrData.brand) $('#fBrand').value = lastQuickOcrData.brand;
  if (lastQuickOcrData.pg) $('#fPG').value = lastQuickOcrData.pg;
  if (lastQuickOcrData.hierarchy) $('#fHierarchy').value = lastQuickOcrData.hierarchy;
  if (lastQuickOcrData.mrp) {
    $('#fMrp').value = lastQuickOcrData.mrp;
    $('#fDealerPrice').value = lastQuickOcrData.mrp;
  }
  if (lastQuickOcrData.rawText) {
    $('#adminOcrRawWrap').classList.remove('hidden');
    $('#adminOcrRawText').textContent = lastQuickOcrData.rawText;
  }
  if (lastQuickOcrData.dataUrl && lastQuickOcrData.compressedBlob) {
    pendingAdminBlob = {
      blob: lastQuickOcrData.compressedBlob,
      dataUrl: lastQuickOcrData.dataUrl,
      fileName: 'camera-scan.jpg'
    };
    $('#adminPhotoPreview').src = lastQuickOcrData.dataUrl;
    $('#adminPhotoPreview').classList.remove('hidden');
    $('#cameraPlaceholder').classList.add('hidden');
    $('#btnUploadAndOcr').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Workflow B: Admin Studio — Camera Capture -> SAS Upload -> AI OCR -> DB Save
// ---------------------------------------------------------------------------
function triggerAdminCamera() {
  $('#adminCamInput').value = '';
  $('#adminCamInput').click();
}

async function handleAdminCameraFile(file) {
  if (!file) return;
  const statusBox = $('#adminOcrStatus');
  statusBox.className = 'statusBox';
  statusBox.classList.remove('hidden');
  statusBox.textContent = 'Compressing photo for fast warehouse upload...';

  try {
    const comp = await compressImageFile(file, 1200, 0.82);
    pendingAdminBlob = {
      blob: comp.blob,
      dataUrl: comp.dataUrl,
      fileName: file.name || 'part-photo.jpg'
    };

    $('#adminPhotoPreview').src = comp.dataUrl;
    $('#adminPhotoPreview').classList.remove('hidden');
    $('#cameraPlaceholder').classList.add('hidden');

    const origKB = Math.round(comp.originalBytes / 1024);
    const compKB = Math.round(comp.compressedBytes / 1024);
    $('#compressionStats').classList.remove('hidden');
    $('#compressionStats').textContent = `Ready for upload: ${comp.width}x${comp.height}px JPEG (${origKB} KB -> ${compKB} KB)`;

    $('#btnUploadAndOcr').disabled = false;
    statusBox.textContent = 'Photo ready. Click "Upload to Azure & Auto-Fill via AI OCR".';
  } catch (err) {
    statusBox.className = 'statusBox error';
    statusBox.textContent = err.message;
  }
}

async function uploadAndScanAdminPhoto() {
  if (!pendingAdminBlob) return;
  if (authState.role !== 'admin' || !authState.token) {
    openLoginModal('admin');
    return;
  }

  const btn = $('#btnUploadAndOcr');
  const statusBox = $('#adminOcrStatus');
  btn.disabled = true;
  statusBox.className = 'statusBox';
  statusBox.classList.remove('hidden');

  try {
    // 1. Request 10-minute User Delegation SAS ticket from Function App
    statusBox.textContent = '1/3 Requesting 10-minute upload ticket from Azure...';
    const sasRes = await fetch(`${API_BASE}/uploads/sas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ fileName: pendingAdminBlob.fileName })
    });
    const sasData = await sasRes.json();
    if (!sasRes.ok || !sasData.ok) {
      throw new Error(sasData.error || 'Could not obtain upload SAS URL');
    }

    // 2. Upload compressed photo directly from phone/PC to stgsaplpartsdev
    statusBox.textContent = '2/3 Uploading compressed photo directly to stgsaplpartsdev...';
    const putRes = await fetch(sasData.uploadUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': 'image/jpeg'
      },
      body: pendingAdminBlob.blob
    });
    if (!putRes.ok) {
      throw new Error(`Blob upload failed (${putRes.status})`);
    }

    $('#fBlobName').value = sasData.blobName;
    $('#fImageUrl').value = sasData.readUrl;

    // 3. Trigger Azure Computer Vision OCR + Thumbnail creation
    statusBox.textContent = '3/3 Scanning label with Azure Computer Vision OCR...';
    const ocrRes = await fetch(`${API_BASE}/ocr/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blobName: sasData.blobName,
        createThumbnail: true
      })
    });
    const ocrData = await ocrRes.json();
    if (!ocrRes.ok || !ocrData.ok) {
      throw new Error(ocrData.error || 'Vision OCR failed');
    }

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

    statusBox.className = 'statusBox success';
    statusBox.textContent = 'Uploaded & OCR fields auto-filled! Verify details and click "Save Part to Live Catalogue".';
  } catch (err) {
    statusBox.className = 'statusBox error';
    statusBox.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function savePartMaster(e) {
  e.preventDefault();
  if (authState.role !== 'admin' || !authState.token) {
    openLoginModal('admin');
    return;
  }

  const btn = $('#btnSavePart');
  const statusBox = $('#adminOcrStatus');
  btn.disabled = true;

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
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to save part');
    }

    statusBox.className = 'statusBox success';
    statusBox.classList.remove('hidden');
    statusBox.textContent = `Saved ${payload.partNo} (${payload.name}) to sapl_parts_db!`;
    resetAdminForm();
    await loadCatalogueData();
  } catch (err) {
    statusBox.className = 'statusBox error';
    statusBox.classList.remove('hidden');
    statusBox.textContent = err.message;
  } finally {
    btn.disabled = false;
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
  $('#btnUploadAndOcr').disabled = true;
}

function renderAdminPartsTable() {
  const wrap = $('#adminPartsTableWrap');
  if (!wrap) return;
  const rows = products.slice(0, 50);
  wrap.innerHTML = rows.length
    ? `
      <table class="mpmsTable">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Part No</th>
            <th>Description</th>
            <th>PG / Hierarchy</th>
            <th>MRP</th>
            <th>Source</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(p => {
              const fallback = fallbackImageFor(p);
              return `
                <tr>
                  <td><img class="thumbMini" src="${esc(imageFor(p))}" onerror="this.onerror=null;this.src='${fallback}'" alt=""></td>
                  <td><span class="code">${esc(p.partNo)}</span></td>
                  <td><strong>${esc(p.name)}</strong><br><small>${esc(p.brand || 'OEM')}</small></td>
                  <td>${esc(p.pg)} &bull; ${esc(p.hierarchy)}</td>
                  <td>${Number(p.mrp) > 0 ? money(p.mrp) : 'On Request'}</td>
                  <td>${p.isLive ? '<span class="badgeBlue">PostgreSQL DB</span>' : '<span class="kpiTag">JSON Seed</span>'}</td>
                  <td>
                    ${
                      p.isLive
                        ? `<button class="btnGhost sm" onclick="deleteDbPart(${p.id})">Archive</button>`
                        : '<small>Seed Item</small>'
                    }
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `
    : '<p class="emptyNote">No parts loaded yet.</p>';
}

async function deleteDbPart(id) {
  if (!confirm('Archive this part from the active catalogue?')) return;
  try {
    const res = await fetch(`${API_BASE}/parts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    if (res.ok) await loadCatalogueData();
  } catch (e) {
    alert('Could not archive part.');
  }
}

// ---------------------------------------------------------------------------
// Enquiry Cart & Live PostgreSQL Submission
// ---------------------------------------------------------------------------
function add(id) {
  const key = String(id);
  cart[key] = (cart[key] || 0) + 1;
  saveCartState();
  updateCart();
  openCart();
}

function chg(id, delta) {
  const key = String(id);
  cart[key] = Math.max(0, (cart[key] || 0) + delta);
  if (!cart[key]) delete cart[key];
  saveCartState();
  updateCart();
}

function delItem(id) {
  delete cart[String(id)];
  saveCartState();
  updateCart();
}

function saveCartState() {
  localStorage.setItem('sapl_parts_cart', JSON.stringify(cart));
}

function updateCart() {
  const entries = Object.entries(cart)
    .map(([id, qty]) => {
      const part = products.find(p => String(p.id) === String(id));
      return part ? { ...part, qty } : null;
    })
    .filter(Boolean);

  const totalNos = entries.reduce((sum, x) => sum + x.qty, 0);
  $('#cartCount').textContent = totalNos;
  $('#kpiCartItems').textContent = `${totalNos} ${totalNos === 1 ? 'Item' : 'Items'}`;
  $('#subtotal').textContent = `${totalNos} NOS`;

  $('#cartItems').innerHTML = entries.length
    ? entries
        .map(
          x => `
          <div class="cartItem">
            <b>${esc(x.name)}</b>
            <span>${esc(x.partNo)} &bull; ${esc(x.pg)} &bull; Qty ${x.qty}</span>
            <div class="qty">
              <button type="button" onclick="chg('${esc(x.id)}', -1)">-</button>
              <strong>${x.qty}</strong>
              <button type="button" onclick="chg('${esc(x.id)}', 1)">+</button>
              <button type="button" onclick="delItem('${esc(x.id)}')">Remove</button>
            </div>
          </div>
        `
        )
        .join('')
    : '<p class="emptyNote">Your enquiry basket is empty. Add parts from the catalogue.</p>';
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
    alert('Please add at least one part to your enquiry basket.');
    return;
  }

  const btn = $('#submitEnquiryBtn');
  btn.disabled = true;

  const payload = {
    companyName: $('#enqCompany').value.trim(),
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
    if (!res.ok || !data.ok) throw new Error(data.error || 'Server error');

    alert(`Enquiry ${data.ref} submitted to Somani Auto Raipur!`);
    cart = {};
    saveCartState();
    updateCart();
    closeAll();
  } catch (err) {
    const fallbackRef = 'ENQ-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6);
    localStorage.setItem('sapl_last_enquiry', JSON.stringify({ ref: fallbackRef, ...payload }));
    alert(`Saved offline reference ${fallbackRef} (Backend API will sync once deployed).`);
    cart = {};
    saveCartState();
    updateCart();
    closeAll();
  } finally {
    btn.disabled = false;
  }
}

async function loadEnquiries() {
  const wrap = $('#enquiriesTableWrap');
  if (!authState.token) {
    wrap.innerHTML = '<p class="emptyNote">Please sign in with Dealer or Admin credentials to view enquiries.</p>';
    return;
  }

  wrap.innerHTML = '<p class="emptyNote">Loading enquiries from PostgreSQL...</p>';
  try {
    const res = await fetch(`${API_BASE}/enquiries`, {
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load enquiries');

    const rows = data.enquiries || [];
    wrap.innerHTML = rows.length
      ? `
        <table class="mpmsTable">
          <thead>
            <tr>
              <th>Enquiry Ref</th>
              <th>Dealer / Company</th>
              <th>Contact</th>
              <th>Items</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                r => `
                <tr>
                  <td><span class="code">${esc(r.ref)}</span></td>
                  <td><strong>${esc(r.companyName || r.dealerCode || 'Walk-in')}</strong></td>
                  <td>${esc(r.contactName || '-')} ${r.contactPhone ? `(${esc(r.contactPhone)})` : ''}</td>
                  <td>${r.totalItems} NOS (${(r.items || []).length} SKUs)</td>
                  <td><span class="badgeOrange">${esc(r.status)}</span></td>
                  <td>${new Date(r.createdAt).toLocaleString('en-IN')}</td>
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      `
      : '<p class="emptyNote">No enquiries recorded yet.</p>';
  } catch (err) {
    wrap.innerHTML = `<p class="emptyNote">${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Workspace Navigation & Authentication Modals
// ---------------------------------------------------------------------------
function switchView(viewName) {
  $$('.workspaceView').forEach(v => v.classList.add('hidden'));
  $(`#view-${viewName}`).classList.remove('hidden');
  $$('.tabBtn').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
}

function openAdminWorkspace() {
  if (authState.role !== 'admin' || !authState.token) {
    openLoginModal('admin');
    return;
  }
  switchView('admin');
  renderAdminPartsTable();
}

function openEnquiriesWorkspace() {
  if (!authState.token) {
    openLoginModal('dealer');
    return;
  }
  switchView('enquiries');
  loadEnquiries();
}

function openLoginModal(mode) {
  if (authState.token && authState.role === mode) {
    if (confirm(`Signed in as ${authState.user} (${authState.role.toUpperCase()}). Sign out?`)) {
      authState = { token: '', role: '', user: '', loginMode: 'dealer' };
      sessionStorage.removeItem('sapl_token');
      sessionStorage.removeItem('sapl_role');
      sessionStorage.removeItem('sapl_user');
      updateAuthButtons();
      switchView('catalog');
      render();
    }
    return;
  }

  authState.loginMode = mode;
  $('#authError').classList.add('hidden');
  $('#authPassword').value = '';

  if (mode === 'admin') {
    $('#authEyebrow').textContent = 'ADMIN CONTROL CENTRE';
    $('#authTitle').textContent = 'Admin Studio Sign In';
    $('#authSubtitle').textContent = 'Sign in to capture part photos, run AI OCR scans and manage the catalogue.';
    $('#authIdLabel').textContent = 'ADMIN USERNAME';
    $('#authIdentifier').placeholder = 'Enter Admin Username';
  } else {
    $('#authEyebrow').textContent = 'DEALER ACCESS';
    $('#authTitle').textContent = 'Dealer Portal Sign In';
    $('#authSubtitle').textContent = 'Sign in with your Somani Auto dealer code to access commercial pricing and enquiry history.';
    $('#authIdLabel').textContent = 'DEALER CODE';
    $('#authIdentifier').placeholder = 'Enter Dealer Code';
  }

  $('#overlay').classList.add('show');
  $('#authModal').classList.add('show');
  setTimeout(() => $('#authIdentifier').focus(), 80);
}

async function submitLogin(e) {
  e.preventDefault();
  const errBox = $('#authError');
  const btn = $('#authSubmitBtn');
  errBox.classList.add('hidden');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: authState.loginMode,
        username: $('#authIdentifier').value.trim(),
        password: $('#authPassword').value
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    authState.token = data.token;
    authState.role = data.role;
    authState.user = data.user;

    sessionStorage.setItem('sapl_token', data.token);
    sessionStorage.setItem('sapl_role', data.role);
    sessionStorage.setItem('sapl_user', data.user);

    updateAuthButtons();
    closeAll();
    render();

    if (data.role === 'admin') {
      switchView('admin');
      renderAdminPartsTable();
    } else {
      switchView('enquiries');
      loadEnquiries();
    }
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

function updateAuthButtons() {
  const dealerBtn = $('#dealerAccessBtn');
  const adminBtn = $('#adminAccessBtn');

  if (authState.role === 'dealer' && authState.token) {
    dealerBtn.textContent = `Dealer: ${authState.user}`;
    adminBtn.textContent = 'Admin';
  } else if (authState.role === 'admin' && authState.token) {
    adminBtn.textContent = `Admin: ${authState.user}`;
    dealerBtn.textContent = 'Dealer Login';
  } else {
    dealerBtn.textContent = 'Dealer Login';
    adminBtn.textContent = 'Admin';
  }
}

function openCart() {
  $('#drawer').classList.add('open');
  $('#overlay').classList.add('show');
}

function closeAll() {
  $('#drawer').classList.remove('open');
  $('#overlay').classList.remove('show');
  $$('.modal').forEach(m => m.classList.remove('show'));
}

function bindEvents() {
  $('#searchInput').addEventListener('input', () => {
    page = 1;
    render();
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
      $('#suggestions').classList.remove('show');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.searchWrap')) {
      $('#suggestions').classList.remove('show');
    }
  });

  $('#hierarchyFilter').addEventListener('change', e => {
    activeHierarchy = e.target.value;
    page = 1;
    render();
  });

  $('#clearFilters').addEventListener('click', () => {
    activePG = 'ALL';
    activeHierarchy = 'ALL';
    $('#searchInput').value = '';
    page = 1;
    $('#kpiActivePG').textContent = 'ALL PG';
    buildPG();
    updateHierarchy();
    render();
  });

  $('#quickCamInput').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleQuickCameraFile(e.target.files[0]);
    }
  });

  $('#adminCamInput').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleAdminCameraFile(e.target.files[0]);
    }
  });
}

window.switchView = switchView;
window.openAdminWorkspace = openAdminWorkspace;
window.openEnquiriesWorkspace = openEnquiriesWorkspace;
window.openLoginModal = openLoginModal;
window.submitLogin = submitLogin;
window.setDisplayMode = setDisplayMode;
window.clearSearchInput = clearSearchInput;
window.triggerQuickCamera = triggerQuickCamera;
window.hideQuickOcr = hideQuickOcr;
window.sendQuickOcrToAdmin = sendQuickOcrToAdmin;
window.triggerAdminCamera = triggerAdminCamera;
window.uploadAndScanAdminPhoto = uploadAndScanAdminPhoto;
window.savePartMaster = savePartMaster;
window.resetAdminForm = resetAdminForm;
window.deleteDbPart = deleteDbPart;
window.add = add;
window.chg = chg;
window.delItem = delItem;
window.openCart = openCart;
window.closeAll = closeAll;
window.submitEnquiry = submitEnquiry;
window.loadEnquiries = loadEnquiries;
window.loadCatalogueData = loadCatalogueData;
window.goPage = goPage;
