const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
let products = [];
let admin = null;

function cls(s) { return String(s).toLowerCase().replace(/ /g, ''); }
function status(s) { return `<span class="badge ${cls(s)}">${String(s).toUpperCase()}</span>`; }
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

Promise.all([
  fetch('data/products.json').then((r) => r.json()),
  fetch('data/admin-dashboard.json').then((r) => r.json())
]).then(([catalogue, dashboard]) => {
  products = JSON.parse(localStorage.getItem('somaniProducts') || JSON.stringify(catalogue));
  admin = dashboard;
  renderAll();
}).catch(() => toast('Admin data could not be loaded. Refresh the page.'));

function renderAll() {
  $('#kProducts').textContent = products.length.toLocaleString('en-IN');
  $('#kDealers').textContent = admin.summary.dealers;
  $('#kStock').textContent = products.filter((p) => typeof p.stock === 'number' && p.stock <= 8).length;
  $('#kEnquiries').textContent = admin.summary.enquiries;
  $('#kOrders').textContent = admin.summary.pendingOrders;
  renderProducts(products);
  renderStock(products);
  renderDealers();
  renderEnquiries();
}

function renderProducts(list) {
  $('#productTable').innerHTML = list.slice(0, 500).map((p) => `
    <tr>
      <td><img class="thumb" src="assets/images/products/${p.image || 'precision-parts.jpg'}"></td>
      <td><b>${p.partNo}</b></td><td>${p.name}</td><td><b>${p.pg || '-'}</b></td>
      <td>${p.hierarchy || p.category || '-'}</td><td><b>ON REQUEST</b></td>
      <td>${status('Active')}</td><td><button class="tinyBtn" onclick="editProduct(${p.id})">EDIT</button></td>
    </tr>`).join('');
}

function renderStock(list) {
  $('#stockTable').innerHTML = list.slice(0, 500).map((p) => {
    const known = typeof p.stock === 'number';
    const reserved = known && p.stock > 5 ? 2 : 0;
    const free = known ? p.stock - reserved : '-';
    const health = !known ? 'Awaiting Stock File' : p.stock === 0 ? 'Out' : p.stock <= 8 ? 'Low' : 'Active';
    return `<tr><td><b>${p.partNo}</b></td><td>${p.name}</td><td>${known ? p.stock : '-'}</td>
      <td>${known ? reserved : '-'}</td><td><b>${free}</b></td><td>${known ? (p.stock <= 8 ? 5 : 10) : '-'}</td>
      <td>${p.location || '-'}</td><td>${status(health)}</td></tr>`;
  }).join('');
}

function renderDealers() {
  $('#dealerCards').innerHTML = admin.dealers.map((d) => `
    <article class="dealerCard"><div class="dHead"><div><h3>${d.name}</h3><p>${d.code} • ${d.city} • ${d.salesperson}</p></div>${status(d.status)}</div>
    <div class="dealerStats"><div><span>CREDIT LIMIT</span><b>${money(d.credit)}</b></div><div><span>OUTSTANDING</span><b>${money(d.outstanding)}</b></div></div>
    <div class="dealerActions"><button class="tinyBtn" onclick="toast('Dealer editor will connect to the production database.')">EDIT</button><button class="tinyBtn" onclick="toast('Dealer activity opened in demo mode.')">VIEW ACTIVITY</button></div></article>`).join('');
}

function renderEnquiries() {
  const rows = admin.enquiries.map((e) => `<tr><td><b>${e.number}</b></td><td>${e.date}</td><td>${e.dealer}</td><td>${e.items}</td><td><b>${money(e.amount)}</b></td><td>${status(e.status)}</td><td><button class="tinyBtn" onclick="approve('${e.number}')">APPROVE</button> <button class="tinyBtn" onclick="toast('Enquiry ${e.number} opened.')">REVIEW</button></td></tr>`).join('');
  $('#enquiryTable').innerHTML = rows;
  $('#recentEnquiries').innerHTML = admin.enquiries.slice(0, 4).map((e) => `<tr><td><b>${e.number}</b></td><td>${e.dealer}</td><td>${e.items}</td><td><b>${money(e.amount)}</b></td><td>${status(e.status)}</td></tr>`).join('');
}

function show(id) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#' + id).classList.add('active');
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  const names = { overview:'Operations Overview', products:'Product Management', excel:'Excel Upload', stock:'Stock Management', dealers:'Dealer Management', enquiries:'Enquiry Management', orders:'Order Processing' };
  $('#title').textContent = names[id];
  $('#sidebar').classList.remove('open');
  scrollTo(0, 0);
}

$$('#nav button').forEach((b) => b.onclick = () => show(b.dataset.view));
$$('[data-open]').forEach((b) => b.onclick = () => show(b.dataset.open));
$('#menu').onclick = () => $('#sidebar').classList.toggle('open');
$('#logout').onclick = () => { sessionStorage.removeItem('somaniAdmin'); location.replace('./index.html'); };
$('.notification').onclick = () => toast('4 demo alerts: 2 stock warnings, 1 enquiry, 1 pending order.');

