/* ============================================================
   CALTRACK — app.js
   Sync Firestore + localStorage (fallback offline)
   ============================================================ */

const BMR = 1800;
const FS_COLLECTION = 'days'; // Collection Firestore

/* ---- État global ---- */
let db = null;          // instance Firestore
let cache = {};         // cache local { 'YYYY-MM-DD': { meals, activeCalories } }
let unsubscribe = null; // listener temps réel
let isOnline = false;

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

function formatShort(dateStr) {
  const [,m,d] = dateStr.split('-').map(Number);
  const months = ['jan','fév','mar','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];
  return `${d} ${months[m-1]}`;
}

function weekdayLetter(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return ['D','L','M','M','J','V','S'][new Date(y, m-1, d).getDay()];
}

function last30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    days.push(`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`);
  }
  return days;
}

/* ============================================================
   MEAL HELPERS
   ============================================================ */
const MEAL_EMOJI = {
  'Petit déjeuner': '🌅',
  'Déjeuner':       '☀️',
  'Goûter':         '🍎',
  'Dîner':          '🌙',
  'Grignotage':     '🍿',
};
function mealEmoji(type) { return MEAL_EMOJI[type] || '🍽️'; }

/* ============================================================
   CALCULS
   ============================================================ */
function consumed(day)  { return (day?.meals || []).reduce((s,m) => s + (m.calories||0), 0); }
function spent(day)     { return BMR + (day?.activeCalories || 0); }
function status(day) {
  const c = consumed(day), s2 = spent(day);
  if (c === 0 && !day?.meals?.length && !day?.activeCalories) return 'none';
  const diff = c - s2;
  if (diff < -50)  return 'green';
  if (diff <= 100) return 'orange';
  return 'red';
}

/* ============================================================
   SYNC STATUS UI
   ============================================================ */
function setSyncStatus(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  dot.className = 'sync-dot ' + state;
  lbl.textContent = label;
}

/* ============================================================
   FIREBASE INIT + SYNC TEMPS RÉEL
   ============================================================ */
function initFirebase() {
  try {
    db = firebase.firestore();
    setSyncStatus('syncing', 'Connexion à Firebase…');

    // Écoute temps réel sur les 30 derniers jours
    const days30 = last30Days();
    db.collection(FS_COLLECTION)
      .where(firebase.firestore.FieldPath.documentId(), 'in', days30)
      .onSnapshot(
        (snapshot) => {
          isOnline = true;
          snapshot.forEach(doc => { cache[doc.id] = doc.data(); });
          // Mémoriser aussi localement
          localStorage.setItem('caltrack_cache', JSON.stringify(cache));
          setSyncStatus('connected', `Synchronisé · ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}`);
          render();
        },
        (err) => {
          console.error('Firestore error:', err);
          isOnline = false;
          setSyncStatus('error', 'Hors ligne — données locales');
          loadFromLocalStorage();
          render();
        }
      );
  } catch (e) {
    console.error('Firebase init error:', e);
    setSyncStatus('error', 'Firebase non configuré — mode local');
    loadFromLocalStorage();
    render();
  }
}

function loadFromLocalStorage() {
  try {
    cache = JSON.parse(localStorage.getItem('caltrack_cache') || '{}');
  } catch { cache = {}; }
}

/* ---- Écriture Firestore ---- */
async function saveDay(dateStr, dayData) {
  // Toujours sauvegarder en local d'abord
  cache[dateStr] = dayData;
  localStorage.setItem('caltrack_cache', JSON.stringify(cache));

  if (!db || !isOnline) {
    setSyncStatus('error', 'Mode local — sera sync au retour en ligne');
    return;
  }

  setSyncStatus('syncing', 'Sauvegarde…');
  try {
    await db.collection(FS_COLLECTION).doc(dateStr).set(dayData);
    setSyncStatus('connected', `Synchronisé · ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}`);
  } catch (e) {
    console.error('Save error:', e);
    setSyncStatus('error', 'Erreur sync — données sauvées localement');
  }
}

function getDayData(dateStr) {
  if (!cache[dateStr]) cache[dateStr] = { meals: [], activeCalories: 0 };
  return cache[dateStr];
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const today = todayStr();
  const dayData = getDayData(today);

  // Header
  document.getElementById('current-date-header').textContent = formatLong(today);
  document.getElementById('today-date-label').textContent    = formatLong(today);

  renderStrip(today);
  renderToday(dayData, today);
}

