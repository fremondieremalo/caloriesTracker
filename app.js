/* ============================================================
   CALORIES TRACKER — app.js
   ============================================================ */

const BMR = 1800;
const FS_COLLECTION = 'days';

/* ---- État global ---- */
let db      = null;
let cache   = {};
let cacheAll = {};
let isOnline = false;
const KCAL_PER_KG = 7700;

/* ============================================================
   UTILS DATE
   ============================================================ */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function formatLong(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const days   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${days[dt.getDay()]} ${d} ${months[m-1]} ${y}`;
}

function weekdayLetter(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return ['D','L','M','M','J','V','S'][new Date(y, m-1, d).getDay()];
}

function last30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    days.push(`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`);
  }
  return days;
}

/* ============================================================
   CALCULS & STATUT
   ============================================================ */
function consumed(day)  { return (day?.meals || []).reduce((s,m) => s + (m.calories||0), 0); }
function spent(day)     { return BMR + (day?.activeCalories || 0); }

/* Retourne une classe CSS selon le solde */
function statusClass(day) {
  if (!day || (!day.meals?.length && !day.activeCalories)) return 's-none';
  const diff = consumed(day) - spent(day);
  if (diff < -500) return 's-g1';      // déficit > 500 kcal → vert très foncé
  if (diff < -300) return 's-g2';      // déficit 300-500   → vert foncé
  if (diff < -50)  return 's-g3';      // déficit 50-300    → vert moyen
  if (diff <=  50) return 's-o1';      // équilibre ±50     → orange
  if (diff <=  200) return 's-r3';     // surplus 50-200    → rouge clair
  if (diff <=  500) return 's-r2';     // surplus 200-500   → rouge moyen
  return 's-r1';                       // surplus > 500     → rouge foncé
}

/* Badge du jour courant */
function badgeClass(day) {
  if (!day || (!day.meals?.length && !day.activeCalories)) return '';
  const diff = consumed(day) - spent(day);
  if (diff < -50)  return 'green';
  if (diff <= 100) return 'orange';
  return 'red';
}
function badgeLabel(day) {
  if (!day || (!day.meals?.length && !day.activeCalories)) return '—';
  const diff = consumed(day) - spent(day);
  if (diff < -50)  return '✓ Déficit';
  if (diff <= 100) return '≈ Équilibré';
  return '↑ Surplus';
}

const MEAL_EMOJI = { 'Petit déjeuner':'🌅','Déjeuner':'☀️','Goûter':'🍎','Dîner':'🌙','Grignotage':'🍿' };
function mealEmoji(type) { return MEAL_EMOJI[type] || '🍽️'; }

/* ============================================================
   THÈME JOUR / NUIT
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('caltrack_theme') || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('caltrack_theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   SYNC STATUS UI
   ============================================================ */
function setSyncStatus(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (dot) dot.className = 'sync-dot ' + state;
  if (lbl) lbl.textContent = label;
}

/* ============================================================
   FIREBASE
   ============================================================ */
function initFirebase() {
  try {
    db = firebase.firestore();
    setSyncStatus('syncing', 'Connexion à Firebase…');

    const days30 = last30Days();
    db.collection(FS_COLLECTION)
      .where(firebase.firestore.FieldPath.documentId(), 'in', days30)
      .onSnapshot(
        (snapshot) => {
          isOnline = true;
          snapshot.forEach(doc => { cache[doc.id] = doc.data(); });
          localStorage.setItem('caltrack_cache', JSON.stringify(cache));
          setSyncStatus('connected', `Synchronisé · ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}`);
          render();
          loadAllTime(); // charge tous les jours pour le déficit total
        },
        (err) => {
          console.error('Firestore error:', err);
          isOnline = false;
          setSyncStatus('error', 'Hors ligne — données locales');
          loadFromLocal();
          render();
        }
      );
  } catch (e) {
    console.error('Firebase init error:', e);
    setSyncStatus('error', 'Firebase non configuré — mode local');
    loadFromLocal();
    render();
  }
}

function loadFromLocal() {
  try { cache    = JSON.parse(localStorage.getItem('caltrack_cache')    || '{}'); }
  catch { cache  = {}; }
  try { cacheAll = JSON.parse(localStorage.getItem('caltrack_cache_all') || '{}'); }
  catch { cacheAll = {}; }
}

/* Chargement one-shot de TOUS les jours Firestore pour le déficit total */
async function loadAllTime() {
  if (!db || !isOnline) return;
  try {
    const snapshot = await db.collection(FS_COLLECTION).get();
    cacheAll = {};
    snapshot.forEach(doc => { cacheAll[doc.id] = doc.data(); });
    localStorage.setItem('caltrack_cache_all', JSON.stringify(cacheAll));
    renderAllTimeStats();
  } catch (e) {
    console.error('loadAllTime error:', e);
  }
}

/* Calcule et affiche le déficit total + kg depuis le début */
function renderAllTimeStats() {
  const allData = Object.keys(cacheAll).length ? cacheAll : cache;
  let totalDeficit = 0;
  let hasDays = false;

  Object.entries(allData).forEach(([, day]) => {
    if (day && (day.meals?.length || day.activeCalories)) {
      hasDays = true;
      totalDeficit += spent(day) - consumed(day); // positif = déficit
    }
  });

  const kcalEl = document.getElementById('alltime-kcal');
  const kgEl   = document.getElementById('alltime-kg');
  if (!kcalEl || !kgEl) return;

  if (!hasDays) {
    kcalEl.textContent = '—'; kgEl.textContent = '—'; return;
  }

  const isPositive = totalDeficit >= 0;
  kcalEl.textContent = `${isPositive ? '-' : '+'}${Math.abs(Math.round(totalDeficit)).toLocaleString('fr-FR')} kcal`;
  kcalEl.className   = 'alltime-kcal' + (isPositive ? '' : ' surplus');
  kgEl.textContent   = `${isPositive ? '-' : '+'}${Math.abs(totalDeficit / KCAL_PER_KG).toFixed(2)} kg`;
  kgEl.className     = 'alltime-kg' + (isPositive ? '' : ' surplus');
}

async function saveDay(dateStr, dayData) {
  cache[dateStr]    = dayData;
  cacheAll[dateStr] = dayData; // aussi dans le cache total
  localStorage.setItem('caltrack_cache', JSON.stringify(cache));
  localStorage.setItem('caltrack_cache_all', JSON.stringify(cacheAll));

  if (!db || !isOnline) {
    setSyncStatus('error', 'Mode local — sync au retour en ligne');
    return;
  }
  setSyncStatus('syncing', 'Sauvegarde…');
  try {
    await db.collection(FS_COLLECTION).doc(dateStr).set(dayData);
    setSyncStatus('connected', `Synchronisé · ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}`);
  } catch (e) {
    console.error('Save error:', e);
    setSyncStatus('error', 'Erreur sync — données locales');
  }
}

function getDayData(dateStr) {
  if (!cache[dateStr]) cache[dateStr] = { meals: [], activeCalories: 0 };
  return cache[dateStr];
}

/* ============================================================
   RENDER PRINCIPAL
   ============================================================ */
function render() {
  const today = todayStr();
  document.getElementById('current-date-header').textContent = formatLong(today);
  document.getElementById('today-date-label').textContent    = formatLong(today);
  renderStrip(today);
  renderToday(getDayData(today), today);
  renderAllTimeStats();
}

/* ---- Bande historique : couleur de fond, juste jour+numéro, pas de bicep ---- */
function renderStrip(today) {
  const strip = document.getElementById('history-strip');
  strip.innerHTML = '';

  last30Days().forEach(dateStr => {
    const day = cache[dateStr];
    const sc  = statusClass(day);
    const isT = dateStr === today;
    const [,,d] = dateStr.split('-');

    const el = document.createElement('div');
    el.className = `hday ${sc}${isT ? ' is-today' : ''}`;
    el.innerHTML = `
      <span class="hday-label">${isT ? 'auj.' : weekdayLetter(dateStr)}</span>
      <span class="hday-num">${+d}</span>
    `;
    el.onclick = () => openHistoryDetail(dateStr);
    strip.appendChild(el);
  });

  setTimeout(() => {
    const todayEl = strip.querySelector('.is-today');
    if (todayEl) todayEl.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
  }, 80);
}

/* ---- Carte aujourd'hui ---- */
function renderToday(day, dateStr) {
  const c  = consumed(day);
  const s2 = spent(day);
  const b  = c - s2;

  // Badge
  const badge = document.getElementById('badge-status');
  badge.className = `badge-status ${badgeClass(day)}`;
  badge.textContent = badgeLabel(day);

  // Batterie
  const pct  = s2 > 0 ? Math.min(Math.round((c / s2) * 100), 150) : 0;
  const fill = document.getElementById('battery-fill');
  fill.style.width = Math.min(pct, 100) + '%';
  fill.className = 'battery-fill' + (pct > 110 ? ' f-red' : pct > 90 ? ' f-orange' : '');
  document.getElementById('battery-pct').textContent      = pct + '%';
  document.getElementById('battery-consumed').textContent = `${c.toLocaleString('fr-FR')} kcal ingurgitées`;
  document.getElementById('battery-spent').textContent    = `/ ${s2.toLocaleString('fr-FR')} kcal dépensées`;

  // KPI — valeur chiffrée uniquement (sans "kcal" dans le span value)
  document.getElementById('stat-bmr').textContent    = BMR.toLocaleString('fr-FR');
  document.getElementById('stat-active').textContent = (day.activeCalories||0).toLocaleString('fr-FR');

  const balEl = document.getElementById('stat-balance');
  balEl.textContent  = `${b > 0 ? '+' : ''}${b.toLocaleString('fr-FR')}`;
  balEl.style.color  = b < -50 ? 'var(--g1)' : b > 100 ? 'var(--r2)' : 'var(--o1)';

  renderMeals(day.meals || [], dateStr, 'today-meals-list', 'empty-meals');
}

function renderMeals(meals, dateStr, listId, emptyId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const emptyEl = emptyId ? document.getElementById(emptyId) : null;

  if (!meals.length) {
    list.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; list.appendChild(emptyEl); }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  list.innerHTML = '';

  meals.forEach((meal, idx) => {
    const el = document.createElement('div');
    el.className = 'meal-item';
    el.innerHTML = `
      <div class="meal-left">
        <span class="meal-emoji">${mealEmoji(meal.type)}</span>
        <div>
          <div class="meal-name">${meal.type}</div>
          ${meal.composition ? `<div class="meal-compo">${meal.composition}</div>` : ''}
        </div>
      </div>
      <div class="meal-right">
        <span class="meal-kcal">${(meal.calories||0).toLocaleString('fr-FR')} kcal</span>
        <button class="btn-del" onclick="deleteMeal('${dateStr}',${idx})" title="Supprimer">✕</button>
      </div>
    `;
    list.appendChild(el);
  });
}

/* ============================================================
   MODAL REPAS
   ============================================================ */
function openMealModal(prefill) {
  const dateStr = prefill || todayStr();
  document.getElementById('meal-type').value        = '';
  document.getElementById('meal-calories').value    = '';
  document.getElementById('meal-composition').value = '';
  document.getElementById('meal-date').value        = dateStr;
  document.getElementById('meal-modal').classList.add('open');
  setTimeout(() => document.getElementById('meal-calories').focus(), 320);
}

function closeMealModal(e) {
  if (e && e.target !== document.getElementById('meal-modal')) return;
  document.getElementById('meal-modal').classList.remove('open');
}

async function saveMeal() {
  const type     = document.getElementById('meal-type').value.trim();
  const calories = parseInt(document.getElementById('meal-calories').value);
  const compo    = document.getElementById('meal-composition').value.trim();
  const dateStr  = document.getElementById('meal-date').value || todayStr();

  if (!type)             { showToast('⚠️ Choisis un type de repas'); return; }
  if (!calories || calories <= 0) { showToast('⚠️ Calories invalides'); return; }

  const day = getDayData(dateStr);
  day.meals = [...(day.meals||[]), { type, calories, composition: compo, time: new Date().toISOString() }];
  await saveDay(dateStr, day);

  closeMealModal();
  showToast(`✓ ${type} · ${calories} kcal`);
  render();
  refreshDetailIfOpen(dateStr);
}

async function deleteMeal(dateStr, idx) {
  if (!confirm('Supprimer ce repas ?')) return;
  const day = getDayData(dateStr);
  day.meals.splice(idx, 1);
  await saveDay(dateStr, day);
  showToast('Repas supprimé');
  render();
  refreshDetailIfOpen(dateStr);
}

/* ============================================================
   MODAL ACTIVITÉ
   ============================================================ */
function openActivityModal(prefill) {
  const dateStr = prefill || todayStr();
  const day = getDayData(dateStr);
  document.getElementById('activity-calories').value = day.activeCalories || '';
  document.getElementById('activity-date').value     = dateStr;
  document.getElementById('activity-modal').classList.add('open');
  setTimeout(() => document.getElementById('activity-calories').focus(), 320);
}

function closeActivityModal(e) {
  if (e && e.target !== document.getElementById('activity-modal')) return;
  document.getElementById('activity-modal').classList.remove('open');
}

async function saveActivity() {
  const cal     = parseInt(document.getElementById('activity-calories').value);
  const dateStr = document.getElementById('activity-date').value || todayStr();

  if (!cal || cal < 0) { showToast('⚠️ Calories invalides'); return; }

  const day = getDayData(dateStr);
  day.activeCalories = cal;
  await saveDay(dateStr, day);

  closeActivityModal();
  showToast(`✓ ${cal} kcal actives enregistrées`);
  render();
  refreshDetailIfOpen(dateStr);
}

/* ============================================================
   DÉTAIL HISTORIQUE
   ============================================================ */
function openHistoryDetail(dateStr) {
  const day = getDayData(dateStr);
  const c   = consumed(day);
  const s2  = spent(day);
  const b   = c - s2;
  const sc  = statusClass(day);
  const isT = dateStr === todayStr();

  const colorMap = {
    's-g1':'var(--g1)','s-g2':'var(--g2)','s-g3':'var(--g3)',
    's-o1':'var(--o1)',
    's-r3':'var(--r3)','s-r2':'var(--r2)','s-r1':'var(--r1)',
    's-none':'var(--text-muted)'
  };
  const labelMap = {
    's-g1':'Déficit > 500 kcal 💪','s-g2':'Déficit 300-500 kcal','s-g3':'Déficit 50-300 kcal',
    's-o1':'Équilibré',
    's-r3':'Surplus léger','s-r2':'Surplus modéré','s-r1':'Surplus important',
    's-none':'Aucune donnée'
  };

  const titleEl = document.getElementById('history-detail-title');
  titleEl.textContent  = isT ? "Aujourd'hui" : formatLong(dateStr);
  titleEl.dataset.date = dateStr;

  const meals = day.meals || [];
  const mealsHTML = meals.length
    ? meals.map((m, idx) => `
        <div class="meal-item">
          <div class="meal-left">
            <span class="meal-emoji">${mealEmoji(m.type)}</span>
            <div>
              <div class="meal-name">${m.type}</div>
              ${m.composition ? `<div class="meal-compo">${m.composition}</div>` : ''}
            </div>
          </div>
          <div class="meal-right">
            <span class="meal-kcal">${(m.calories||0).toLocaleString('fr-FR')} kcal</span>
            <button class="btn-del" onclick="deleteMeal('${dateStr}',${idx})">✕</button>
          </div>
        </div>`).join('')
    : '<p class="empty-state">Aucun repas enregistré.</p>';

  document.getElementById('history-detail-content').innerHTML = `
    <div class="history-meta">
      <span>🔥 ${BMR.toLocaleString('fr-FR')} kcal métabolisme</span>
      <span>🏃 ${(day.activeCalories||0).toLocaleString('fr-FR')} kcal actives</span>
      <span>🍽️ ${c.toLocaleString('fr-FR')} kcal ingurgitées</span>
      <span style="color:${colorMap[sc]}">⚖️ ${b > 0?'+':''}${b.toLocaleString('fr-FR')} kcal · ${labelMap[sc]}</span>
    </div>
    <div class="meals-list">${mealsHTML}</div>
    <div class="actions-row" style="margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="openMealModal('${dateStr}')">＋ Ajouter un repas</button>
      <button class="btn btn-secondary btn-sm" onclick="openActivityModal('${dateStr}')">Modifier l'activité</button>
    </div>
  `;

  const sec = document.getElementById('history-detail-section');
  sec.style.display = 'block';
  setTimeout(() => sec.scrollIntoView({ behavior:'smooth', block:'start' }), 50);
}

function closeHistoryDetail() {
  document.getElementById('history-detail-section').style.display = 'none';
}

function refreshDetailIfOpen(dateStr) {
  const sec = document.getElementById('history-detail-section');
  if (sec.style.display === 'none') return;
  const titleEl = document.getElementById('history-detail-title');
  if (titleEl.dataset.date === dateStr) openHistoryDetail(dateStr);
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ============================================================
   KEYBOARD
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('meal-modal').classList.remove('open');
    document.getElementById('activity-modal').classList.remove('open');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (document.getElementById('meal-modal').classList.contains('open'))     saveMeal();
    if (document.getElementById('activity-modal').classList.contains('open')) saveActivity();
  }
});

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Thème sauvegardé
  initTheme();

  // Dates par défaut
  document.getElementById('meal-date').value     = todayStr();
  document.getElementById('activity-date').value = todayStr();

  // Cache local → affichage immédiat
  loadFromLocal();
  render();

  // Connexion Firebase
  initFirebase();

  // Refresh auto à minuit
  const now = new Date();
  const ms  = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 5) - now;
  setTimeout(() => { render(); setInterval(render, 86400000); }, ms);
});