function filterProducts() {
  const q = $('#productSearch').value.toLowerCase();
  renderProducts(products.filter((p) => `${p.pg || ''} ${p.hierarchy || ''} ${p.partNo} ${p.name} ${p.category || ''}`.toLowerCase().includes(q)));
}
$('#productSearch').oninput = filterProducts;
$('#productStatus').onchange = filterProducts;

function filterStock() {
  const q = $('#stockSearch').value.toLowerCase();
  const f = $('#stockFilter').value;
  renderStock(products.filter((p) => {
    const match = `${p.pg || ''} ${p.hierarchy || ''} ${p.partNo} ${p.name}`.toLowerCase().includes(q);
    const known = typeof p.stock === 'number';
    return match && (f === 'All Stock' || (f === 'Low Stock' && known && p.stock > 0 && p.stock <= 8) || (f === 'Out of Stock' && known && p.stock === 0));
  }));
}
$('#stockSearch').oninput = filterStock;
$('#stockFilter').onchange = filterStock;

$('#excelFile').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const ok = /\.(xlsx|xls)$/i.test(f.name);
  $('#uploadResult').classList.remove('hidden');
  $('#uploadResult').innerHTML = `<div class="panelHead"><div><span>UPLOAD RESULT</span><h3>${ok ? 'File accepted for demo preview' : 'Invalid file type'}</h3></div>${status(ok ? 'Approved' : 'Out')}</div><p><b>${f.name}</b> • ${(f.size/1024/1024).toFixed(2)} MB</p><div class="resultGrid"><div><b>${ok ? products.length.toLocaleString('en-IN') : 0}</b><span>CATALOGUE RECORDS</span></div><div><b>82</b><span>PRODUCT HIERARCHIES</span></div><div><b>6</b><span>PG GROUPS</span></div></div><p>Demo preview only. Production import will validate workbook sheets and columns before database update.</p>`;
};

function openModal(html) { $('#modalContent').innerHTML = html; $('#modal').classList.add('show'); }
$('#closeModal').onclick = () => $('#modal').classList.remove('show');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('show'); };
$('#addProduct').onclick = () => openModal(`<h2>Add Demo Product</h2><div class="formGrid"><label>PG Group<select id="mPG"><option>PG1</option><option>PG2</option><option>PG3</option><option>PG4</option><option>PG5</option><option>PG6</option></select></label><label>Product Hierarchy<input id="mHierarchy"></label><label>Part Number<input id="mPart"></label><label>Part Description<input id="mName"></label><button class="primary wide" onclick="saveProduct()">SAVE DEMO PRODUCT</button></div>`);
$('#addDealer').onclick = () => openModal(`<h2>Add Demo Dealer</h2><div class="formGrid"><label>Dealer Code<input></label><label>Dealer Name<input></label><label>City<input></label><label>Mobile<input></label><button class="primary wide" onclick="closeAndToast('Demo dealer saved temporarily.')">SAVE DEMO DEALER</button></div>`);

function saveProduct() {
  const part = $('#mPart').value.trim(), name = $('#mName').value.trim();
  if (!part || !name) return toast('Part number and description are required.');
  products.unshift({ id:Date.now(), pg:$('#mPG').value, hierarchy:$('#mHierarchy').value || 'General', partNo:part, name, category:$('#mHierarchy').value || 'General', price:0, stock:null, image:'precision-parts.jpg' });
  localStorage.setItem('somaniProducts', JSON.stringify(products)); renderAll(); $('#modal').classList.remove('show'); toast('Demo product added.');
}
function editProduct(id) {
  const p = products.find((x) => x.id === id);
  openModal(`<h2>Edit ${p.name}</h2><div class="formGrid"><label>PG Group<input id="ePG" value="${p.pg || ''}"></label><label>Product Hierarchy<input id="eHierarchy" value="${p.hierarchy || ''}"></label><label>Part Number<input value="${p.partNo}" disabled></label><label>Description<input id="eName" value="${p.name}"></label><button class="primary wide" onclick="saveEdit(${id})">SAVE CHANGES</button></div>`);
}
function saveEdit(id) {
  const p = products.find((x) => x.id === id); p.pg = $('#ePG').value; p.hierarchy = $('#eHierarchy').value; p.name = $('#eName').value;
  localStorage.setItem('somaniProducts', JSON.stringify(products)); renderAll(); $('#modal').classList.remove('show'); toast('Product updated in this browser.');
}
function approve(n) { const e = admin.enquiries.find((x) => x.number === n); e.status = 'Approved'; renderEnquiries(); toast(n + ' approved.'); }
$$('.saveOrder').forEach((b) => b.onclick = () => toast('Demo order status saved.'));
function closeAndToast(m) { $('#modal').classList.remove('show'); toast(m); }
window.toast=toast; window.editProduct=editProduct; window.saveEdit=saveEdit; window.saveProduct=saveProduct; window.approve=approve; window.closeAndToast=closeAndToast;