/* ---- Bande historique ---- */
function renderStrip(today) {
  const strip = document.getElementById('history-strip');
  strip.innerHTML = '';

  last30Days().forEach(dateStr => {
    const day = cache[dateStr];
    const st  = status(day);
    const c   = day ? consumed(day) : 0;
    const isT = dateStr === today;

    const [,,d] = dateStr.split('-');

    const el = document.createElement('div');
    el.className = `hday s-${st}${isT ? ' is-today' : ''}`;
    el.innerHTML = `
      <span class="hday-label">${isT ? 'auj.' : weekdayLetter(dateStr)}</span>
      <span class="hday-num">${+d}</span>
      <span class="hday-bicep">💪</span>
      <span class="hday-kcal">${c > 0 ? c.toLocaleString('fr-FR')+'k' : '—'}</span>
    `;
    el.onclick = () => openHistoryDetail(dateStr);
    strip.appendChild(el);
  });

  // Auto-scroll vers aujourd'hui
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
  const st = status(day);

  // Badge
  const badge = document.getElementById('badge-status');
  badge.className = `badge-status ${st === 'none' ? '' : st}`;
  badge.textContent = st === 'green' ? '✓ Déficit' : st === 'orange' ? '≈ Équilibré' : st === 'red' ? '↑ Surplus' : '—';

  // Batterie
  const pct  = s2 > 0 ? Math.min(Math.round((c / s2) * 100), 150) : 0;
  const fill = document.getElementById('battery-fill');
  fill.style.width = Math.min(pct, 100) + '%';
  fill.className = 'battery-fill' + (pct > 110 ? ' f-red' : pct > 90 ? ' f-orange' : '');
  document.getElementById('battery-pct').textContent      = pct + '%';
  document.getElementById('battery-consumed').textContent = `${c.toLocaleString('fr-FR')} kcal ingurgitées`;
  document.getElementById('battery-spent').textContent    = `/ ${s2.toLocaleString('fr-FR')} kcal dépensées`;

  // Stats
  document.getElementById('stat-bmr').textContent    = `${BMR.toLocaleString('fr-FR')} kcal`;
  document.getElementById('stat-active').textContent = `${(day.activeCalories||0).toLocaleString('fr-FR')} kcal`;
  const balEl = document.getElementById('stat-balance');
  balEl.textContent = `${b > 0 ? '+' : ''}${b.toLocaleString('fr-FR')} kcal`;
  balEl.style.color = b < -50 ? 'var(--green)' : b > 100 ? 'var(--red)' : 'var(--orange)';

  // Repas
  renderMeals(day.meals || [], dateStr, 'today-meals-list', 'empty-meals');
}

function renderMeals(meals, dateStr, listId, emptyId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const emptyEl = emptyId ? document.getElementById(emptyId) : null;

  if (!meals.length) {
    list.innerHTML = '';
    if (emptyEl) { emptyEl.style.display='block'; list.appendChild(emptyEl); }
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

  if (!type)              { showToast('⚠️ Choisis un type de repas'); return; }
  if (!calories || calories <= 0) { showToast('⚠️ Calories invalides'); return; }

  const day = getDayData(dateStr);
  day.meals = [...(day.meals || []), { type, calories, composition: compo, time: new Date().toISOString() }];
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
  const st  = status(day);
  const isT = dateStr === todayStr();

  const colors = { green:'var(--green)', orange:'var(--orange)', red:'var(--red)', none:'var(--text-muted)' };
  const labels = { green:'💪 Déficit calorique', orange:'🔶 Équilibré', red:'🔴 Surplus calorique', none:'— Aucune donnée' };

  const titleEl = document.getElementById('history-detail-title');
  titleEl.textContent  = isT ? 'Aujourd\'hui' : formatLong(dateStr);
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
      <span>🔥 ${BMR.toLocaleString('fr-FR')} kcal base</span>
      <span>🏃 ${(day.activeCalories||0).toLocaleString('fr-FR')} kcal actives</span>
      <span>🍽️ ${c.toLocaleString('fr-FR')} kcal ingurgitées</span>
      <span style="color:${colors[st]}">⚖️ ${b > 0?'+':''}${b.toLocaleString('fr-FR')} kcal · ${labels[st]}</span>
    </div>
    <div class="meals-list">${mealsHTML}</div>
    <div class="actions-row" style="margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="openMealModal('${dateStr}')">＋ Ajouter un repas</button>
      <button class="btn btn-secondary btn-sm" onclick="openActivityModal('${dateStr}')">🏋️ Modifier l'activité</button>
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
   KEYBOARD SHORTCUTS
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
  // Pré-remplir dates
  document.getElementById('meal-date').value     = todayStr();
  document.getElementById('activity-date').value = todayStr();

  // Charger le cache local immédiatement pour affichage rapide
  loadFromLocalStorage();
  render();

  // Puis connecter Firebase
  initFirebase();

  // Refresh auto à minuit
  const now = new Date();
  const ms  = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 5) - now;
  setTimeout(() => { render(); setInterval(render, 86400000); }, ms);
});
