import {
  Editor,
  Node,
  Extension,
  mergeAttributes,
  InputRule
} from 'https://esm.sh/@tiptap/core@2.11.5';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.11.5';

let db = null;
let SQL = null;
let editor = null;
let stack = [{ name: 'home' }];
let saveQueue = Promise.resolve();
let editorFlush = null;

const app = document.getElementById('app');
const COLORS = ['#ffc500', '#4ecdc4', '#6bcb77', '#54a0ff', '#a78bfa', '#ff6b6b', '#ff9f43', '#f368e0'];
const HOME_APPEARANCE_KEY = 'wiki-home-appearance';
const MODELS = {
  worldbuilding: {
    label: 'Worldbuilding',
    hint: 'Un univers complet avec des catégories prêtes à remplir.',
    categories: ['Personnages', 'Lieux', 'Magie / Système', 'Cosmologie', 'Histoire', 'Galerie']
  },
  prompts: {
    label: 'Vrac / Prompts',
    hint: 'Un projet souple pour les notes, idées et essais.',
    categories: []
  },
  blank: {
    label: 'Vierge',
    hint: 'Un projet vide à organiser entièrement.',
    categories: []
  }
};

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const uid = () => crypto.randomUUID();
const normalize = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const plural = (count, word) => `${word}${count > 1 ? 's' : ''}`;

/* ============================================================
   Icônes : quatre styles interchangeables.
   « emoji » reproduit le rendu actuel ; les trois autres sont des
   SVG en currentColor, donc ils prennent la couleur du contexte.
   Changer de style se fait dans Paramètres → Apparence.
   ============================================================ */
const ICON_STYLE_KEY = 'wiki-icon-style';
const ICON_LABELS = {
  emoji: 'Emoji',
  line: 'Traits fins',
  bold: 'Traits épais',
  duo: 'Duotone'
};
const ICON_SAMPLE = ['home', 'star', 'settings', 'trash'];

const ICON_PATHS = {
  home:     { emoji: '⌂', svg: '<path d="M3 10 12 3l9 7"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>' },
  inbox:    { emoji: '📥', svg: '<path d="M22 13h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 13v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5l-3.5-7.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>' },
  layers:   { emoji: '🗂', svg: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>' },
  star:     { emoji: '★', svg: '<path d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17l-6.1 3.6 1.4-6.8L2.2 9.1l6.9-.8z"/>' },
  trash:    { emoji: '🗑', svg: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>' },
  export:   { emoji: '💾', svg: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>' },
  import:   { emoji: '📂', svg: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6"/><path d="m9.5 13.5 2.5-2.5 2.5 2.5"/>' },
  theme:    { emoji: '◐', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>' },
  settings: { emoji: '⚙︎', svg: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"/>' },
  palette:  { emoji: '🎨', svg: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2.2-.9 2.2-2 0-.6-.3-1-.3-1.6 0-1 .8-1.9 1.9-1.9H18a3.5 3.5 0 0 0 3.5-3.5C21.5 7 17.2 3 12 3z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1" fill="currentColor" stroke="none"/>' },
  book:     { emoji: '📖', svg: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
  templates:{ emoji: '🧩', svg: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>' },
  search:   { emoji: '⌕', svg: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/>' },
  gallery:  { emoji: '▦', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L7 20"/>' },
  edit:     { emoji: '✎', svg: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  page:     { emoji: '📄', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' },
  recent:   { emoji: '🕘', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  plus:     { emoji: '+', svg: '<path d="M12 5v14M5 12h14"/>' }
};

function icon(name, opts = {}) {
  const style = opts.style || (localStorage.getItem(ICON_STYLE_KEY) || 'emoji');
  const cls = opts.cls ? ` ${opts.cls}` : '';
  if (style === 'emoji' || !ICON_PATHS[name]) {
    return `<span class="ic ic-emoji${cls}">${(ICON_PATHS[name] || {}).emoji || ''}</span>`;
  }
  const width = style === 'bold' ? 2.6 : 1.9;
  return `<svg class="ic ic-svg ic-${style}${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name].svg}</svg>`;
}

function strip(html) {
  const documentHTML = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (documentHTML.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/* Texte de recherche pré-calculé : évite de repasser un DOMParser
   sur chaque page à chaque frappe. */
/* « Sans titre » est un titre comme un autre : il doit être trouvable
   par la recherche et se ranger à sa lettre dans le tri alphabétique. */
const UNTITLED = 'Sans titre';
const displayTitle = title => String(title ?? '').trim() || UNTITLED;

const buildSearchText = (title, body, infobox) =>
  normalize(`${displayTitle(title)} ${strip(body || '')} ${infoboxText(parseInfobox(infobox))}`);

/* Même chose côté SQL : un titre vide est remplacé au moment du tri. */
const TITLE_SORT = `COALESCE(NULLIF(TRIM(title), ''), '${UNTITLED}') COLLATE NOCASE`;

function fmt(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function sanitizeHTML(html) {
  const allowed = new Set([
    'P', 'BR', 'STRONG', 'EM', 'S', 'H2', 'H3', 'H4',
    'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'PRE', 'CODE', 'A', 'IMG'
  ]);
  const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');

  [...parsed.body.querySelectorAll('*')].forEach(element => {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }

    [...element.attributes].forEach(attribute => {
      if (element.tagName === 'IMG') {
        /* Seule une image base64 compressée par l'app ou une URL HTTPS
           est conservée : rien d'autre ne peut entrer dans le corps. */
        if (attribute.name === 'src' && !safeImage(attribute.value)) {
          element.remove();
          return;
        }
        if (!['src', 'alt'].includes(attribute.name)) element.removeAttribute(attribute.name);
        return;
      }
      const wikiId = element.tagName === 'A' && attribute.name === 'data-wikilink';
      const wikiClass = element.tagName === 'A' && attribute.name === 'class' && attribute.value === 'wikilink';
      if (!wikiId && !wikiClass) element.removeAttribute(attribute.name);
    });
  });

  return parsed.body.innerHTML;
}

function safeImage(value) {
  const image = String(value || '');
  return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(image) || /^https:\/\//i.test(image)
    ? image
    : '';
}

function q(sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

const run = (sql, params = []) => db.run(sql, params);
const getPage = id => q('SELECT * FROM pages WHERE id = ?', [id])[0];
const getSpace = id => q('SELECT * FROM spaces WHERE id = ?', [id])[0];
const getCategory = id => q('SELECT * FROM categories WHERE id = ?', [id])[0];
const getSpaceCategories = id => q('SELECT * FROM categories WHERE space_id = ? ORDER BY position, created_at', [id]);
const getPageCategories = id => q(`
  SELECT c.* FROM categories c
  JOIN page_categories pc ON pc.category_id = c.id
  WHERE pc.page_id = ?
  ORDER BY c.position
`, [id]);

/* Nombre de pages par catégorie, pour la pastille des vignettes. */
function categoryCounts(spaceId) {
  const rows = q(`
    SELECT pc.category_id AS id, COUNT(*) AS n
    FROM page_categories pc
    JOIN categories c ON c.id = pc.category_id
    JOIN pages p ON p.id = pc.page_id
    WHERE c.space_id = ? AND p.deleted_at IS NULL
    GROUP BY pc.category_id
  `, [spaceId]);
  return Object.fromEntries(rows.map(row => [row.id, row.n]));
}

function transaction(callback) {
  run('BEGIN');
  try {
    const result = callback();
    run('COMMIT');
    return result;
  } catch (error) {
    run('ROLLBACK');
    throw error;
  }
}

async function initDB() {
  if (typeof initSqlJs === 'undefined') throw new Error('SQL.js non chargé');

  SQL = await initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  });

  let bytes = null;
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('wiki.db');
    bytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
  } catch {
    const raw = localStorage.getItem('wiki-db');
    if (raw) bytes = Uint8Array.from(atob(raw), character => character.charCodeAt(0));
  }

  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  run('PRAGMA foreign_keys = ON');
  run('CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY,name TEXT,emoji TEXT,color TEXT,created_at INTEGER,image TEXT,banner TEXT,home_body TEXT,model TEXT,accent_color TEXT,header_color TEXT,background_color TEXT,page_color TEXT)');
  run('CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY,title TEXT,body TEXT,created_at INTEGER,updated_at INTEGER,is_inbox INTEGER DEFAULT 1,space_id TEXT,template_id TEXT,infobox TEXT,cover TEXT,is_pinned INTEGER DEFAULT 0,title_align TEXT DEFAULT "left",search_text TEXT,deleted_at INTEGER)');
  run('CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,name TEXT,emoji TEXT,fields TEXT,created_at INTEGER)');
  run('CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY,space_id TEXT,name TEXT,intro TEXT,banner TEXT,template_id TEXT,position INTEGER,created_at INTEGER,parent_id TEXT,color TEXT)');
  run('CREATE TABLE IF NOT EXISTS page_categories (page_id TEXT,category_id TEXT,PRIMARY KEY(page_id,category_id))');
  run('CREATE TABLE IF NOT EXISTS page_gallery (id TEXT PRIMARY KEY,page_id TEXT,data_url TEXT,caption TEXT,position INTEGER,created_at INTEGER)');

  const ensureColumn = (table, column, type) => {
    if (!q(`PRAGMA table_info(${table})`).some(item => item.name === column)) {
      run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };

  [
    ['pages', 'space_id', 'TEXT'],
    ['pages', 'template_id', 'TEXT'],
    ['pages', 'infobox', 'TEXT'],
    ['pages', 'cover', 'TEXT'],
    ['pages', 'is_pinned', 'INTEGER DEFAULT 0'],
    ['pages', 'title_align', 'TEXT DEFAULT "left"'],
    ['pages', 'search_text', 'TEXT'],
    ['pages', 'deleted_at', 'INTEGER'],
    ['pages', 'cover_ratio', 'TEXT'],
    ['pages', 'cover_pos', 'INTEGER'],
    ['spaces', 'image', 'TEXT'],
    ['spaces', 'banner', 'TEXT'],
    ['spaces', 'home_body', 'TEXT'],
    ['spaces', 'model', 'TEXT'],
    ['spaces', 'accent_color', 'TEXT'],
    ['spaces', 'header_color', 'TEXT'],
    ['spaces', 'background_color', 'TEXT'],
    ['spaces', 'page_color', 'TEXT'],
    ['categories', 'parent_id', 'TEXT'],
    ['categories', 'color', 'TEXT']
  ].forEach(item => ensureColumn(...item));

  run('CREATE INDEX IF NOT EXISTS idx_pages_space_updated ON pages(space_id, updated_at DESC)');
  run('CREATE INDEX IF NOT EXISTS idx_categories_space ON categories(space_id, position)');
  run('CREATE INDEX IF NOT EXISTS idx_gallery_page ON page_gallery(page_id, position)');
  run('CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(deleted_at)');

  backfillSearchText();
  backfillUntitled();
  purgeTrash();

  /* Sans cet appel, le navigateur peut purger la base sous pression disque. */
  try { await navigator.storage.persist(); } catch { /* non bloquant */ }

  await saveDB();
}

/* ---- Corbeille ----
   Une page supprimée n'est jamais détruite tout de suite : on pose
   deleted_at, et la purge n'intervient qu'au lancement suivant, une fois
   le délai écoulé. Toute requête qui liste des pages doit donc filtrer
   sur « deleted_at IS NULL ». */
const TRASH_DAYS = 30;

function hardDeletePage(id) {
  run('DELETE FROM page_gallery WHERE page_id = ?', [id]);
  run('DELETE FROM page_categories WHERE page_id = ?', [id]);
  run('DELETE FROM pages WHERE id = ?', [id]);
}

function purgeTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  const doomed = q('SELECT id FROM pages WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
  if (!doomed.length) return 0;
  transaction(() => doomed.forEach(({ id }) => hardDeletePage(id)));
  return doomed.length;
}

const trashCount = () =>
  q('SELECT COUNT(*) count FROM pages WHERE deleted_at IS NOT NULL')[0].count;

function backfillSearchText() {
  const missing = q('SELECT id, title, body, infobox FROM pages WHERE search_text IS NULL');
  if (!missing.length) return;
  transaction(() => {
    missing.forEach(page => {
      run('UPDATE pages SET search_text = ? WHERE id = ?', [buildSearchText(page.title, page.body, page.infobox), page.id]);
    });
  });
}

/* Les pages sans titre créées avant ce changement n'ont pas « sans titre »
   dans leur index : on le rattrape une fois. */
function backfillUntitled() {
  const rows = q(`
    SELECT id, title, body, infobox FROM pages
    WHERE TRIM(COALESCE(title, '')) = ''
      AND (search_text IS NULL OR search_text NOT LIKE '%sans titre%')
  `);
  if (!rows.length) return;
  transaction(() => {
    rows.forEach(page => {
      run('UPDATE pages SET search_text = ? WHERE id = ?',
        [buildSearchText(page.title, page.body, page.infobox), page.id]);
    });
  });
}

function saveDB() {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const bytes = db.export();
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle('wiki.db', { create: true });
      const writer = await fileHandle.createWritable();
      await writer.write(bytes);
      await writer.close();
      localStorage.removeItem('wiki-db');
    } catch {
      let binary = '';
      for (let index = 0; index < bytes.length; index += 32768) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      }
      localStorage.setItem('wiki-db', btoa(binary));
    }
  });
  return saveQueue;
}

function contrast(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#111';
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return (red * .299 + green * .587 + blue * .114) / 255 > .58 ? '#111' : '#fff';
}

function normalizeHex(value) {
  const hex = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex.slice(1).split('').map(character => character.repeat(2)).join('')}`.toUpperCase();
  }
  return null;
}

function homeAppearanceDefaults() {
  const light = document.documentElement.dataset.theme === 'light';
  return {
    header: '#0C0C0C',
    background: light ? '#FBFBFB' : '#0C0C0C'
  };
}

function getHomeAppearance() {
  const defaults = homeAppearanceDefaults();

  try {
    const saved = JSON.parse(localStorage.getItem(HOME_APPEARANCE_KEY) || '{}');
    return {
      header: normalizeHex(saved.header) || defaults.header,
      background: normalizeHex(saved.background) || defaults.background
    };
  } catch {
    return defaults;
  }
}

function applyHomeAppearance(appearance) {
  document.body.style.setProperty('--header-bg', appearance.header);
  document.body.style.setProperty('--header-text', contrast(appearance.header));
  document.body.style.setProperty('--project-bg', appearance.background);
  document.body.style.setProperty('--project-text', contrast(appearance.background));
}

function globalThemeDefaults() {
  const light = document.documentElement.dataset.theme === 'light';
  return {
    accent: '#FFC500',
    header: '#FFC500',
    background: light ? '#FBFBFB' : '#0C0C0C',
    page: light ? '#F4F4F4' : '#191919'
  };
}

function getSpacePalette(space) {
  const defaults = globalThemeDefaults();
  const legacyColor = normalizeHex(space?.color);
  return {
    accent: normalizeHex(space?.accent_color) || legacyColor || defaults.accent,
    header: normalizeHex(space?.header_color) || legacyColor || defaults.header,
    background: normalizeHex(space?.background_color) || defaults.background,
    page: normalizeHex(space?.page_color) || defaults.page
  };
}

function applyPalette(palette) {
  document.body.style.setProperty('--accent', palette.accent);
  document.body.style.setProperty('--on-accent', contrast(palette.accent));
  document.body.style.setProperty('--context-bg', palette.header);
  document.body.style.setProperty('--context-text', contrast(palette.header));
  document.body.style.setProperty('--project-bg', palette.background);
  document.body.style.setProperty('--project-text', contrast(palette.background));
  /* Le fond des articles prend une pointe de la couleur du projet,
     comme le fait Fandom : chaque wiki garde une ambiance propre. */
  document.body.style.setProperty(
    '--project-page-bg',
    `color-mix(in srgb, ${palette.header} 7%, ${palette.page})`
  );
  document.body.style.setProperty('--project-page-text', contrast(palette.page));
}

/* La barre système Android suit toujours le header, jamais la couleur du projet. */
function syncStatusBar() {
  const value = getComputedStyle(document.body).getPropertyValue('--header-bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = value || '#0C0C0C';
}

function currentSpace() {
  for (let index = stack.length - 1; index >= 0; index--) {
    const route = stack[index];
    if (route.name === 'space') return getSpace(route.param) || null;
    if (route.name === 'category') return getSpace(getCategory(route.param)?.space_id) || null;
    if (['read', 'edit', 'gallery'].includes(route.name)) {
      return getSpace(getPage(route.param)?.space_id) || null;
    }
  }
  return null;
}

function applyTheme() {
  const space = currentSpace();
  document.body.style.removeProperty('--header-bg');
  document.body.style.removeProperty('--header-text');

  if (!space) {
    [
      '--accent', '--on-accent', '--context-bg', '--context-text',
      '--project-bg', '--project-text', '--project-page-bg', '--project-page-text'
    ].forEach(property => document.body.style.removeProperty(property));
    if (stack.at(-1)?.name === 'home') {
      applyHomeAppearance(getHomeAppearance());
    }
    syncStatusBar();
    return;
  }

  applyPalette(getSpacePalette(space));
  syncStatusBar();
}

const logoHTML = () => '<span class="logo"><span class="w">W</span>iki</span>';

function globalHeader(title = '') {
  return `
    <header class="top global">
      <button type="button" class="menu-btn" id="openMenu" aria-label="Menu global">
        <span></span><span></span><span></span>
      </button>
      ${title
        ? `<div class="title">${esc(title)}</div>`
        : `<button type="button" class="logo" id="logoHome"><span class="w">W</span>iki</button>`}
      <div class="header-actions">
        <button type="button" class="search-icon-btn" id="searchBtn" aria-label="Rechercher">Rechercher</button>
      </div>
    </header>
  `;
}

function contextBar(space, page = null) {
  if (!space) return '';

  return `
    <div class="top-context">
      <button type="button" class="ctx-toc-btn" id="ctxToc" aria-label="Menu du projet">☷</button>
      <div class="ctx-body"><div class="ctx-name">${esc(page?.title || space.name)}</div></div>
      ${page ? `<button type="button" class="ctx-action" id="ctxPin" aria-label="${page.is_pinned ? 'Désépingler' : 'Épingler'}" aria-pressed="${Boolean(page.is_pinned)}">${page.is_pinned ? '★' : '☆'}</button>` : ''}
    </div>
  `;
}

function wrapHeader(space, page, main) {
  return `<div class="header-stack">${main}${contextBar(space, page)}</div>`;
}

function bindGlobal() {
  document.getElementById('openMenu')?.addEventListener('click', openGlobalDrawer);
  document.getElementById('searchBtn')?.addEventListener('click', () => go('search'));
  document.getElementById('logoHome')?.addEventListener('click', goHome);
  document.getElementById('ctxToc')?.addEventListener('click', openContextDrawer);
  document.getElementById('ctxPin')?.addEventListener('click', () => togglePin(stack.at(-1).param));
}

function pageCard(page) {
  const text = strip(page.body);
  const space = page.space_id ? getSpace(page.space_id) : null;
  return `
    <button type="button" class="card page-card" data-page="${esc(page.id)}">
      <div class="t">${esc(page.title?.trim() || 'Sans titre')}${page.is_pinned ? ' ★' : ''}</div>
      ${text
        ? `<div class="p">${esc(text.slice(0, 130))}</div>`
        : '<div class="p vide">Page vide</div>'}
      <div class="d">${esc(space?.name || 'Inbox')} · ${fmt(page.updated_at)}</div>
    </button>
  `;
}

function rcard(page) {
  const space = page.space_id ? getSpace(page.space_id) : null;
  const cover = safeImage(page.cover);
  const initial = esc((page.title?.trim() || '?')[0] || '?');
  const icon = space ? safeImage(space.image) : '';
  const iconColor = space ? getSpacePalette(space).accent : '#3d3d3c';

  return `
    <div class="rcard-shell">
      <button type="button" class="rcard" data-page="${esc(page.id)}">
        <div class="rcard-img">${cover
          ? `<img src="${esc(cover)}" alt="">`
          : `<span class="rcard-ph">${initial}</span>`}</div>
        <div class="rcard-t">${esc(page.title?.trim() || 'Sans titre')}</div>
        <div class="rcard-m">
          <span class="rcard-ico" data-space-icon="${esc(icon)}"
                style="background-color:${iconColor};color:${contrast(iconColor)}">${icon ? '' : esc(space ? (space.emoji || space.name[0]) : '📥')}</span>
          <span>${esc(space?.name || 'Inbox')}</span>
        </div>
      </button>
      <button
        type="button"
        class="rcard-menu-button"
        data-recent-menu="${esc(page.id)}"
        aria-label="Actions pour ${esc(page.title?.trim() || 'Sans titre')}"
      >⋮</button>
    </div>
  `;
}

function entityCard(page) {
  return `
    <button type="button" class="entity-card" data-page="${esc(page.id)}">
      ${safeImage(page.cover) ? `<img src="${esc(safeImage(page.cover))}" alt="">` : `<div class="entity-placeholder">${esc((page.title || '?')[0])}</div>`}
      <span class="entity-name">${esc(page.title?.trim() || 'Sans titre')}</span>
    </button>
  `;
}

function portalCard(category, count = 0) {
  const banner = safeImage(category.banner);
  return `
    <button type="button" class="portal-card${banner ? '' : ' portal-card--empty'}" data-category="${esc(category.id)}">
      ${banner ? `<img src="${esc(banner)}" alt="">` : `<div class="portal-placeholder">${esc(category.name[0])}</div>`}
      <span class="portal-name">${esc(category.name)}</span>
      <span class="portal-mark">${count}</span>
    </button>
  `;
}

function paintSpaceIcons(root = app) {
  root.querySelectorAll('[data-space-icon]').forEach(element => {
    const image = element.dataset.spaceIcon;
    if (image) element.style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`;
  });
}

function wirePages(root = app) {
  root.querySelectorAll('[data-page]').forEach(element => {
    element.addEventListener('click', () => go('read', element.dataset.page));
  });
  root.querySelectorAll('[data-category]').forEach(element => {
    element.addEventListener('click', () => go('category', element.dataset.category));
  });
}

function screenHome() {
  const spaces = q('SELECT * FROM spaces ORDER BY created_at');
  const recent = q('SELECT id,title,cover,space_id,updated_at FROM pages WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 8');
  const inbox = q('SELECT COUNT(*) count FROM pages WHERE space_id IS NULL AND deleted_at IS NULL')[0].count;
  const pinned = q('SELECT id,title,cover,space_id,updated_at FROM pages WHERE is_pinned = 1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 8');

  app.innerHTML = `
    ${globalHeader()}
    <main>
      ${pinned.length ? `
        <div class="sec-row"><div class="sec">★ Épinglées</div><button type="button" class="sec-link" id="pinnedAll">Voir tout</button></div>
        <div class="hscroll">${pinned.map(rcard).join('')}</div>
      ` : ''}
      <div class="sec-row"><div class="sec">Re-plongez-vous</div><button type="button" class="sec-link" id="recentAll">Voir tout</button></div>
      <div class="hscroll">${recent.map(rcard).join('') || '<div class="empty">Rien pour le moment.</div>'}</div>
      <div class="sec">Mes projets</div>
      <div class="hscroll avatars grid-projects">
        ${spaces.map(space => {
          const image = safeImage(space.image);
          const iconColor = getSpacePalette(space).accent;
          return `<button type="button" class="avatar" data-space="${esc(space.id)}"><span class="av-c" data-avatar-image="${esc(image)}" style="background-color:${iconColor};color:${contrast(iconColor)}">${image ? '' : esc(space.emoji || space.name[0])}</span><span class="av-n">${esc(space.name)}</span></button>`;
        }).join('')}
        <button type="button" class="avatar" id="newSpace"><span class="av-c av-add">+</span><span class="av-n">Créer</span></button>
      </div>
      <button type="button" class="card row" id="toInbox"><span class="emo">${icon('inbox')}</span><span class="grow"><span class="t">Inbox</span><span class="p">Idées non classées</span></span>${inbox ? `<span class="badge">${inbox}</span>` : ''}</button>
      <button type="button" class="card row" id="toTemplates"><span class="emo">${icon('templates')}</span><span class="grow"><span class="t">Templates</span><span class="p">Fiches réutilisables</span></span></button>
    </main>
    <button type="button" class="fab" id="fab" aria-label="Nouvelle page">+</button>
  `;

  bindGlobal();
  app.querySelectorAll('[data-avatar-image]').forEach(element => {
    if (element.dataset.avatarImage) element.style.backgroundImage = `url("${element.dataset.avatarImage.replace(/"/g, '%22')}")`;
  });
  paintSpaceIcons();
  app.querySelectorAll('[data-space]').forEach(element => {
    element.addEventListener('click', () => go('space', element.dataset.space));
  });
  document.getElementById('newSpace').onclick = () => go('newspace');
  document.getElementById('toInbox').onclick = () => go('inbox');
  document.getElementById('toTemplates').onclick = () => go('templates');
  document.getElementById('recentAll').onclick = () => go('library', 'all');
  document.getElementById('pinnedAll')?.addEventListener('click', () => go('library', 'pinned'));
  document.getElementById('fab').onclick = () => quickNote(null);
  wirePages();
  app.querySelectorAll('[data-recent-menu]').forEach(button => {
    button.onclick = () => openRecentPageMenu(button, button.dataset.recentMenu);
  });
}

function screenNewSpace() {
  let model = 'worldbuilding';
  let color = COLORS[0];

  app.innerHTML = `
    ${globalHeader('Nouveau projet')}
    <main><form id="newSpaceForm">
      <fieldset><legend class="lab">Modèle</legend><div class="model-grid">${Object.entries(MODELS).map(([key, item]) => `<button type="button" class="model-card" data-model="${key}" aria-pressed="${key === model}"><b>${esc(item.label)}</b><span>${esc(item.hint)}</span></button>`).join('')}</div></fieldset>
      <label class="lab" for="spaceName">Nom du projet</label><input class="field" id="spaceName" maxlength="80" required placeholder="Mon univers, mes prompts...">
      <label class="lab" for="spaceEmoji">Symbole court</label><input class="field" id="spaceEmoji" maxlength="2" placeholder="W">
      <fieldset><legend class="lab">Couleur du projet</legend><div class="swatches">${COLORS.map(item => `<button type="button" class="sw" data-color="${item}" style="background:${item}" aria-label="Couleur ${item}" aria-pressed="${item === color}"></button>`).join('')}</div></fieldset>
      <button class="btn-accent quick" type="submit">Créer le projet</button>
    </form></main>
  `;

  bindGlobal();
  app.querySelectorAll('[data-model]').forEach(button => button.onclick = () => {
    model = button.dataset.model;
    app.querySelectorAll('[data-model]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  });
  app.querySelectorAll('[data-color]').forEach(button => button.onclick = () => {
    color = button.dataset.color;
    app.querySelectorAll('[data-color]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  });

  document.getElementById('newSpaceForm').onsubmit = async event => {
    event.preventDefault();
    const name = document.getElementById('spaceName').value.trim();
    if (!name) return toast('Donne un nom au projet.', true);

    const id = uid();
    const now = Date.now();
    transaction(() => {
      run('INSERT INTO spaces (id,name,emoji,color,created_at,home_body,model) VALUES (?,?,?,?,?,?,?)', [id, name, document.getElementById('spaceEmoji').value.trim() || name[0], color, now, 'Bienvenue dans ce projet. Ajoute une introduction pour lui donner une identité.', model]);
      MODELS[model].categories.forEach((category, position) => {
        run('INSERT INTO categories (id,space_id,name,intro,banner,position,created_at) VALUES (?,?,?,?,?,?,?)', [uid(), id, category, '', '', position, now]);
      });
    });
    await saveDB();
    go('space', id);
  };
}

function screenSpace(id) {
  const space = getSpace(id);
  if (!space) return goHome();
  const categories = getSpaceCategories(id);
  const counts = categoryCounts(id);
  const pages = q('SELECT * FROM pages WHERE space_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC', [id]);
  const illustrated = pages.filter(page => page.cover).length;

  app.innerHTML = `
    ${wrapHeader(space, null, globalHeader())}
    <main class="project-home">
      ${safeImage(space.banner) ? `<div class="space-hero"><img src="${esc(safeImage(space.banner))}" alt=""></div>` : ''}
      <section class="project-intro">
        <h1 class="project-title">${esc(space.name)}</h1>
        <div class="project-body">${esc(space.home_body || 'Ce projet n’a pas encore d’introduction.')}</div>
        <div class="project-actions"><button type="button" class="action-link" id="editSpace">Modifier le projet</button><button type="button" class="action-link" id="randomPage">Page au hasard</button></div>
      </section>
      <div class="project-stats">
        <div class="project-stat"><b>${pages.length}</b><span>${plural(pages.length, 'Page')}</span></div>
        <div class="project-stat"><b>${categories.length}</b><span>${plural(categories.length, 'Catégorie').replace('Catégories', 'Catégories')}</span></div>
        <div class="project-stat"><b>${illustrated}</b><span>${plural(illustrated, 'Illustrée')}</span></div>
      </div>
      <div class="sec-row"><div class="sec">Catégories</div><button type="button" class="sec-link" id="newCategory">+ Ajouter</button></div>
      ${categories.length
        ? `<div class="portal-grid">${categories.map(category => portalCard(category, counts[category.id] || 0)).join('')}</div>`
        : '<div class="category-empty">Aucune catégorie.<br>Ajoute-en une pour organiser tes pages.</div>'}
      <div class="sec-row"><div class="sec">Dernières pages</div><button type="button" class="sec-link" id="importHere">＋ Importer</button><button type="button" class="sec-link" id="allPages">Voir tout</button></div>
      ${pages.slice(0, 4).map(pageCard).join('') || '<div class="empty project-empty">Aucune page dans ce projet.</div>'}
    </main>
    <button type="button" class="fab" id="fab" aria-label="Nouvelle page">+</button>
  `;

  bindGlobal();
  document.getElementById('editSpace').onclick = () => editSpace(space);
  document.getElementById('newCategory').onclick = () => createCategory(space.id);
  document.getElementById('importHere').onclick = () => importJSON(id);
  document.getElementById('allPages').onclick = () => go('library', `space:${id}`);
  document.getElementById('fab').onclick = () => quickNote(id);
  document.getElementById('randomPage').onclick = () => pages.length
    ? go('read', pages[Math.floor(Math.random() * pages.length)].id)
    : toast('Aucune page dans ce projet.');
  wirePages();
}

/* Sans ce dialogue, les modèles « Vrac » et « Vierge » ne pouvaient
   jamais recevoir la moindre catégorie. */
function createCategory(spaceId) {
  openDialog('Nouvelle catégorie', `
    <form id="newCatForm">
      <label class="lab" for="newCatName">Nom</label>
      <input class="field" id="newCatName" maxlength="80" required placeholder="Personnages, Lieux, Notes...">
      <label class="lab" for="newCatIntro">Introduction (optionnel)</label>
      <textarea class="field" id="newCatIntro" rows="3"></textarea>
      <button class="btn-accent quick" type="submit">Créer la catégorie</button>
    </form>
  `, dialog => {
    const input = dialog.querySelector('#newCatName');
    input.focus();

    dialog.querySelector('#newCatForm').onsubmit = async event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return toast('Donne un nom à la catégorie.', true);

      const max = q('SELECT MAX(position) position FROM categories WHERE space_id = ?', [spaceId])[0].position;
      run('INSERT INTO categories (id,space_id,name,intro,banner,position,created_at) VALUES (?,?,?,?,?,?,?)', [
        uid(),
        spaceId,
        name,
        dialog.querySelector('#newCatIntro').value.trim(),
        null,
        (max ?? -1) + 1,
        Date.now()
      ]);
      await saveDB();
      dialog.remove();
      render();
      toast('Catégorie créée.');
    };
  });
}

function editSpace(space) {
  const initialPalette = getSpacePalette(space);
  let projectImage = safeImage(space.image) || null;
  let projectBanner = safeImage(space.banner) || null;

  openDialog('Modifier le projet', `
    <form id="spaceEditForm">
      <label class="lab" for="spaceNameEdit">Nom du projet</label>
      <input class="field" id="spaceNameEdit" maxlength="80" value="${esc(space.name)}" required>

      <label class="lab" for="homeBody">Introduction</label><textarea class="field" id="homeBody" rows="6">${esc(space.home_body || '')}</textarea>

      <fieldset class="project-images-editor">
        <legend class="lab">Images du projet</legend>

        <div class="project-image-setting">
          <span class="theme-color-label">Icône du projet</span>
          <button type="button" class="project-image-preview project-image-preview--avatar" id="projectImagePreview" aria-label="Choisir l'icône du projet"></button>
          <div class="project-image-actions">
            <button type="button" class="btn-ghost" id="chooseProjectImage">Choisir une image</button>
            <button type="button" class="btn-ghost danger-text" id="removeProjectImage">Retirer</button>
          </div>
        </div>

        <div class="project-image-setting">
          <span class="theme-color-label">Bannière de l'accueil</span>
          <button type="button" class="project-image-preview project-image-preview--banner" id="projectBannerPreview" aria-label="Choisir la bannière du projet"></button>
          <div class="project-image-actions">
            <button type="button" class="btn-ghost" id="chooseProjectBanner">Choisir une image</button>
            <button type="button" class="btn-ghost danger-text" id="removeProjectBanner">Retirer</button>
          </div>
        </div>
      </fieldset>

      <fieldset class="theme-editor">
        <legend class="lab">Thème du projet</legend>
        <p class="theme-help">Choisis une couleur ou saisis un code hexadécimal, par exemple #FF982D.</p>

        ${themeColorField('themeAccent', 'Accent et liens', initialPalette.accent)}
        ${themeColorField('themeHeader', 'Barre du wiki', initialPalette.header)}
        ${themeColorField('themeBackground', 'Fond du wiki', initialPalette.background)}
        ${themeColorField('themePage', 'Fond des articles', initialPalette.page)}

        <div class="theme-preview" id="themePreview" aria-label="Aperçu du thème">
          <div class="theme-preview-head">${esc(space.name)}</div>
          <div class="theme-preview-body">
            <span>Aperçu du wiki</span>
            <div class="theme-preview-page">Aperçu d'un article et de ses liens.</div>
          </div>
        </div>

        <button type="button" class="btn-ghost theme-reset" id="resetTheme">Réinitialiser le thème</button>
      </fieldset>

      <button class="btn-accent quick" type="submit">Enregistrer</button>

      <div class="danger-zone">
        <p>Supprimer ce projet conserve ses pages : elles retournent dans l'Inbox. Les catégories, elles, sont perdues.</p>
        <button type="button" class="btn-danger" id="deleteSpace">Supprimer le projet</button>
      </div>
    </form>
  `, dialog => {
    let resetTheme = false;
    const controls = [
      ['themeAccent', 'accent'],
      ['themeHeader', 'header'],
      ['themeBackground', 'background'],
      ['themePage', 'page']
    ];

    const imagePreview = dialog.querySelector('#projectImagePreview');
    const bannerPreview = dialog.querySelector('#projectBannerPreview');

    const updateImagePreviews = () => {
      imagePreview.style.backgroundImage = projectImage ? `url("${projectImage.replace(/"/g, '%22')}")` : '';
      imagePreview.textContent = projectImage ? '' : (space.emoji || space.name[0] || 'W');
      imagePreview.classList.toggle('is-empty', !projectImage);

      bannerPreview.style.backgroundImage = projectBanner ? `url("${projectBanner.replace(/"/g, '%22')}")` : '';
      bannerPreview.textContent = projectBanner ? '' : 'Aucune bannière';
      bannerPreview.classList.toggle('is-empty', !projectBanner);

      dialog.querySelector('#removeProjectImage').disabled = !projectImage;
      dialog.querySelector('#removeProjectBanner').disabled = !projectBanner;
    };

    dialog.querySelector('#chooseProjectImage').onclick = async () => {
      const image = await pickImage();
      if (image) {
        projectImage = image;
        updateImagePreviews();
      }
    };
    imagePreview.onclick = dialog.querySelector('#chooseProjectImage').onclick;
    dialog.querySelector('#removeProjectImage').onclick = () => {
      projectImage = null;
      updateImagePreviews();
    };

    dialog.querySelector('#chooseProjectBanner').onclick = async () => {
      const image = await pickImage();
      if (image) {
        projectBanner = image;
        updateImagePreviews();
      }
    };
    bannerPreview.onclick = dialog.querySelector('#chooseProjectBanner').onclick;
    dialog.querySelector('#removeProjectBanner').onclick = () => {
      projectBanner = null;
      updateImagePreviews();
    };

    dialog.querySelector('#deleteSpace').onclick = () => {
      dialog.remove();
      deleteSpace(space);
    };

    const readPalette = () => Object.fromEntries(controls.map(([id, key]) => [
      key,
      normalizeHex(dialog.querySelector(`#${id}Text`).value)
    ]));

    const updatePreview = () => {
      const palette = readPalette();
      if (Object.values(palette).some(value => !value)) return;

      applyPalette(palette);
      imagePreview.style.backgroundColor = palette.header;
      imagePreview.style.color = contrast(palette.header);
      const preview = dialog.querySelector('#themePreview');
      preview.style.setProperty('--preview-accent', palette.accent);
      preview.style.setProperty('--preview-header', palette.header);
      preview.style.setProperty('--preview-header-text', contrast(palette.header));
      preview.style.setProperty('--preview-background', palette.background);
      preview.style.setProperty('--preview-background-text', contrast(palette.background));
      preview.style.setProperty('--preview-page', palette.page);
      preview.style.setProperty('--preview-page-text', contrast(palette.page));
    };

    controls.forEach(([id]) => {
      const picker = dialog.querySelector(`#${id}Picker`);
      const text = dialog.querySelector(`#${id}Text`);

      picker.oninput = () => {
        resetTheme = false;
        text.value = picker.value.toUpperCase();
        text.setAttribute('aria-invalid', 'false');
        updatePreview();
      };

      text.oninput = () => {
        resetTheme = false;
        const normalized = normalizeHex(text.value);
        text.setAttribute('aria-invalid', String(!normalized));
        if (normalized) {
          picker.value = normalized;
          updatePreview();
        }
      };

      text.onblur = () => {
        const normalized = normalizeHex(text.value);
        if (normalized) text.value = normalized;
      };
    });

    dialog.querySelector('#resetTheme').onclick = () => {
      resetTheme = true;
      const defaults = globalThemeDefaults();
      const legacyColor = normalizeHex(space.color);
      if (legacyColor) {
        defaults.accent = legacyColor;
        defaults.header = legacyColor;
      }
      controls.forEach(([id, key]) => {
        dialog.querySelector(`#${id}Picker`).value = defaults[key];
        dialog.querySelector(`#${id}Text`).value = defaults[key];
        dialog.querySelector(`#${id}Text`).setAttribute('aria-invalid', 'false');
      });
      updatePreview();
    };

    dialog.addEventListener('dialog-cancel', applyTheme, { once: true });
    updateImagePreviews();
    updatePreview();

    dialog.querySelector('#spaceEditForm').onsubmit = async event => {
      event.preventDefault();

      const name = dialog.querySelector('#spaceNameEdit').value.trim();
      if (!name) return toast('Le nom du projet est obligatoire.', true);

      const palette = readPalette();
      if (Object.values(palette).some(value => !value)) {
        return toast('Vérifie les codes couleur. Utilise #RGB ou #RRGGBB.', true);
      }

      run(`
        UPDATE spaces
        SET name = ?, home_body = ?, image = ?, banner = ?, accent_color = ?, header_color = ?,
            background_color = ?, page_color = ?
        WHERE id = ?
      `, [
        name,
        dialog.querySelector('#homeBody').value.trim(),
        projectImage,
        projectBanner,
        resetTheme ? null : palette.accent,
        resetTheme ? null : palette.header,
        resetTheme ? null : palette.background,
        resetTheme ? null : palette.page,
        space.id
      ]);
      await saveDB();
      dialog.remove();
      render();
    };
  });
}

/* Suppression douce : les pages ne disparaissent jamais, elles reviennent
   dans l'Inbox. Seules les catégories du projet sont détruites. */
function deleteSpace(space) {
  const pages = q('SELECT COUNT(*) count FROM pages WHERE space_id = ? AND deleted_at IS NULL', [space.id])[0].count;
  const message = pages
    ? `${pages} ${plural(pages, 'page')} ${pages > 1 ? 'retourneront' : 'retournera'} dans l'Inbox. Les catégories du projet seront supprimées.`
    : 'Ce projet ne contient aucune page. Ses catégories seront supprimées.';

  confirmDialog(`Supprimer « ${space.name} » ?`, message, async () => {
    transaction(() => {
      const categoryIds = q('SELECT id FROM categories WHERE space_id = ?', [space.id]).map(row => row.id);
      categoryIds.forEach(categoryId => {
        run('DELETE FROM page_categories WHERE category_id = ?', [categoryId]);
      });
      run('DELETE FROM categories WHERE space_id = ?', [space.id]);
      run('UPDATE pages SET space_id = NULL, is_inbox = 1 WHERE space_id = ?', [space.id]);
      run('DELETE FROM spaces WHERE id = ?', [space.id]);
    });
    await saveDB();
    goHome();
    toast('Projet supprimé. Les pages sont dans l\'Inbox.');
  });
}

function themeColorField(id, label, value) {
  return `
    <div class="theme-color-field">
      <label class="theme-color-label" for="${id}Text">${esc(label)}</label>
      <div class="theme-color-controls">
        <input
          class="theme-color-picker"
          id="${id}Picker"
          type="color"
          value="${esc(value)}"
          aria-label="Sélecteur : ${esc(label)}"
        >
        <input
          class="field theme-color-text"
          id="${id}Text"
          type="text"
          value="${esc(value)}"
          maxlength="7"
          inputmode="text"
          spellcheck="false"
          autocapitalize="characters"
          aria-invalid="false"
        >
      </div>
    </div>
  `;
}

function screenCategory(id) {
  const category = getCategory(id);
  if (!category) return goHome();
  const space = getSpace(category.space_id);
  const pages = q('SELECT p.* FROM pages p JOIN page_categories pc ON pc.page_id = p.id WHERE pc.category_id = ? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC', [id]);

  app.innerHTML = `
    ${wrapHeader(space, null, globalHeader())}
    <main>
      ${safeImage(category.banner) ? `<div class="category-hero"><img src="${esc(safeImage(category.banner))}" alt=""></div>` : ''}
      <section class="category-heading"><div class="category-heading-row"><h1>${esc(category.name)}</h1><button type="button" class="btn-ghost" id="editCategory">Modifier</button></div>${category.intro ? `<p>${esc(category.intro)}</p>` : ''}</section>
      ${pages.length ? `<div class="entity-grid">${pages.slice(0, 12).map(entityCard).join('')}</div>` : '<div class="category-empty">Cette catégorie est vide.<br>Crée une page pour commencer.</div>'}
      ${pages.length > 12 ? `<button type="button" class="btn-ghost quick" id="catAll">Voir les ${pages.length} pages</button>` : ''}
      <button type="button" class="btn-accent quick" id="newCatPage">+ Nouvelle page</button>
    </main>
  `;

  bindGlobal();
  document.getElementById('editCategory').onclick = () => editCategory(category);
  document.getElementById('catAll')?.addEventListener('click', () => go('library', `cat:${id}`));
  document.getElementById('newCatPage').onclick = () => quickNote(space.id, id);
  wirePages();
}

function editCategory(category) {
  openDialog('Modifier la catégorie', `
    <form id="categoryEditForm">
      <label class="lab" for="catName">Nom</label><input class="field" id="catName" maxlength="80" value="${esc(category.name)}" required>
      <label class="lab" for="catIntro">Introduction</label><textarea class="field" id="catIntro" rows="4">${esc(category.intro || '')}</textarea>
      <label class="lab" for="catBanner">Bannière HTTPS</label><input class="field" id="catBanner" value="${esc(category.banner || '')}">
      <button class="btn-accent quick" type="submit">Enregistrer</button>

      <div class="danger-zone">
        <p>Supprimer la catégorie ne supprime aucune page : elles restent dans le projet, simplement déclassées.</p>
        <button type="button" class="btn-danger" id="deleteCategory">Supprimer la catégorie</button>
      </div>
    </form>
  `, dialog => {
    dialog.querySelector('#deleteCategory').onclick = () => {
      dialog.remove();
      deleteCategory(category);
    };

    dialog.querySelector('#categoryEditForm').onsubmit = async event => {
      event.preventDefault();
      const name = dialog.querySelector('#catName').value.trim();
      const banner = dialog.querySelector('#catBanner').value.trim();
      if (!name) return toast('Le nom est obligatoire.', true);
      if (banner && !safeImage(banner)) return toast('Utilise une URL HTTPS.', true);
      run('UPDATE categories SET name = ?, intro = ?, banner = ? WHERE id = ?', [name, dialog.querySelector('#catIntro').value.trim(), banner || null, category.id]);
      await saveDB();
      dialog.remove();
      render();
    };
  });
}

/* Fandom prévient : supprimer une catégorie ne la retire pas des pages.
   Ici on nettoie page_categories pour ne pas laisser de liaisons fantômes. */
function deleteCategory(category) {
  const count = q('SELECT COUNT(*) count FROM page_categories pc JOIN pages p ON p.id = pc.page_id WHERE pc.category_id = ? AND p.deleted_at IS NULL', [category.id])[0].count;
  const message = count
    ? `${count} ${plural(count, 'page')} ${count > 1 ? 'perdront' : 'perdra'} cette catégorie, mais ${count > 1 ? 'resteront' : 'restera'} dans le projet.`
    : 'Cette catégorie ne contient aucune page.';

  confirmDialog(`Supprimer « ${category.name} » ?`, message, async () => {
    const spaceId = category.space_id;
    transaction(() => {
      run('DELETE FROM page_categories WHERE category_id = ?', [category.id]);
      run('DELETE FROM categories WHERE id = ?', [category.id]);
    });
    await saveDB();
    replaceCurrent('space', spaceId);
    toast('Catégorie supprimée.');
  });
}

async function quickNote(spaceId, categoryId = null, title = '') {
  try {
    if (categoryId && getCategory(categoryId)?.space_id !== spaceId) {
      throw new Error('La catégorie ne correspond pas au projet.');
    }
    const id = uid();
    const now = Date.now();
    transaction(() => {
      run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,infobox,title_align,search_text) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, title, '', now, now, spaceId ? 0 : 1, spaceId, '{}', 'left', buildSearchText(title, '', '{}')]);
      if (categoryId) run('INSERT INTO page_categories (page_id,category_id) VALUES (?,?)', [id, categoryId]);
    });
    await saveDB();
    go('edit', id);
  } catch (error) {
    toast(`Impossible de créer la note : ${error.message}`, true);
  }
}

function screenInbox() {
  replaceCurrent('library', 'inbox');
}

/* ============================================================
   Bibliothèque : un seul écran pour « toutes les pages », les pages
   d'un projet, celles d'une catégorie et les épinglées. Seule la
   clause WHERE change.
   ============================================================ */

/* Le champ de tri et le sens sont séparés : 4 champs × 2 sens,
   au lieu de 6 combinaisons figées. */
const SORTS = {
  updated: { label: 'Date de modification', col: 'updated_at',            down: 'Récentes d\'abord', up: 'Anciennes d\'abord' },
  created: { label: 'Date de création',     col: 'created_at',            down: 'Récentes d\'abord', up: 'Anciennes d\'abord' },
  title:   { label: 'Titre',                col: TITLE_SORT,              down: 'Z → A',             up: 'A → Z' },
  weight:  { label: 'Taille du texte',      col: 'LENGTH(search_text)',   down: 'Les plus longues',  up: 'Les plus courtes' }
};

let currentSort = SORTS[localStorage.getItem('wiki-sort')] ? localStorage.getItem('wiki-sort') : 'updated';
let sortDesc = localStorage.getItem('wiki-sort-desc') !== '0';
let listView = localStorage.getItem('wiki-view') || 'grid';
let selection = new Set();

const sortClause = () => `${SORTS[currentSort].col} ${sortDesc ? 'DESC' : 'ASC'}`;
const sortLabel = () => `${SORTS[currentSort].label} · ${sortDesc ? SORTS[currentSort].down : SORTS[currentSort].up}`;

/* Une carte, deux rendus. La logique ne doit exister qu'une fois. */
function pageTile(page, view) {
  const space = page.space_id ? getSpace(page.space_id) : null;
  const cover = safeImage(page.cover);
  const text = strip(page.body);
  const initial = esc((page.title?.trim() || '?')[0] || '?');
  const picked = selection.has(page.id);
  const star = page.is_pinned ? '<span class="pin-mark">★</span>' : '';

  if (view === 'list') {
    return `
      <button type="button" class="card row tile-row${picked ? ' picked' : ''}" data-tile="${esc(page.id)}">
        <span class="thumb-sm">${cover
          ? `<img src="${esc(cover)}" alt="">`
          : `<span class="thumb-ph">${initial}</span>`}${picked ? '<span class="pick-dot">✓</span>' : ''}</span>
        <span class="grow">
          <span class="t">${esc(page.title?.trim() || 'Sans titre')}${star}</span>
          ${text ? `<span class="p">${esc(text.slice(0, 90))}</span>` : '<span class="p vide">Page vide</span>'}
          <span class="d">${esc(space?.name || 'Inbox')} · ${fmt(page.updated_at)}</span>
        </span>
      </button>`;
  }

  return `
    <button type="button" class="tile${picked ? ' picked' : ''}" data-tile="${esc(page.id)}">
      <span class="tile-img">${cover
        ? `<img src="${esc(cover)}" alt="">`
        : `<span class="tile-ph">${initial}</span>`}${picked ? '<span class="pick-dot">✓</span>' : ''}${star}</span>
      <span class="tile-body">
        <span class="tile-t">${esc(page.title?.trim() || 'Sans titre')}</span>
        <span class="tile-m">${esc(space?.name || 'Inbox')} · ${fmt(page.updated_at)}</span>
      </span>
    </button>`;
}

/* Appui long : Android déclenche sinon la sélection de texte et son
   propre menu contextuel. On tolère 10 px de glissement du doigt. */
function bindLongPress(element, onLong, delay = 450) {
  let timer = null;
  let fired = false;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  element.addEventListener('pointerdown', event => {
    startX = event.clientX;
    startY = event.clientY;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      if (navigator.vibrate) navigator.vibrate(12);
      onLong();
    }, delay);
  });

  element.addEventListener('pointermove', event => {
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(name =>
    element.addEventListener(name, cancel));

  element.addEventListener('click', event => {
    if (fired) {
      event.preventDefault();
      event.stopPropagation();
      fired = false;
    }
  }, true);

  element.addEventListener('contextmenu', event => event.preventDefault());
}

function selectionHeader() {
  const n = selection.size;
  return `
    <header class="top global top-select">
      <button type="button" class="icon-btn" id="selCancel" aria-label="Quitter la sélection">✕</button>
      <div class="title">${n} ${plural(n, 'sélectionnée')}</div>
      <div class="header-actions">
        <button type="button" class="icon-btn" id="selAll" aria-label="Tout sélectionner">☑</button>
        <button type="button" class="icon-btn" id="selMore" aria-label="Actions groupées">⋮</button>
      </div>
    </header>
  `;
}

function libraryScope(param) {
  const raw = param || 'all';
  if (raw.startsWith('space:')) {
    const space = getSpace(raw.slice(6));
    return space
      ? { kind: 'space', id: space.id, title: space.name, where: 'space_id = ?', params: [space.id] }
      : { kind: 'all', title: 'Toutes les pages', where: '1=1', params: [] };
  }
  if (raw.startsWith('cat:')) {
    const category = getCategory(raw.slice(4));
    return category
      ? {
          kind: 'cat',
          id: category.id,
          spaceId: category.space_id,
          title: category.name,
          where: 'id IN (SELECT page_id FROM page_categories WHERE category_id = ?)',
          params: [category.id]
        }
      : { kind: 'all', title: 'Toutes les pages', where: '1=1', params: [] };
  }
  if (raw === 'pinned') {
    return { kind: 'pinned', title: 'Épinglées', where: 'is_pinned = 1', params: [] };
  }
  if (raw === 'inbox') {
    return { kind: 'inbox', title: 'Inbox', where: 'space_id IS NULL', params: [] };
  }
  return { kind: 'all', title: 'Toutes les pages', where: '1=1', params: [] };
}

function screenLibrary(param) {
  const scope = libraryScope(param);
  const space = scope.kind === 'space' ? getSpace(scope.id)
    : scope.kind === 'cat' ? getSpace(scope.spaceId)
    : null;
  let filter = '';

  const fetch = () => {
    const clauses = ['deleted_at IS NULL', scope.where];
    const params = [...scope.params];
    if (filter) {
      clauses.push('search_text LIKE ?');
      params.push(`%${normalize(filter)}%`);
    }
    return q(`
      SELECT id,title,body,cover,space_id,created_at,updated_at,is_pinned,search_text
      FROM pages WHERE ${clauses.join(' AND ')}
      ORDER BY is_pinned DESC, ${sortClause()}
    `, params);
  };

  function paint() {
    const pages = fetch();
    const selecting = selection.size > 0;

    app.innerHTML = `
      ${selecting ? selectionHeader() : wrapHeader(space, null, globalHeader(scope.title))}
      <main>
        <form class="lib-search" id="libSearchForm">
          <label class="sr-only" for="libSearch">Filtrer</label>
          <input class="search-input" id="libSearch" type="search" placeholder="Filtrer dans ${esc(scope.title)}…" value="${esc(filter)}">
        </form>
        <div class="sort-row">
          <button type="button" class="sort-label" id="sortBtn">${esc(sortLabel())} <span aria-hidden="true">⌄</span></button>
          <button type="button" class="sort-dir" id="sortDir" aria-label="${sortDesc ? 'Ordre décroissant' : 'Ordre croissant'}">${sortDesc ? '↓' : '↑'}</button>
          <span class="sort-count">${pages.length}</span>
          <button type="button" class="icon-btn" id="viewToggle" aria-label="Changer d'affichage">${listView === 'grid' ? '▤' : '▦'}</button>
        </div>
        ${pages.length
          ? (listView === 'grid'
              ? `<div class="tile-grid">${pages.map(page => pageTile(page, 'grid')).join('')}</div>`
              : pages.map(page => pageTile(page, 'list')).join(''))
          : `<div class="empty">${filter ? 'Aucune page ne correspond au filtre.' : 'Aucune page ici.'}</div>`}
      </main>
      ${selecting || scope.kind === 'pinned' ? '' : '<button type="button" class="fab" id="libFab" aria-label="Nouvelle page">+</button>'}
    `;

    if (selecting) {
      document.getElementById('selCancel').onclick = () => {
        selection.clear();
        paint();
      };
      document.getElementById('selAll').onclick = () => {
        const all = pages.every(page => selection.has(page.id));
        pages.forEach(page => all ? selection.delete(page.id) : selection.add(page.id));
        paint();
      };
      document.getElementById('selMore').onclick = event =>
        openSelectionMenu(event.currentTarget, paint);
    } else {
      bindGlobal();
    }

    const input = document.getElementById('libSearch');
    let timer = null;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        filter = input.value.trim();
        const caret = input.selectionStart;
        paint();
        const next = document.getElementById('libSearch');
        next.focus();
        next.setSelectionRange(caret, caret);
      }, 220);
    };
    document.getElementById('libSearchForm').onsubmit = event => {
      event.preventDefault();
      input.blur();
    };

    document.getElementById('libFab')?.addEventListener('click', () => {
      if (scope.kind === 'space') return quickNote(scope.id);
      if (scope.kind === 'cat') return quickNote(scope.spaceId, scope.id);
      quickNote(null);
    });

    document.getElementById('sortBtn').onclick = () => openSortDialog(paint);
    document.getElementById('sortDir').onclick = () => {
      sortDesc = !sortDesc;
      localStorage.setItem('wiki-sort-desc', sortDesc ? '1' : '0');
      paint();
    };
    document.getElementById('viewToggle').onclick = () => {
      listView = listView === 'grid' ? 'list' : 'grid';
      localStorage.setItem('wiki-view', listView);
      paint();
    };

    app.querySelectorAll('[data-tile]').forEach(element => {
      const id = element.dataset.tile;
      element.onclick = () => {
        if (selection.size > 0) {
          selection.has(id) ? selection.delete(id) : selection.add(id);
          paint();
        } else {
          go('read', id);
        }
      };
      bindLongPress(element, () => {
        selection.add(id);
        paint();
      });
    });
  }

  paint();
}

function openSortDialog(after) {
  openDialog('Trier par', `
    <div class="picker-list">
      ${Object.entries(SORTS).map(([key, item]) =>
        `<button type="button" class="picker-item${key === currentSort ? ' current' : ''}" data-sort="${key}">${esc(item.label)}</button>`
      ).join('')}
    </div>
    <div class="sort-dir-row">
      <button type="button" class="scope-chip" data-dir="desc" aria-pressed="${sortDesc}">↓ Décroissant</button>
      <button type="button" class="scope-chip" data-dir="asc" aria-pressed="${!sortDesc}">↑ Croissant</button>
    </div>
  `, dialog => {
    dialog.querySelectorAll('[data-sort]').forEach(button => {
      button.onclick = () => {
        currentSort = button.dataset.sort;
        localStorage.setItem('wiki-sort', currentSort);
        dialog.remove();
        after();
      };
    });
    dialog.querySelectorAll('[data-dir]').forEach(button => {
      button.onclick = () => {
        sortDesc = button.dataset.dir === 'desc';
        localStorage.setItem('wiki-sort-desc', sortDesc ? '1' : '0');
        dialog.querySelectorAll('[data-dir]').forEach(item =>
          item.setAttribute('aria-pressed', String(item === button)));
        after();
      };
    });
  });
}

function openSelectionMenu(anchor, after) {
  const ids = [...selection];
  const anyUnpinned = ids.some(id => !getPage(id)?.is_pinned);

  buildMenu(anchor, [
    {
      label: anyUnpinned ? 'Épingler' : 'Désépingler',
      run: async () => {
        transaction(() => ids.forEach(id =>
          run('UPDATE pages SET is_pinned = ? WHERE id = ?', [anyUnpinned ? 1 : 0, id])));
        await saveDB();
        selection.clear();
        after();
        toast(anyUnpinned ? 'Pages épinglées.' : 'Pages désépinglées.');
      }
    },
    { label: 'Déplacer vers…', run: () => moveDialog(ids, after) },
    { label: 'Relier à une catégorie…', run: () => linkCategoryDialog(ids, after) },
    {
      label: `Mettre à la corbeille (${ids.length})`,
      danger: true,
      run: async () => {
        const now = Date.now();
        transaction(() => ids.forEach(id =>
          run('UPDATE pages SET deleted_at = ? WHERE id = ?', [now, id])));
        await saveDB();
        selection.clear();
        after();
        toast(`${ids.length} ${plural(ids.length, 'page')} à la corbeille`, false, {
          label: 'Annuler',
          run: async () => {
            transaction(() => ids.forEach(id =>
              run('UPDATE pages SET deleted_at = NULL WHERE id = ?', [id])));
            await saveDB();
            render();
            toast('Pages restaurées.');
          }
        });
      }
    }
  ]);
}

/* Changer de projet vide les catégories : elles appartiennent à
   l'ancien projet et n'ont plus de sens ailleurs. */
function moveDialog(pageIds, after) {
  const spaces = q('SELECT id,name FROM spaces ORDER BY name COLLATE NOCASE');
  openDialog(`Déplacer ${pageIds.length} ${plural(pageIds.length, 'page')}`, `
    <div class="picker-list">
      <button type="button" class="picker-item" data-move="">📥 Inbox</button>
      ${spaces.map(item => `<button type="button" class="picker-item" data-move="${esc(item.id)}">${esc(item.name)}</button>`).join('')}
    </div>
  `, dialog => {
    dialog.querySelectorAll('[data-move]').forEach(button => {
      button.onclick = async () => {
        const target = button.dataset.move || null;
        const now = Date.now();
        transaction(() => {
          pageIds.forEach(id => {
            run('UPDATE pages SET space_id = ?, is_inbox = ?, updated_at = ? WHERE id = ?',
              [target, target ? 0 : 1, now, id]);
            run('DELETE FROM page_categories WHERE page_id = ?', [id]);
          });
        });
        await saveDB();
        dialog.remove();
        selection.clear();
        after ? after() : render();
        toast(target ? 'Pages déplacées.' : 'Pages renvoyées dans l\'Inbox.');
      };
    });
  });
}

function linkCategoryDialog(pageIds, after) {
  const spaceIds = new Set(pageIds.map(id => getPage(id)?.space_id || null));
  if (spaceIds.size > 1) {
    return toast('Sélectionne des pages d\'un même projet.', true);
  }
  const spaceId = [...spaceIds][0];
  if (!spaceId) return toast('Ces pages sont dans l\'Inbox : déplace-les d\'abord.', true);

  const categories = getSpaceCategories(spaceId);
  if (!categories.length) return toast('Ce projet n\'a pas encore de catégorie.', true);

  openDialog('Relier à une catégorie', `
    <div class="picker-list">
      ${categories.map(item => `<button type="button" class="picker-item" data-link="${esc(item.id)}">${esc(item.name)}</button>`).join('')}
    </div>
  `, dialog => {
    dialog.querySelectorAll('[data-link]').forEach(button => {
      button.onclick = async () => {
        transaction(() => pageIds.forEach(id =>
          run('INSERT OR IGNORE INTO page_categories (page_id,category_id) VALUES (?,?)',
            [id, button.dataset.link])));
        await saveDB();
        dialog.remove();
        selection.clear();
        after ? after() : render();
        toast('Pages reliées.');
      };
    });
  });
}

/* ============================================================
   Recherche
   ============================================================ */

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* « foo bar » = les deux mots requis. « -mot » exclut. « "mot" » force
   la correspondance sur le mot entier. */
function parseQuery(raw) {
  const tokens = [];
  const pattern = /-?"[^"]+"|-?\S+/g;
  let match;

  while ((match = pattern.exec(raw)) !== null) {
    let piece = match[0];
    const negated = piece.startsWith('-');
    if (negated) piece = piece.slice(1);
    const exact = piece.startsWith('"') && piece.endsWith('"');
    if (exact) piece = piece.slice(1, -1);
    const value = normalize(piece);
    if (value) tokens.push({ value, negated, exact });
  }
  return tokens;
}

function searchPages(tokens, spaceId = null) {
  const positives = tokens.filter(token => !token.negated);
  if (!positives.length) return [];

  const clauses = ['deleted_at IS NULL', ...positives.map(() => 'search_text LIKE ?')];
  const params = positives.map(token => `%${token.value}%`);
  if (spaceId) {
    clauses.push('space_id = ?');
    params.push(spaceId);
  }

  return q(`
    SELECT id,title,body,space_id,updated_at,is_pinned,search_text
    FROM pages WHERE ${clauses.join(' AND ')}
  `, params).filter(page => tokens.every(token => {
    const hay = page.search_text || '';
    const found = token.exact
      ? new RegExp(`(^|[^a-z0-9])${escapeRegex(token.value)}([^a-z0-9]|$)`).test(hay)
      : hay.includes(token.value);
    return token.negated ? !found : found;
  }));
}

function relevance(page, tokens) {
  const title = normalize(page.title || '');
  let score = 0;
  tokens.filter(token => !token.negated).forEach(token => {
    if (title === token.value) score += 100;
    else if (title.startsWith(token.value)) score += 50;
    else if (title.includes(token.value)) score += 25;
  });
  if (page.is_pinned) score += 10;
  return score;
}

/* Extrait pris AUTOUR du mot trouvé, pas au début du texte :
   sur une page longue, l'occurrence est souvent loin du début. */
function snippet(text, tokens, radius = 70) {
  const plain = String(text || '');
  const hay = normalize(plain);
  const hit = tokens
    .filter(token => !token.negated)
    .map(token => hay.indexOf(token.value))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0];

  if (hit === undefined) return plain.slice(0, 160);

  const start = Math.max(0, hit - radius);
  const end = Math.min(plain.length, hit + radius * 2);
  return (start > 0 ? '… ' : '') + plain.slice(start, end).trim() + (end < plain.length ? ' …' : '');
}

/* Les positions sont calculées sur le texte normalisé puis appliquées au
   texte d'origine : en NFD, retirer les accents conserve l'alignement.
   Tout est échappé, seul <mark> est injecté. */
function highlight(text, tokens) {
  const plain = String(text || '');
  const hay = normalize(plain);
  const values = tokens.filter(token => !token.negated).map(token => token.value);

  const ranges = [];
  values.forEach(value => {
    let from = 0;
    let at;
    while ((at = hay.indexOf(value, from)) !== -1) {
      ranges.push([at, at + value.length]);
      from = at + value.length;
    }
  });
  if (!ranges.length) return esc(plain);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  ranges.slice(1).forEach(range => {
    const last = merged[merged.length - 1];
    if (range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  });

  let out = '';
  let cursor = 0;
  merged.forEach(([start, end]) => {
    out += esc(plain.slice(cursor, start)) + '<mark>' + esc(plain.slice(start, end)) + '</mark>';
    cursor = end;
  });
  return out + esc(plain.slice(cursor));
}

function resultCard(page, tokens) {
  const space = page.space_id ? getSpace(page.space_id) : null;
  const text = strip(page.body);
  return `
    <button type="button" class="result" data-page="${esc(page.id)}">
      <div class="result-t">${highlight(page.title?.trim() || 'Sans titre', tokens)}</div>
      ${text
        ? `<div class="result-s">${highlight(snippet(text, tokens), tokens)}</div>`
        : '<div class="result-s vide">Page vide</div>'}
      <div class="result-m">${esc(space?.name || 'Inbox')} · ${fmt(page.updated_at)}</div>
    </button>
  `;
}

function screenSearch() {
  const scopeSpace = currentSpace();
  /* La portée choisie est retenue d'une recherche à l'autre. */
  let scope = scopeSpace ? (localStorage.getItem('wiki-search-scope') || 'all') : 'all';

  app.innerHTML = `
    ${globalHeader('Recherche')}
    <main>
      <form class="search-row" id="searchForm">
        <label class="sr-only" for="searchInput">Rechercher</label>
        <input class="search-input" id="searchInput" type="search" enterkeyhint="search" placeholder="Rechercher dans le wiki...">
        <button class="btn-accent" type="submit">OK</button>
      </form>
      ${scopeSpace ? `
        <div class="search-scope">
          <button type="button" class="scope-chip" data-scope="all" aria-pressed="${scope === 'all'}">Tous les projets</button>
          <button type="button" class="scope-chip" data-scope="space" aria-pressed="${scope === 'space'}">${esc(scopeSpace.name)}</button>
        </div>` : ''}
      <div class="search-help">Plusieurs mots : tous requis. <b>-mot</b> exclut. <b>"mot"</b> cherche le mot entier.</div>
      <div id="results"></div>
    </main>
  `;

  bindGlobal();

  const input = document.getElementById('searchInput');
  const results = document.getElementById('results');
  let timer = null;

  /* Pendant la frappe : suggestions sur les titres uniquement (requête légère).
     À la validation : recherche plein texte avec extraits. */
  function suggest() {
    const value = input.value.trim();
    if (!value) {
      results.innerHTML = '';
      return;
    }
    const rows = q(`
      SELECT id,title FROM pages
      WHERE search_text LIKE ? AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 6
    `, [`%${normalize(value)}%`]);

    results.innerHTML = rows.length
      ? `<div class="suggest-list">${rows.map(page =>
          `<button type="button" class="suggest-item" data-page="${esc(page.id)}">${esc(page.title?.trim() || 'Sans titre')}</button>`
        ).join('')}</div>`
      : '';
    wirePages(results);
  }

  function draw() {
    const raw = input.value.trim();
    if (!raw) {
      results.innerHTML = '<div class="empty">Tape un mot, puis valide.</div>';
      return;
    }

    const tokens = parseQuery(raw);
    const spaceId = scope === 'space' && scopeSpace ? scopeSpace.id : null;
    const rows = searchPages(tokens, spaceId)
      .sort((a, b) => relevance(b, tokens) - relevance(a, tokens) || b.updated_at - a.updated_at)
      .slice(0, 60);

    results.innerHTML = `
      <button type="button" class="create-banner" id="createFromSearch">
        Créer la page <b>« ${esc(raw)} »</b> — ou consulte les résultats ci-dessous.
      </button>
      <div class="search-count">${rows.length} ${plural(rows.length, 'résultat')} pour « ${esc(raw)} »</div>
      ${rows.map(page => resultCard(page, tokens)).join('') || '<div class="empty">Aucune page ne correspond.</div>'}
    `;

    document.getElementById('createFromSearch').onclick = () => {
      const targetSpace = scope === 'space' && scopeSpace ? scopeSpace.id : null;
      quickNote(targetSpace, null, raw);
    };
    wirePages(results);
  }

  app.querySelectorAll('[data-scope]').forEach(button => {
    button.onclick = () => {
      scope = button.dataset.scope;
      localStorage.setItem('wiki-search-scope', scope);
      app.querySelectorAll('[data-scope]').forEach(item =>
        item.setAttribute('aria-pressed', String(item === button)));
      if (input.value.trim()) draw();
    };
  });

  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(suggest, 160);
  };

  document.getElementById('searchForm').onsubmit = event => {
    event.preventDefault();
    clearTimeout(timer);
    input.blur();
    draw();
  };

  results.innerHTML = '<div class="empty">Tape un mot, puis valide.</div>';
  input.focus();
}

/* ============================================================
   Éditeur
   ============================================================ */

const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null }, label: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'a[data-wikilink]',
      getAttrs: element => ({
        id: element.getAttribute('data-wikilink'),
        label: element.textContent
      })
    }];
  },
  renderHTML({ node }) {
    return ['a', mergeAttributes({
      'data-wikilink': node.attrs.id,
      class: 'wikilink'
    }), node.attrs.label || 'Page'];
  }
});

/* Image insérée dans le texte, façon Google Docs : un bloc atomique,
   centré, qui survit à la sauvegarde parce que sanitizeHTML l'autorise. */
const WikiImage = Node.create({
  name: 'wikiImage',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' }
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ node }) {
    if (!safeImage(node.attrs.src)) return ['span'];
    return ['img', { src: node.attrs.src, alt: node.attrs.alt || '', loading: 'lazy' }];
  }
});

const WikiRule = Extension.create({
  name: 'wikiRule',
  addInputRules() {
    return [new InputRule({
      find: /\[\[$/,
      handler: ({ range, commands }) => {
        commands.deleteRange(range);
        openPicker(insertWikilink, () => editor?.chain().focus().insertContent('[[').run());
      }
    })];
  }
});

function toolbar() {
  return `
    <div class="toolbar" role="toolbar" aria-label="Mise en forme">
      <button type="button" class="tb" data-command="bold" aria-label="Gras" aria-pressed="false">B</button>
      <button type="button" class="tb" data-command="italic" aria-label="Italique" aria-pressed="false"><em>I</em></button>
      <button type="button" class="tb" data-command="h2" aria-label="Titre 2" aria-pressed="false">H2</button>
      <button type="button" class="tb" data-command="h3" aria-label="Titre 3" aria-pressed="false">H3</button>
      <button type="button" class="tb" data-command="bullet" aria-label="Liste" aria-pressed="false">•</button>
      <button type="button" class="tb" data-command="quote" aria-label="Citation" aria-pressed="false">Q</button>
      <button type="button" class="tb" data-command="image" aria-label="Insérer des images">🖼</button>
      <button type="button" class="tb" data-command="link" aria-label="Lien wiki">Link</button>
    </div>
  `;
}

function screenEdit(id) {
  const page = getPage(id);
  if (!page) return goHome();
  if (page.deleted_at) {
    toast('Restaure la page avant de la modifier.', true);
    return replaceCurrent('read', id);
  }
  const space = page.space_id ? getSpace(page.space_id) : null;
  const categories = space ? getSpaceCategories(space.id) : [];
  const selected = new Set(getPageCategories(id).map(category => category.id));

  app.innerHTML = `
    ${wrapHeader(space, page, globalHeader('Édition'))}
    <main>
      <label class="sr-only" for="pageTitle">Titre</label><input class="title-input" id="pageTitle" maxlength="160" placeholder="Titre" value="${esc(page.title || '')}">
      ${categories.length ? `<div class="lab">Catégories</div><div class="category-chips">${categories.map(category => `<button type="button" class="category-chip" data-category-choice="${esc(category.id)}" aria-pressed="${selected.has(category.id)}">${esc(category.name)}</button>`).join('')}</div>` : ''}
      <div class="editor-wrap"><div id="editor"></div></div>
    </main>
    ${toolbar()}
    <button type="button" class="btn-accent save-page" id="savePage">Enregistrer</button>
  `;

  bindGlobal();
  app.querySelectorAll('[data-category-choice]').forEach(button => {
    button.onclick = () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  });

  editor = new Editor({
    element: document.getElementById('editor'),
    content: sanitizeHTML(page.body || ''),
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] } }), Wikilink, WikiRule, WikiImage],
    onUpdate: () => { updateToolbar(); touch(); },
    onSelectionUpdate: updateToolbar
  });

  /* Édition instantanée : on prend le focus et le clavier se lève. */
  requestAnimationFrame(() => editor?.commands.focus());

  /* ---- Sauvegarde automatique ----
     Chrome Android peut tuer l'onglet en arrière-plan sans prévenir :
     on écrit après 900 ms d'inactivité, et systématiquement quand la
     page passe en arrière-plan. Silencieusement : pas de témoin visuel. */
  let dirty = false;
  let saveTimer = null;

  async function persistDraft() {
    if (!dirty) return;
    const title = document.getElementById('pageTitle').value.trim();
    const body = sanitizeHTML(editor.getHTML());
    dirty = false;
    run('UPDATE pages SET title = ?, body = ?, search_text = ?, updated_at = ? WHERE id = ?', [
      title, body, buildSearchText(title, body, page.infobox), Date.now(), id
    ]);
    await saveDB();
  }

  function touch() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistDraft().catch(error => toast(`Sauvegarde impossible : ${error.message}`, true));
    }, 900);
  }

  document.getElementById('pageTitle').addEventListener('input', touch);

  editorFlush = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(saveTimer);
      persistDraft().catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', editorFlush);

  const commands = {
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    bullet: () => editor.chain().focus().toggleBulletList().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(),
    link: () => openPicker(insertWikilink),
    image: async () => {
      const images = await pickImages(8);
      if (!images.length) return;
      editor.chain().focus().insertContent(
        images.map(src => ({ type: 'wikiImage', attrs: { src, alt: '' } }))
      ).run();
      updateToolbar();
      touch();
    }
  };

  app.querySelectorAll('[data-command]').forEach(button => {
    button.onclick = () => {
      commands[button.dataset.command]?.();
      updateToolbar();
    };
  });

  function updateToolbar() {
    if (!editor) return;
    const states = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      bullet: editor.isActive('bulletList'),
      quote: editor.isActive('blockquote')
    };
    app.querySelectorAll('[data-command]').forEach(button => {
      const active = Boolean(states[button.dataset.command]);
      button.classList.toggle('on', active);
      if (button.dataset.command !== 'link') button.setAttribute('aria-pressed', String(active));
    });
  }

  document.getElementById('savePage').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    clearTimeout(saveTimer);
    try {
      const now = Date.now();
      const title = document.getElementById('pageTitle').value.trim();
      const body = sanitizeHTML(editor.getHTML());
      const categoryIds = [...app.querySelectorAll('[data-category-choice][aria-pressed="true"]')]
        .map(item => item.dataset.categoryChoice);

      transaction(() => {
        run('UPDATE pages SET title=?,body=?,search_text=?,updated_at=?,is_inbox=? WHERE id=?', [
          title,
          body,
          buildSearchText(title, body, page.infobox),
          now,
          page.space_id ? 0 : 1,
          id
        ]);
        run('DELETE FROM page_categories WHERE page_id=?', [id]);
        categoryIds.forEach(categoryId => {
          if (getCategory(categoryId)?.space_id === page.space_id) {
            run('INSERT INTO page_categories (page_id,category_id) VALUES (?,?)', [id, categoryId]);
          }
        });
      });

      dirty = false;
      await saveDB();
      replaceCurrent('read', id);
    } catch (error) {
      toast(`Enregistrement impossible : ${error.message}`, true);
      button.disabled = false;
    }
  };
}

function insertWikilink(page) {
  if (!editor || !page) return;
  editor.chain().focus().insertContent({
    type: 'wikilink',
    attrs: { id: page.id, label: page.title?.trim() || 'Sans titre' }
  }).run();
}

function openPicker(onPick, onCancel = null) {
  const pages = q(`SELECT id,title FROM pages WHERE deleted_at IS NULL ORDER BY ${TITLE_SORT}`);
  openDialog('Choisir une page', `
    <label class="sr-only" for="pickerSearch">Rechercher une page</label>
    <input class="field" id="pickerSearch" type="search" placeholder="Rechercher une page">
    <div class="picker-list" id="pickerList"></div>
  `, dialog => {
    const input = dialog.querySelector('#pickerSearch');
    const list = dialog.querySelector('#pickerList');
    const draw = () => {
      const raw = input.value.trim();
      const filtered = pages.filter(page => normalize(displayTitle(page.title)).includes(normalize(raw)));
      list.innerHTML = filtered.map(page => `<button type="button" class="picker-item" data-pick="${esc(page.id)}">${esc(page.title?.trim() || 'Sans titre')}</button>`).join('')
        || '<div class="empty">Aucune page.</div>';
      list.querySelectorAll('[data-pick]').forEach(button => button.onclick = () => {
        dialog.dataset.picked = 'true';
        const page = pages.find(item => item.id === button.dataset.pick);
        dialog.remove();
        onPick(page);
      });
    };
    dialog.addEventListener('dialog-cancel', () => {
      if (dialog.dataset.picked !== 'true') onCancel?.();
    }, { once: true });
    input.oninput = draw;
    draw();
    input.focus();
  });
}

/* ============================================================
   Infobox
   Format stocké :
   { title, subtitle, image, caption,
     groups: [ { header, rows: [ { label, value } ] } ] }

   Règle reprise de Fandom : un champ vide se cache, un groupe dont
   tous les champs sont vides se cache, une infobox entièrement vide
   ne s'affiche pas. C'est ce qui rend l'import permissif — aucun
   schéma à valider, ce qui manque disparaît simplement.
   ============================================================ */

const INFOBOX_KEYS = new Set(['title', 'subtitle', 'image', 'caption', 'groups', 'rows']);

function normalizeInfobox(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const base = {
    title: String(data.title ?? '').trim(),
    subtitle: String(data.subtitle ?? '').trim(),
    image: safeImage(data.image),
    caption: String(data.caption ?? '').trim(),
    groups: []
  };

  const toRows = value => {
    if (Array.isArray(value)) {
      return value
        .map(row => {
          if (!row || typeof row !== 'object') return null;
          const label = String(row.label ?? row.key ?? row.nom ?? '').trim();
          const raw = row.value ?? row.valeur ?? row.val ?? '';
          const text = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim();
          return label || text ? { label, value: text } : null;
        })
        .filter(Boolean);
    }
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .map(([label, raw]) => ({
          label: String(label).trim(),
          value: Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim()
        }))
        .filter(row => row.label || row.value);
    }
    return [];
  };

  if (Array.isArray(data.groups)) {
    base.groups = data.groups
      .map(group => ({
        header: String(group?.header ?? group?.titre ?? group?.title ?? '').trim(),
        rows: toRows(group?.rows ?? group?.fields ?? group?.champs)
      }))
      .filter(group => group.header || group.rows.length);
  } else if (data.rows) {
    base.groups = [{ header: '', rows: toRows(data.rows) }];
  } else {
    /* Objet plat : { "Espèce": "Humaine", "Rang": "Capitaine" }.
       C'est la forme qu'une IA produit le plus spontanément. */
    const flat = Object.entries(data)
      .filter(([key, value]) =>
        !INFOBOX_KEYS.has(key) &&
        (typeof value === 'string' || typeof value === 'number' || Array.isArray(value)))
      .map(([label, value]) => ({
        label: label.trim(),
        value: Array.isArray(value) ? value.join(', ') : String(value).trim()
      }))
      .filter(row => row.value);
    if (flat.length) base.groups = [{ header: '', rows: flat }];
  }

  return base;
}

function parseInfobox(raw) {
  if (!raw) return null;
  try {
    return normalizeInfobox(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    return null;
  }
}

function infoboxIsEmpty(box) {
  if (!box) return true;
  const hasRow = box.groups.some(group => group.rows.some(row => row.value));
  return !box.title && !box.subtitle && !box.image && !hasRow;
}

function infoboxText(box) {
  if (!box) return '';
  return [
    box.title, box.subtitle, box.caption,
    ...box.groups.flatMap(group => [group.header, ...group.rows.flatMap(row => [row.label, row.value])])
  ].filter(Boolean).join(' ');
}

function renderInfobox(box, fallbackTitle) {
  if (infoboxIsEmpty(box)) return '';

  const groups = box.groups
    .map(group => {
      const rows = group.rows.filter(row => row.value);
      if (!rows.length) return '';
      return `
        ${group.header ? `<h3 class="ib-header">${esc(group.header)}</h3>` : ''}
        <dl class="ib-list">
          ${rows.map(row => `
            <div class="ib-row">
              <dt>${esc(row.label)}</dt>
              <dd>${esc(row.value)}</dd>
            </div>`).join('')}
        </dl>`;
    })
    .join('');

  return `
    <aside class="infobox">
      <div class="ib-top">
        <div class="ib-titles">
          <div class="ib-title">${esc(box.title || fallbackTitle || 'Fiche')}</div>
          ${box.subtitle ? `<div class="ib-sub">${esc(box.subtitle)}</div>` : ''}
        </div>
        <button type="button" class="ib-toggle" id="ibToggle" aria-expanded="true" aria-label="Replier la fiche">⌄</button>
      </div>
      <div class="ib-body" id="ibBody">
        ${box.image ? `
          <figure class="ib-figure">
            <img src="${esc(box.image)}" alt="">
            ${box.caption ? `<figcaption>${esc(box.caption)}</figcaption>` : ''}
          </figure>` : ''}
        ${groups}
      </div>
    </aside>
  `;
}

/* Éditeur : quatre briques seulement, comme l'Infobox Builder de Fandom.
   Titre, image, ligne, en-tête de section. */
function editInfobox(pageId) {
  const page = getPage(pageId);
  if (!page) return;

  const box = parseInfobox(page.infobox) || { title: '', subtitle: '', image: '', caption: '', groups: [] };

  /* On travaille sur une liste à plat : plus simple à réordonner au pouce
     qu'un arbre de groupes. On la replie en groupes à l'enregistrement. */
  let items = [];
  box.groups.forEach(group => {
    if (group.header) items.push({ kind: 'header', text: group.header });
    group.rows.forEach(row => items.push({ kind: 'row', label: row.label, value: row.value }));
  });
  if (!items.length) items = [{ kind: 'row', label: '', value: '' }];

  let image = box.image || '';

  openDialog('Fiche d’information', `
    <form id="ibForm">
      <label class="lab" for="ibTitle">Titre de la fiche</label>
      <input class="field" id="ibTitle" maxlength="80" value="${esc(box.title)}" placeholder="${esc(page.title?.trim() || 'Titre de la page')}">

      <label class="lab" for="ibSub">Sous-titre</label>
      <input class="field" id="ibSub" maxlength="80" value="${esc(box.subtitle)}" placeholder="Personnage, Lieu, Prompt…">

      <div class="ib-image-setting">
        <span class="lab">Image</span>
        <button type="button" class="project-image-preview project-image-preview--banner" id="ibImage" aria-label="Choisir une image"></button>
        <div class="project-image-actions">
          <button type="button" class="btn-ghost" id="ibPick">Choisir</button>
          <button type="button" class="btn-ghost danger-text" id="ibClear">Retirer</button>
        </div>
        <input class="field" id="ibCaption" maxlength="120" value="${esc(box.caption)}" placeholder="Légende de l’image">
      </div>

      <div class="lab">Champs</div>
      <div id="ibItems"></div>

      <div class="ib-add">
        <button type="button" class="btn-ghost" id="ibAddRow">+ Ligne</button>
        <button type="button" class="btn-ghost" id="ibAddHeader">+ Section</button>
      </div>

      <button class="btn-accent quick" type="submit">Enregistrer la fiche</button>
      <div class="danger-zone">
        <p>Retirer la fiche ne touche pas au texte de la page.</p>
        <button type="button" class="btn-danger" id="ibDelete">Supprimer la fiche</button>
      </div>
    </form>
  `, dialog => {
    const list = dialog.querySelector('#ibItems');
    const preview = dialog.querySelector('#ibImage');

    const paintImage = () => {
      preview.style.backgroundImage = image ? `url("${image.replace(/"/g, '%22')}")` : '';
      preview.textContent = image ? '' : 'Aucune image';
      preview.classList.toggle('is-empty', !image);
      dialog.querySelector('#ibClear').disabled = !image;
    };

    function paintItems() {
      list.innerHTML = items.map((item, index) => item.kind === 'header'
        ? `
          <div class="ib-item ib-item--header">
            <input class="field" data-field="text" data-index="${index}" value="${esc(item.text)}" placeholder="Nom de la section" maxlength="60">
            <div class="ib-item-tools">
              <button type="button" class="ib-tool" data-up="${index}" aria-label="Monter">↑</button>
              <button type="button" class="ib-tool" data-down="${index}" aria-label="Descendre">↓</button>
              <button type="button" class="ib-tool danger-text" data-del="${index}" aria-label="Retirer">×</button>
            </div>
          </div>`
        : `
          <div class="ib-item">
            <div class="ib-item-fields">
              <input class="field" data-field="label" data-index="${index}" value="${esc(item.label)}" placeholder="Nom du champ" maxlength="60">
              <input class="field" data-field="value" data-index="${index}" value="${esc(item.value)}" placeholder="Valeur" maxlength="200">
            </div>
            <div class="ib-item-tools">
              <button type="button" class="ib-tool" data-up="${index}" aria-label="Monter">↑</button>
              <button type="button" class="ib-tool" data-down="${index}" aria-label="Descendre">↓</button>
              <button type="button" class="ib-tool danger-text" data-del="${index}" aria-label="Retirer">×</button>
            </div>
          </div>`
      ).join('');

      list.querySelectorAll('[data-field]').forEach(input => {
        input.oninput = () => {
          items[Number(input.dataset.index)][input.dataset.field] = input.value;
        };
      });
      list.querySelectorAll('[data-up]').forEach(button => {
        button.onclick = () => {
          const index = Number(button.dataset.up);
          if (index === 0) return;
          [items[index - 1], items[index]] = [items[index], items[index - 1]];
          paintItems();
        };
      });
      list.querySelectorAll('[data-down]').forEach(button => {
        button.onclick = () => {
          const index = Number(button.dataset.down);
          if (index >= items.length - 1) return;
          [items[index + 1], items[index]] = [items[index], items[index + 1]];
          paintItems();
        };
      });
      list.querySelectorAll('[data-del]').forEach(button => {
        button.onclick = () => {
          items.splice(Number(button.dataset.del), 1);
          paintItems();
        };
      });
    }

    dialog.querySelector('#ibPick').onclick = async () => {
      const picked = await pickImage();
      if (picked) {
        image = picked;
        paintImage();
      }
    };
    preview.onclick = dialog.querySelector('#ibPick').onclick;
    dialog.querySelector('#ibClear').onclick = () => {
      image = '';
      paintImage();
    };

    dialog.querySelector('#ibAddRow').onclick = () => {
      items.push({ kind: 'row', label: '', value: '' });
      paintItems();
    };
    dialog.querySelector('#ibAddHeader').onclick = () => {
      items.push({ kind: 'header', text: '' });
      paintItems();
    };

    dialog.querySelector('#ibDelete').onclick = async () => {
      run('UPDATE pages SET infobox = ?, updated_at = ? WHERE id = ?', ['{}', Date.now(), pageId]);
      await refreshSearchText(pageId);
      await saveDB();
      dialog.remove();
      render();
      toast('Fiche supprimée.');
    };

    dialog.querySelector('#ibForm').onsubmit = async event => {
      event.preventDefault();

      const groups = [];
      let current = { header: '', rows: [] };
      items.forEach(item => {
        if (item.kind === 'header') {
          if (current.header || current.rows.length) groups.push(current);
          current = { header: item.text.trim(), rows: [] };
        } else if (item.label.trim() || item.value.trim()) {
          current.rows.push({ label: item.label.trim(), value: item.value.trim() });
        }
      });
      if (current.header || current.rows.length) groups.push(current);

      const next = {
        title: dialog.querySelector('#ibTitle').value.trim(),
        subtitle: dialog.querySelector('#ibSub').value.trim(),
        image,
        caption: dialog.querySelector('#ibCaption').value.trim(),
        groups
      };

      run('UPDATE pages SET infobox = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(next), Date.now(), pageId]);
      await refreshSearchText(pageId);
      await saveDB();
      dialog.remove();
      render();
      toast('Fiche enregistrée.');
    };

    paintImage();
    paintItems();
  });
}

/* Couverture : choisir, retirer, et recadrer sans ré-encoder.
   Le recadrage = un ratio + une position verticale, appliqués en CSS
   via object-fit. Réversible, léger, et lisible sur mobile. */
const COVER_RATIOS = [
  { key: '21/9', label: '21:9' },
  { key: '16/9', label: '16:9' },
  { key: '4/3', label: '4:3' },
  { key: '1/1', label: '1:1' }
];

function editCover(page) {
  let cover = safeImage(page.cover) || null;
  let ratio = page.cover_ratio || '16/9';
  let pos = page.cover_pos ?? 50;

  openDialog('Image de couverture', `
    <div class="cover-crop">
      <img id="cropImg" alt="" hidden>
      <div class="cover-crop-empty" id="cropEmpty">Aucune couverture</div>
    </div>

    <div class="lab">Recadrage</div>
    <div class="crop-ratios">
      ${COVER_RATIOS.map(item => `<button type="button" class="scope-chip" data-ratio="${item.key}" aria-pressed="${item.key === ratio}">${item.label}</button>`).join('')}
    </div>
    <label class="theme-color-label" for="cropPos">Position verticale</label>
    <input class="crop-pos" type="range" id="cropPos" min="0" max="100" value="${pos}">

    <div class="project-image-actions">
      <button type="button" class="btn-ghost" id="coverPick">Choisir une image</button>
      <button type="button" class="btn-ghost danger-text" id="coverRemove">Retirer</button>
    </div>

    <button type="button" class="btn-accent quick" id="coverSave">Enregistrer</button>
  `, dialog => {
    const img = dialog.querySelector('#cropImg');
    const empty = dialog.querySelector('#cropEmpty');
    const range = dialog.querySelector('#cropPos');

    const paint = () => {
      if (cover) {
        img.hidden = false;
        empty.style.display = 'none';
        img.src = cover;
        img.style.aspectRatio = ratio;
        img.style.objectPosition = `50% ${pos}%`;
      } else {
        img.hidden = true;
        empty.style.display = '';
      }
      dialog.querySelector('#coverRemove').disabled = !cover;
      dialog.querySelectorAll('[data-ratio]').forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.ratio === ratio)));
      range.value = pos;
    };

    dialog.querySelector('#coverPick').onclick = async () => {
      const picked = await pickImage();
      if (picked) {
        cover = picked;
        paint();
      }
    };
    dialog.querySelector('#coverRemove').onclick = () => {
      cover = null;
      paint();
    };
    dialog.querySelectorAll('[data-ratio]').forEach(button => {
      button.onclick = () => {
        ratio = button.dataset.ratio;
        paint();
      };
    });
    range.oninput = () => {
      pos = Number(range.value);
      img.style.objectPosition = `50% ${pos}%`;
    };

    dialog.querySelector('#coverSave').onclick = async () => {
      run('UPDATE pages SET cover = ?, cover_ratio = ?, cover_pos = ?, updated_at = ? WHERE id = ?',
        [cover, cover ? ratio : null, cover ? pos : null, Date.now(), page.id]);
      await saveDB();
      dialog.remove();
      render();
      toast(cover ? 'Couverture enregistrée.' : 'Couverture retirée.');
    };

    paint();
  });
}

async function refreshSearchText(pageId) {
  const page = getPage(pageId);
  if (!page) return;
  run('UPDATE pages SET search_text = ? WHERE id = ?', [
    buildSearchText(page.title, page.body, page.infobox),
    pageId
  ]);
}

function screenRead(id) {
  const page = getPage(id);
  if (!page) return goHome();
  const space = page.space_id ? getSpace(page.space_id) : null;
  const categories = getPageCategories(id);
  const backlinks = q('SELECT id,title,body,space_id,updated_at,is_pinned FROM pages WHERE id<>? AND body LIKE ? AND deleted_at IS NULL', [id, `%data-wikilink="${id}"%`]);

  app.innerHTML = `
    ${wrapHeader(space, page, globalHeader())}
    <main class="read">
      ${safeImage(page.cover) ? `<img class="page-cover" src="${esc(safeImage(page.cover))}" alt="" style="aspect-ratio:${esc(page.cover_ratio || '16/9')};object-position:50% ${Number(page.cover_pos ?? 50)}%">` : ''}
      <h1 class="page-title">${esc(page.title?.trim() || 'Sans titre')}</h1>
      ${categories.length ? `<div class="category-chips">${categories.map(category => `<button type="button" class="category-chip" data-category="${esc(category.id)}">${esc(category.name)}</button>`).join('')}</div>` : ''}
      ${page.deleted_at ? `
        <div class="trash-banner">
          <span>Cette page est dans la corbeille.</span>
          <button type="button" class="btn-accent" id="restoreHere">Restaurer</button>
        </div>
      ` : `
      <div class="read-actions">
        <button type="button" class="action-link" id="pinPage" aria-pressed="${Boolean(page.is_pinned)}"><span class="ai">${page.is_pinned ? '★' : '☆'}</span>${page.is_pinned ? 'Épinglé' : 'Épingler'}</button>
        <button type="button" class="action-link" id="editPage"><span class="ai">✎</span>Modifier</button>
        <button type="button" class="action-link icon-only" id="moreActions" aria-label="Plus d'actions">⋮</button>
      </div>`}
      ${renderInfobox(parseInfobox(page.infobox), page.title?.trim())}
      <article class="page-body">${sanitizeHTML(page.body || '<p>Page vide.</p>')}</article>
      <div class="sec">Liens entrants</div>${backlinks.map(pageCard).join('') || '<div class="empty">Aucun lien entrant.</div>'}
    </main>
  `;

  const ibToggle = document.getElementById('ibToggle');
  if (ibToggle) {
    ibToggle.onclick = () => {
      const body = document.getElementById('ibBody');
      const open = ibToggle.getAttribute('aria-expanded') === 'true';
      ibToggle.setAttribute('aria-expanded', String(!open));
      ibToggle.classList.toggle('closed', open);
      body.hidden = open;
    };
  }

  bindGlobal();
  if (page.deleted_at) {
    document.getElementById('restoreHere').onclick = () => restorePage(id);
  } else {
    document.getElementById('pinPage').onclick = () => togglePin(id);
    document.getElementById('editPage').onclick = () => go('edit', id);
    document.getElementById('moreActions').onclick = event =>
      openReadMenu(event.currentTarget, page, space);
  }
  wirePages();

  app.querySelectorAll('a[data-wikilink]').forEach(link => {
    const targetId = link.dataset.wikilink;
    const target = getPage(targetId);
    /* Fandom : un lien vers la page courante s'affiche en gras, pas en lien. */
    if (targetId === id) {
      link.classList.add('self');
      link.removeAttribute('href');
      link.onclick = event => event.preventDefault();
      return;
    }
    link.textContent = target?.title?.trim() || 'Page supprimée';
    link.classList.toggle('dead', !target);
    link.removeAttribute('href');
    link.onclick = event => {
      event.preventDefault();
      if (target) go('read', target.id);
    };
  });
}

function openReadMenu(anchor, page, space) {
  const menu = buildMenu(anchor, [
    { label: parseInfobox(page.infobox) ? 'Modifier la fiche' : 'Ajouter une fiche', run: () => editInfobox(page.id) },
    { label: safeImage(page.cover) ? 'Recadrer la couverture' : 'Ajouter une couverture', run: () => editCover(page) },
    { label: 'Galerie', run: () => go('gallery', page.id) },
    { label: 'Déplacer vers…', run: () => moveDialog([page.id], null) },
    { label: 'Dupliquer', run: () => duplicatePage(page.id) },
    { label: 'Export PDF', run: () => exportPagePDF(page, space) },
    { label: 'Mettre à la corbeille', danger: true, run: () => trashPage(page.id, back) }
  ]);
  return menu;
}

/* Positionnement commun à tous les menus contextuels. */
function buildMenu(anchor, items) {
  document.querySelector('.quick-page-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'more-menu quick-page-menu';
  menu.innerHTML = items.map((item, index) =>
    `<button type="button" class="more-menu-item${item.danger ? ' danger' : ''}" data-index="${index}">${esc(item.label)}</button>`
  ).join('');
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, rect.right - menuWidth));
  const top = rect.bottom + menuHeight + 12 <= window.innerHeight
    ? rect.bottom + 6
    : Math.max(12, rect.top - menuHeight - 6);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  let outsideListener = null;
  const close = () => {
    menu.remove();
    if (outsideListener) document.removeEventListener('pointerdown', outsideListener, true);
  };

  menu.querySelectorAll('[data-index]').forEach(button => {
    button.onclick = () => {
      close();
      items[Number(button.dataset.index)].run();
    };
  });

  setTimeout(() => {
    outsideListener = event => {
      if (!menu.contains(event.target) && event.target !== anchor) close();
    };
    document.addEventListener('pointerdown', outsideListener, true);
  }, 0);

  return menu;
}

async function togglePin(id) {
  const page = getPage(id);
  if (!page) return;
  run('UPDATE pages SET is_pinned = ? WHERE id = ?', [page.is_pinned ? 0 : 1, id]);
  await saveDB();
  toast(page.is_pinned ? 'Page désépinglée' : 'Page épinglée');
  render();
}

async function duplicatePage(id, navigate = true) {
  const page = getPage(id);
  if (!page) return null;
  const copyId = uid();
  const now = Date.now();
  const title = `${page.title || 'Sans titre'} (copie)`;
  transaction(() => {
    run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,template_id,infobox,cover,title_align,search_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [copyId, title, page.body || '', now, now, page.space_id ? 0 : 1, page.space_id, page.template_id, page.infobox || '{}', page.cover || null, page.title_align || 'left', buildSearchText(title, page.body, page.infobox)]);
    getPageCategories(id).forEach(category => run('INSERT INTO page_categories (page_id,category_id) VALUES (?,?)', [copyId, category.id]));
  });
  await saveDB();
  if (navigate) go('read', copyId);
  return copyId;
}

function exportPagePDF(page, space) {
  if (typeof html2pdf === 'undefined') {
    toast('L’export PDF charge sa librairie depuis internet. Reconnecte-toi, recharge la page, puis réessaie.', true);
    return;
  }

  const safeTitle = page.title?.trim() || 'Page';
  const fileName = `${safeTitle.replace(/[^a-z0-9- ]/gi, '_')}.pdf`;

  const article = document.querySelector('.read');
  if (!article) {
    toast('Impossible de lire la page.', true);
    return;
  }

  const actions = article.querySelector('.read-actions');
  const prevDisplay = actions?.style.display || '';
  actions?.style.setProperty('display', 'none', 'important');
  toast('Préparation du PDF...');

  setTimeout(() => {
    html2pdf()
      .set({
        filename: fileName,
        margin: [10, 10, 10, 10],
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: {
          /* 1.5 au lieu de 2 : sur une page longue, scale 2 fait
             sauter l'onglet par manque de mémoire sur mobile. */
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          backgroundColor: getComputedStyle(document.body).getPropertyValue('--project-bg') || '#111'
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      })
      .from(article)
      .save()
      .then(() => {
        if (actions) actions.style.display = prevDisplay;
        toast('PDF enregistré.');
      })
      .catch(error => {
        if (actions) actions.style.display = prevDisplay;
        toast(`Export impossible : ${error.message}`, true);
      });
  }, 150);
}

/* Réversible : pas de confirmation, une annulation dans le toast.
   C'est le geste courant, il doit être rapide. */
async function trashPage(id, after = null) {
  run('UPDATE pages SET deleted_at = ? WHERE id = ?', [Date.now(), id]);
  await saveDB();
  if (after) after(); else render();

  toast('Page mise à la corbeille', false, {
    label: 'Annuler',
    run: async () => {
      run('UPDATE pages SET deleted_at = NULL WHERE id = ?', [id]);
      await saveDB();
      render();
      toast('Page restaurée.');
    }
  });
}

async function restorePage(id) {
  run('UPDATE pages SET deleted_at = NULL WHERE id = ?', [id]);
  await saveDB();
  render();
  toast('Page restaurée.');
}

/* Irréversible : c'est ici, et seulement ici, qu'on prévient des liens
   entrants qui vont mourir. */
function destroyPage(id) {
  const page = getPage(id);
  if (!page) return;
  const entrants = q('SELECT title FROM pages WHERE id <> ? AND body LIKE ? AND deleted_at IS NULL', [id, `%data-wikilink="${id}"%`]);
  const message = entrants.length
    ? `${entrants.length} ${plural(entrants.length, 'page')} ${entrants.length > 1 ? 'pointent' : 'pointe'} encore vers celle-ci (${entrants.slice(0, 3).map(item => item.title?.trim() || 'Sans titre').join(', ')}${entrants.length > 3 ? '…' : ''}). Ces liens deviendront morts, sans retour possible.`
    : 'La page et sa galerie seront perdues définitivement.';

  confirmDialog(`Supprimer « ${page.title?.trim() || 'Sans titre'} » ?`, message, async () => {
    transaction(() => hardDeletePage(id));
    await saveDB();
    render();
    toast('Page supprimée définitivement.');
  });
}

function screenTrash() {
  const pages = q('SELECT id,title,body,space_id,deleted_at FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');

  app.innerHTML = `
    ${globalHeader('Corbeille')}
    <main>
      <div class="trash-note">
        <p>Les pages sont supprimées définitivement au bout de ${TRASH_DAYS} jours.</p>
        ${pages.length ? '<button type="button" class="btn-ghost danger-text" id="emptyTrash">Vider la corbeille</button>' : ''}
      </div>
      ${pages.map(page => {
        const left = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - page.deleted_at) / 86400000));
        const space = page.space_id ? getSpace(page.space_id) : null;
        return `
          <div class="card row trash-row">
            <span class="grow">
              <span class="t">${esc(page.title?.trim() || 'Sans titre')}</span>
              <span class="p">${esc(space?.name || 'Inbox')} · supprimée le ${fmt(page.deleted_at)}</span>
              <span class="d">${left} ${plural(left, 'jour')} avant suppression définitive</span>
            </span>
            <button type="button" class="icon-btn" data-trash-menu="${esc(page.id)}" aria-label="Actions">⋮</button>
          </div>`;
      }).join('') || '<div class="empty">La corbeille est vide.</div>'}
    </main>
  `;

  bindGlobal();

  document.getElementById('emptyTrash')?.addEventListener('click', () => {
    confirmDialog(
      'Vider la corbeille ?',
      `${pages.length} ${plural(pages.length, 'page')} ${pages.length > 1 ? 'seront perdues' : 'sera perdue'} définitivement.`,
      async () => {
        transaction(() => pages.forEach(page => hardDeletePage(page.id)));
        await saveDB();
        render();
        toast('Corbeille vidée.');
      }
    );
  });

  app.querySelectorAll('[data-trash-menu]').forEach(button => {
    button.onclick = () => buildMenu(button, [
      { label: 'Restaurer', run: () => restorePage(button.dataset.trashMenu) },
      { label: 'Supprimer définitivement', danger: true, run: () => destroyPage(button.dataset.trashMenu) }
    ]);
  });
}

function openRecentPageMenu(anchor, id) {
  const page = getPage(id);
  if (!page) return;

  buildMenu(anchor, [
    { label: page.is_pinned ? 'Désépingler' : 'Épingler', run: () => togglePin(id) },
    { label: 'Renommer', run: () => renamePageFromHome(id) },
    { label: 'Déplacer vers…', run: () => moveDialog([id], null) },
    {
      label: 'Dupliquer',
      run: async () => {
        try {
          await duplicatePage(id, false);
          render();
          toast('Page dupliquée.');
        } catch (error) {
          toast(`Duplication impossible : ${error.message}`, true);
        }
      }
    },
    { label: 'Mettre à la corbeille', danger: true, run: () => trashPage(id) }
  ]);
}

function renamePageFromHome(id) {
  const page = getPage(id);
  if (!page) return;

  openDialog('Renommer la page', `
    <form id="renamePageForm">
      <label class="lab" for="renamePageTitle">Nouveau titre</label>
      <input
        class="field"
        id="renamePageTitle"
        maxlength="160"
        value="${esc(page.title || '')}"
        placeholder="Sans titre"
      >
      <button type="submit" class="btn-accent quick">Renommer</button>
    </form>
  `, dialog => {
    const input = dialog.querySelector('#renamePageTitle');
    input.focus();
    input.select();

    dialog.querySelector('#renamePageForm').onsubmit = async event => {
      event.preventDefault();
      const title = input.value.trim();
      run('UPDATE pages SET title = ?, search_text = ?, updated_at = ? WHERE id = ?', [
        title,
        buildSearchText(title, page.body, page.infobox),
        Date.now(),
        id
      ]);
      await saveDB();
      dialog.remove();
      render();
      toast('Page renommée.');
    };
  });
}



function screenGallery(pageId) {
  const page = getPage(pageId);
  if (!page) return goHome();
  const space = page.space_id ? getSpace(page.space_id) : null;
  const items = q('SELECT * FROM page_gallery WHERE page_id = ? ORDER BY position,created_at', [pageId]);

  app.innerHTML = `
    ${wrapHeader(space, page, globalHeader('Galerie'))}
    <main><div class="sec">Galerie de la page</div>
      ${items.length ? `<div class="gallery-grid">${items.map(item => `<div class="gallery-item"><img src="${esc(safeImage(item.data_url))}" alt=""><input class="field gal-caption" data-caption="${item.id}" value="${esc(item.caption || '')}" placeholder="Légende"><button type="button" class="btn-ghost danger-text" data-remove="${item.id}">Retirer</button></div>`).join('')}</div>` : '<div class="empty">Aucune image dans cette galerie.</div>'}
      <button type="button" class="btn-accent quick" id="addGallery">+ Ajouter une image</button>
    </main>
  `;

  bindGlobal();
  document.getElementById('addGallery').onclick = async () => {
    const image = await pickImage();
    if (!image) return;
    const max = q('SELECT MAX(position) position FROM page_gallery WHERE page_id = ?', [pageId])[0].position;
    run('INSERT INTO page_gallery (id,page_id,data_url,caption,position,created_at) VALUES (?,?,?,?,?,?)', [uid(), pageId, image, '', (max ?? -1) + 1, Date.now()]);
    await saveDB();
    render();
  };
  app.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
    confirmDialog('Retirer cette image ?', 'Cette action est définitive.', async () => {
      run('DELETE FROM page_gallery WHERE id = ?', [button.dataset.remove]);
      await saveDB();
      render();
    });
  });
  app.querySelectorAll('[data-caption]').forEach(input => input.onchange = async () => {
    run('UPDATE page_gallery SET caption = ? WHERE id = ?', [input.value.trim(), input.dataset.caption]);
    await saveDB();
  });
}

function screenTemplates() {
  const templates = q('SELECT * FROM templates ORDER BY created_at');
  app.innerHTML = `${globalHeader('Templates')}<main>${templates.length ? templates.map(template => `<div class="card row"><span class="emo">🧩</span><span class="grow"><span class="t">${esc(template.name)}</span><span class="p">Template réutilisable</span></span></div>`).join('') : '<div class="empty">Aucun template.</div>'}</main>`;
  bindGlobal();
}

/* Compression partagée : 1400 px max, JPEG 0.82, fond blanc.
   C'est ce qui empêche la base SQLite de gonfler. */
function compressFile(file) {
  return new Promise(resolve => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      return resolve(null);
    }
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => resolve(null);
      image.onload = () => {
        const scale = Math.min(1, 1400 / image.naturalWidth, 1400 / image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return resolve(null);
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', .82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function pickImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const result = await compressFile(file);
      if (result === null) toast('Choisis une image JPEG, PNG ou WebP de moins de 12 Mo.', true);
      resolve(result);
    };
    input.click();
  });
}

/* Sélection multiple, comme dans Google Docs. Les fichiers refusés
   (format, taille) sont comptés dans un seul avertissement. */
function pickImages(max = 8) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])].slice(0, max);
      const overflow = (input.files?.length || 0) - files.length;
      const results = await Promise.all(files.map(compressFile));
      const ok = results.filter(Boolean);
      const refused = results.length - ok.length + overflow;
      if (refused > 0) {
        toast(`${refused} ${plural(refused, 'image')} ${refused > 1 ? 'ignorées' : 'ignorée'} (format, taille ou limite de ${max}).`, true);
      }
      resolve(ok);
    };
    input.click();
  });
}

/* options.center : boîte centrée à l'écran plutôt que feuille collée
   en bas. Réservé aux confirmations, qui doivent capter le regard. */
function openDialog(title, content, setup, options = {}) {
  const overlay = document.createElement('div');
  overlay.className = `overlay${options.center ? ' center' : ''}`;
  overlay.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialogTitle"><div class="sheet-head"><h2 id="dialogTitle">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">X</button></div>${content}</section>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.dispatchEvent(new CustomEvent('dialog-cancel'));
    overlay.remove();
  };
  overlay.querySelector('[data-close]').onclick = close;
  overlay.onclick = event => {
    if (event.target === overlay) close();
  };
  overlay.onkeydown = event => {
    if (event.key === 'Escape') close();
  };
  setup?.(overlay);
  return overlay;
}

function confirmDialog(title, message, onConfirm) {
  openDialog(title, `<p class="confirm-msg">${esc(message)}</p><div class="confirm-actions"><button type="button" class="cancel" data-cancel>Annuler</button><button type="button" class="danger" data-confirm>Confirmer</button></div>`, dialog => {
    dialog.querySelector('[data-cancel]').onclick = () => dialog.remove();
    dialog.querySelector('[data-confirm]').onclick = async event => {
      event.currentTarget.disabled = true;
      await onConfirm();
      dialog.remove();
    };
  }, { center: true });
}

/* ============================================================
   Paramètres, Apparence, Guide
   ============================================================ */

function settingRow(id, icon, title, hint) {
  return `
    <button type="button" class="setting-row" data-setting="${id}">
      <span class="setting-ico">${icon}</span>
      <span class="grow">
        <span class="setting-t">${esc(title)}</span>
        <span class="setting-h">${esc(hint)}</span>
      </span>
      <span class="setting-arrow" aria-hidden="true">›</span>
    </button>
  `;
}

function screenSettings() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const pages = q('SELECT COUNT(*) count FROM pages WHERE deleted_at IS NULL')[0].count;
  const spaces = q('SELECT COUNT(*) count FROM spaces')[0].count;
  const trashed = trashCount();

  app.innerHTML = `
    ${globalHeader('Paramètres')}
    <main>
      <div class="setting-group">
        <div class="setting-legend">Affichage</div>
        ${settingRow('appearance', icon('palette'), 'Apparence de l’accueil', 'Couleur du header, fond et icônes')}
        <button type="button" class="setting-row" data-setting="theme">
          <span class="setting-ico">${icon('theme')}</span>
          <span class="grow">
            <span class="setting-t">Thème général</span>
            <span class="setting-h">${dark ? 'Sombre' : 'Clair'}</span>
          </span>
          <span class="setting-toggle${dark ? '' : ' on'}" aria-hidden="true"></span>
        </button>
      </div>

      <div class="setting-group">
        <div class="setting-legend">Données</div>
        ${settingRow('json', icon('import'), 'Importer depuis JSON', 'Récupérer une page générée par une IA')}
        ${settingRow('export', icon('export'), 'Exporter mes données', 'Télécharger une sauvegarde .db')}
        ${settingRow('import', icon('import'), 'Importer une sauvegarde', 'Remplace les données actuelles')}
        ${settingRow('trash', icon('trash'), 'Corbeille', trashed ? `${trashed} ${plural(trashed, 'page')} en attente` : 'Vide')}
      </div>

      <div class="setting-group">
        <div class="setting-legend">Aide</div>
        ${settingRow('guide', icon('book'), 'Guide des fonctionnalités', 'Comment marche chaque outil')}
      </div>

      <div class="setting-stats">
        <span>${pages} ${plural(pages, 'page')}</span>
        <span>${spaces} ${plural(spaces, 'projet')}</span>
        <span>${trashed} en corbeille</span>
      </div>
    </main>
  `;

  bindGlobal();
  app.querySelectorAll('[data-setting]').forEach(button => {
    button.onclick = () => {
      const key = button.dataset.setting;
      if (key === 'theme') {
        document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', document.documentElement.dataset.theme);
        render();
        return;
      }
      if (key === 'json') return importJSON();
      if (key === 'export') return exportDB();
      if (key === 'import') return importDB();
      if (key === 'trash') return go('trash');
      if (key === 'guide') return go('guide');
      if (key === 'appearance') return go('appearance');
    };
  });
}

function screenAppearance() {
  const initial = getHomeAppearance();
  const iconStyle = localStorage.getItem(ICON_STYLE_KEY) || 'emoji';

  app.innerHTML = `
    ${globalHeader('Apparence')}
    <main>
      <p class="theme-help">Ces couleurs ne concernent que l’accueil général. Chaque projet garde son thème indépendant.</p>

      ${themeColorField('homeHeader', 'Couleur du header', initial.header)}
      ${themeColorField('homeBackground', 'Fond de l’accueil', initial.background)}

      <div class="lab">Style des icônes</div>
      <p class="theme-help">S’applique au menu latéral, à l’accueil et aux paramètres. Le choix est retenu.</p>
      <div class="icon-style-grid">
        ${Object.entries(ICON_LABELS).map(([key, label]) => `
          <button type="button" class="icon-style-choice${key === iconStyle ? ' on' : ''}" data-iconstyle="${key}" aria-pressed="${key === iconStyle}">
            <span class="isc-row">${ICON_SAMPLE.map(name => icon(name, { style: key, cls: 'isc-ic' })).join('')}</span>
            <span class="isc-label">${esc(label)}</span>
          </button>`).join('')}
      </div>

      <div class="home-theme-preview" id="homeThemePreview" aria-label="Aperçu de l’accueil">
        <div class="home-theme-preview-head">
          <span class="home-theme-preview-menu">☰</span>
          <strong><span>W</span>iki</strong>
          <span class="home-theme-preview-search">⌕</span>
        </div>
        <div class="home-theme-preview-body">Aperçu de l’accueil</div>
      </div>

      <button type="button" class="btn-ghost theme-reset" id="resetHomeAppearance">Réinitialiser</button>
      <button type="button" class="btn-accent quick" id="saveAppearance">Enregistrer</button>
    </main>
  `;

  bindGlobal();

  const controls = [['homeHeader', 'header'], ['homeBackground', 'background']];

  const readAppearance = () => Object.fromEntries(controls.map(([id, key]) => [
    key,
    normalizeHex(document.getElementById(`${id}Text`).value)
  ]));

  const updatePreview = () => {
    const appearance = readAppearance();
    if (Object.values(appearance).some(value => !value)) return;
    const preview = document.getElementById('homeThemePreview');
    preview.style.setProperty('--home-preview-header', appearance.header);
    preview.style.setProperty('--home-preview-header-text', contrast(appearance.header));
    preview.style.setProperty('--home-preview-background', appearance.background);
    preview.style.setProperty('--home-preview-background-text', contrast(appearance.background));
  };

  controls.forEach(([id]) => {
    const picker = document.getElementById(`${id}Picker`);
    const text = document.getElementById(`${id}Text`);

    picker.oninput = () => {
      text.value = picker.value.toUpperCase();
      text.setAttribute('aria-invalid', 'false');
      updatePreview();
    };
    text.oninput = () => {
      const normalized = normalizeHex(text.value);
      text.setAttribute('aria-invalid', String(!normalized));
      if (normalized) {
        picker.value = normalized;
        updatePreview();
      }
    };
    text.onblur = () => {
      const normalized = normalizeHex(text.value);
      if (normalized) text.value = normalized;
    };
  });

  document.getElementById('resetHomeAppearance').onclick = () => {
    const defaults = homeAppearanceDefaults();
    controls.forEach(([id, key]) => {
      document.getElementById(`${id}Picker`).value = defaults[key];
      document.getElementById(`${id}Text`).value = defaults[key];
      document.getElementById(`${id}Text`).setAttribute('aria-invalid', 'false');
    });
    updatePreview();
  };

  app.querySelectorAll('[data-iconstyle]').forEach(button => {
    button.onclick = () => {
      localStorage.setItem(ICON_STYLE_KEY, button.dataset.iconstyle);
      /* render() redessine l'écran courant : l'aperçu et tout le
         reste de l'app basculent immédiatement. */
      render();
      toast(`Icônes « ${ICON_LABELS[button.dataset.iconstyle]} ».`);
    };
  });

  document.getElementById('saveAppearance').onclick = () => {
    const appearance = readAppearance();
    if (Object.values(appearance).some(value => !value)) {
      return toast('Vérifie les codes couleur. Utilise #RGB ou #RRGGBB.', true);
    }
    localStorage.setItem(HOME_APPEARANCE_KEY, JSON.stringify(appearance));
    toast('Apparence enregistrée.');
    goHome();
  };

  updatePreview();
}

/* Mémo des mécanismes qu'on oublie entre deux sessions. */
const GUIDES = [
  {
    icon: '🔗',
    title: 'Lier deux pages',
    body: [
      'Dans l’éditeur, tape <b>[[</b> : un sélecteur de page s’ouvre aussitôt.',
      'Le bouton <b>Link</b> de la barre d’outils fait la même chose.',
      'En lecture, un lien vers une page supprimée s’affiche barré. Un lien vers la page courante s’affiche en gras, sans être cliquable.',
      'En bas de chaque page, la section <b>Liens entrants</b> liste les pages qui pointent vers elle.'
    ]
  },
  {
    icon: '🗂',
    title: 'Fiche d’information (infobox)',
    body: [
      'Sur une page, <b>⋮ → Ajouter une fiche</b>. C’est le tableau récapitulatif en tête d’article.',
      'Quatre briques : <b>titre</b>, <b>image</b>, <b>ligne</b> (nom + valeur), <b>section</b> (regroupe les lignes suivantes).',
      'Les flèches <b>↑ ↓</b> réordonnent, le <b>×</b> retire.',
      'Un champ laissé vide ne s’affiche pas. Une section sans champ rempli disparaît aussi. Rien à nettoyer.',
      'Le contenu de la fiche est <b>cherchable</b> : tu peux retrouver une page par la valeur d’un de ses champs.',
      'Ça marche pour tout : personnage (Espèce, Rang), lieu (Région, Population), prompt (Modèle, Verdict, Testé le).'
    ]
  },
  {
    icon: '📥',
    title: 'Importer depuis JSON',
    body: [
      '<b>Paramètres → Importer depuis JSON</b>, ou <b>＋ Importer</b> sur l’accueil d’un projet.',
      'Colle ce qu’une IA a produit, choisis le projet, appuie sur <b>Analyser</b> puis <b>Importer</b>.',
      'Clés reconnues : <b>title</b>, <b>body</b>, <b>categories</b>, <b>infobox</b> — les équivalents français marchent aussi (titre, contenu, catégories, fiche).',
      'L’infobox accepte la forme simple <b>{ "Région": "Nord" }</b> ou la forme groupée avec <b>groups</b>.',
      'Le texte peut être du markdown léger : <b>##</b> titres, <b>-</b> listes, <b>**gras**</b>.',
      'Un <b>tableau</b> d’objets importe plusieurs pages d’un coup.',
      'Les catégories nommées sont <b>créées automatiquement</b> si elles n’existent pas dans le projet.',
      'Le bouton <b>Voir le format</b> insère un exemple complet à copier.'
    ]
  },
  {
    icon: '🔎',
    title: 'Rechercher',
    body: [
      'Pendant la frappe, seuls les <b>titres</b> sont proposés. Valide pour lancer la recherche complète dans le texte.',
      'Plusieurs mots : tous doivent être présents, dans n’importe quel ordre.',
      '<b>-mot</b> exclut les pages contenant ce mot.',
      '<b>"mot"</b> cherche le mot entier, sans variantes.',
      'Les accents sont ignorés : <i>ecole</i> trouve <i>école</i>.',
      'Le résultat montre le texte <b>autour</b> du mot trouvé, en gras.',
      'Si rien ne correspond, la bannière du haut crée directement la page.'
    ]
  },
  {
    icon: '🗂',
    title: 'Bibliothèque, tri et filtre',
    body: [
      'Chaque bouton <b>Voir tout</b> ouvre la bibliothèque : toutes les pages, celles d’un projet ou d’une catégorie.',
      'Le champ du haut filtre à l’intérieur de l’écran courant.',
      'Le bouton <b>▤ / ▦</b> bascule entre liste et grille. Le choix est retenu.',
      'Le tri se choisit en deux temps : le <b>champ</b> (date, titre, taille) puis le <b>sens</b> avec la flèche ↓ / ↑.',
      'Les pages épinglées remontent toujours en tête, quel que soit le tri.'
    ]
  },
  {
    icon: '✋',
    title: 'Sélectionner plusieurs pages',
    body: [
      'Dans la bibliothèque, <b>reste appuyé</b> sur une page : le mode sélection s’active (courte vibration).',
      'Touche ensuite les autres pages pour les ajouter.',
      'Le <b>☑</b> du header sélectionne ou désélectionne tout l’écran.',
      'Le <b>⋮</b> applique une action à tout le lot : épingler, déplacer, relier à une catégorie, mettre à la corbeille.',
      'Relier à une catégorie exige que les pages soient dans le <b>même projet</b>.'
    ]
  },
  {
    icon: '🗑',
    title: 'Corbeille',
    body: [
      `Supprimer une page ne la détruit pas : elle part en corbeille pour <b>${TRASH_DAYS} jours</b>.`,
      'Un bandeau <b>Annuler</b> apparaît pendant 5 secondes juste après.',
      'Une page en corbeille disparaît de l’accueil, des projets, de la recherche et du sélecteur de liens.',
      'On peut encore l’ouvrir depuis un lien : un bandeau rouge propose de la restaurer.',
      'La purge s’exécute <b>au lancement de l’app</b>, jamais en arrière-plan.',
      '<b>Supprimer définitivement</b> est la seule action sans retour ; elle prévient des liens qui vont mourir.'
    ]
  },
  {
    icon: '★',
    title: 'Épingler',
    body: [
      'Le bouton <b>☆ Épingler</b> est en haut de chaque page, à gauche de Modifier.',
      'Les pages épinglées apparaissent en tête de l’accueil et dans le menu latéral.',
      'C’est fait pour les pages d’index d’un projet, pas pour marquer une lecture.'
    ]
  },
  {
    icon: '📁',
    title: 'Projets et catégories',
    body: [
      'Une page appartient à <b>un</b> projet, et peut porter <b>plusieurs</b> catégories de ce projet.',
      'Le bouton <b>+ Ajouter</b> à côté de « Catégories » en crée une, dans n’importe quel modèle de projet.',
      'Le nombre sur chaque vignette de catégorie est son nombre de pages.',
      'Déplacer une page vers un autre projet <b>efface ses catégories</b> : elles appartenaient à l’ancien projet.',
      'Supprimer un projet ne détruit aucune page : elles retournent dans l’Inbox.',
      'Supprimer une catégorie ne supprime pas ses pages non plus.'
    ]
  },
  {
    icon: '💾',
    title: 'Sauvegarde et données',
    body: [
      'L’éditeur enregistre <b>tout seul</b> 1 seconde après la dernière frappe, et dès que tu quittes l’app.',
      'Tout est stocké <b>sur ton téléphone</b>, jamais en ligne. Personne d’autre n’y a accès.',
      'Installe l’app sur l’écran d’accueil : le stockage devient permanent et ne peut plus être purgé.',
      '<b>Exporter</b> télécharge un fichier .db unique contenant tout. À faire de temps en temps.',
      '<b>Importer</b> remplace intégralement les données actuelles.'
    ]
  },
  {
    icon: '🎨',
    title: 'Thèmes',
    body: [
      'Chaque projet a ses <b>4 couleurs</b> : accent, barre du projet, fond du wiki, fond des articles.',
      'Le fond des articles reprend une pointe de la couleur du projet, pour lui donner une ambiance.',
      'Le header noir et la barre système restent identiques partout : c’est le repère fixe.',
      '<b>Paramètres → Apparence</b> ne change que l’accueil général.'
    ]
  }
];

function screenGuide() {
  app.innerHTML = `
    ${globalHeader('Guide')}
    <main>
      <p class="theme-help">Un rappel de chaque mécanisme, pour ne pas avoir à les redécouvrir.</p>
      <div class="guide-list">
        ${GUIDES.map((guide, index) => `
          <div class="guide-item">
            <button type="button" class="guide-head" data-guide="${index}" aria-expanded="false">
              <span class="guide-ico">${guide.icon}</span>
              <span class="guide-t">${esc(guide.title)}</span>
              <span class="guide-chev" aria-hidden="true">⌄</span>
            </button>
            <div class="guide-body" hidden>
              <ul>${guide.body.map(line => `<li>${line}</li>`).join('')}</ul>
            </div>
          </div>
        `).join('')}
      </div>
    </main>
  `;

  bindGlobal();
  app.querySelectorAll('[data-guide]').forEach(button => {
    button.onclick = () => {
      const body = button.nextElementSibling;
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    };
  });
}

function openGlobalDrawer() {
  const trashed = trashCount();
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.innerHTML = `
    <aside class="drawer">
      <div class="drawer-head">${logoHTML()}<button type="button" class="icon-btn" data-close aria-label="Fermer">X</button></div>
      <nav class="drawer-nav"><button type="button" class="dr-item" data-route="home">${icon('home', { cls: 'dr-ico' })}Accueil</button><button type="button" class="dr-item" data-route="inbox">${icon('inbox', { cls: 'dr-ico' })}Inbox</button><button type="button" class="dr-item" data-route="library:all">${icon('layers', { cls: 'dr-ico' })}Toutes les pages</button><button type="button" class="dr-item" data-route="library:pinned">${icon('star', { cls: 'dr-ico' })}Épinglées</button><button type="button" class="dr-item" data-route="templates">${icon('templates', { cls: 'dr-ico' })}Templates</button><button type="button" class="dr-item" data-route="trash">${icon('trash', { cls: 'dr-ico' })}Corbeille${trashed ? `<span class="badge dr-badge">${trashed}</span>` : ''}</button></nav>
      <div class="drawer-sep"></div>
      <button type="button" class="dr-item" id="exportDB">${icon('export', { cls: 'dr-ico' })}Exporter mes données</button>
      <button type="button" class="dr-item" id="importDB">${icon('import', { cls: 'dr-ico' })}Importer une sauvegarde</button>
      <button type="button" class="dr-item" id="theme">${icon('theme', { cls: 'dr-ico' })}Changer de thème</button>
      <button type="button" class="dr-item" id="settings">${icon('settings', { cls: 'dr-ico dr-ico-settings' })}Paramètres</button>
    </aside>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 240);
  };
  overlay.querySelector('[data-close]').onclick = close;
  overlay.onclick = event => {
    if (event.target === overlay) close();
  };
  overlay.querySelectorAll('[data-route]').forEach(button => button.onclick = () => {
    close();
    const route = button.dataset.route;
    if (route === 'home') return goHome();
    if (route.startsWith('library:')) return go('library', route.slice(8));
    go(route);
  });
  overlay.querySelector('#exportDB').onclick = () => {
    close();
    exportDB();
  };
  overlay.querySelector('#importDB').onclick = () => {
    close();
    importDB();
  };
  overlay.querySelector('#theme').onclick = () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', document.documentElement.dataset.theme);
    close();
    render();
  };
  overlay.querySelector('#settings').onclick = () => {
    close();
    go('settings');
  };
}

function openContextDrawer() {
  const space = currentSpace();
  if (!space) return;
  const categories = getSpaceCategories(space.id);
  const pages = q('SELECT id,title FROM pages WHERE space_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50', [space.id]);
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.innerHTML = `<aside class="drawer ctx-drawer"><div class="drawer-head"><strong>${esc(space.name)}</strong><button type="button" class="icon-btn" data-close aria-label="Fermer">X</button></div><button type="button" class="dr-item" data-home>Accueil du projet</button><div class="drawer-sep"></div>${categories.map(category => `<button type="button" class="dr-item" data-category="${esc(category.id)}">${esc(category.name)}</button>`).join('')}<div class="drawer-sep"></div>${pages.map(page => `<button type="button" class="dr-item" data-page="${esc(page.id)}">${esc(page.title?.trim() || 'Sans titre')}</button>`).join('')}</aside>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 240);
  };
  overlay.querySelector('[data-close]').onclick = close;
  overlay.querySelector('[data-home]').onclick = () => {
    close();
    go('space', space.id);
  };
  overlay.querySelectorAll('[data-category]').forEach(button => button.onclick = () => {
    close();
    go('category', button.dataset.category);
  });
  overlay.querySelectorAll('[data-page]').forEach(button => button.onclick = () => {
    close();
    go('read', button.dataset.page);
  });
}

/* ============================================================
   Import JSON — pour récupérer ce qu'une IA produit sans
   avoir à recopier à la main.
   ============================================================ */

/* Texte brut ou markdown léger vers HTML. On ne gère que ce qu'un
   modèle produit couramment : titres, listes, gras, italique, citations. */
function textToHTML(input) {
  const source = String(input ?? '').replace(/\r\n/g, '\n').trim();
  if (!source) return '';
  if (/^\s*<(p|h[1-6]|ul|ol|blockquote|div)\b/i.test(source)) return sanitizeHTML(source);

  const inline = text => esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>');

  const out = [];
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
  };

  source.split('\n').forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return closeList();

    const heading = line.match(/^(#{2,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      return;
    }
    if (/^#\s+/.test(line)) {
      closeList();
      out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`);
      return;
    }
    if (/^[-*•]\s+/.test(line)) {
      list = list || [];
      list.push(`<li>${inline(line.replace(/^[-*•]\s+/, ''))}</li>`);
      return;
    }
    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`);
      return;
    }
    if (/^(-{3,}|_{3,})$/.test(line)) {
      closeList();
      out.push('<hr>');
      return;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  });

  closeList();
  return sanitizeHTML(out.join(''));
}

/* Très permissif : un objet, un tableau d'objets, ou { pages: [...] }.
   Les clés françaises et anglaises sont acceptées. */
function extractPages(data) {
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.pages) ? data.pages
    : data && typeof data === 'object' ? [data]
    : [];

  return list
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title ?? item.titre ?? item.nom ?? item.name ?? '').trim();
      const body = item.body ?? item.contenu ?? item.content ?? item.texte ?? item.text ?? '';
      const rawCats = item.categories ?? item.categorie ?? item.category ?? item.tags ?? [];
      const categories = (Array.isArray(rawCats) ? rawCats : String(rawCats).split(','))
        .map(value => String(value).trim())
        .filter(Boolean);
      const infobox = normalizeInfobox(item.infobox ?? item.fiche ?? item.attributs ?? item.attributes ?? null);
      if (!title && !body && !infobox) return null;
      return { title: title || 'Sans titre', body: textToHTML(body), categories, infobox };
    })
    .filter(Boolean);
}

function importJSON(defaultSpaceId = null) {
  const spaces = q('SELECT id,name FROM spaces ORDER BY name COLLATE NOCASE');

  openDialog('Importer depuis JSON', `
    <p class="theme-help">Colle ce qu’une IA t’a généré. Une page, ou plusieurs dans un tableau. Les champs manquants sont simplement ignorés.</p>

    <label class="lab" for="jsonSpace">Projet de destination</label>
    <select class="field" id="jsonSpace">
      <option value="">📥 Inbox</option>
      ${spaces.map(item => `<option value="${esc(item.id)}"${item.id === defaultSpaceId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}
    </select>

    <label class="lab" for="jsonInput">Contenu JSON</label>
    <textarea class="field json-input" id="jsonInput" rows="9" spellcheck="false" placeholder='{ "title": "Ymir", "body": "...", "infobox": { "Région": "Nord" } }'></textarea>

    <div class="json-actions">
      <button type="button" class="btn-ghost" id="jsonFile">Depuis un fichier</button>
      <button type="button" class="btn-ghost" id="jsonModel">Voir le format</button>
    </div>

    <div id="jsonPreview"></div>
    <button type="button" class="btn-accent quick" id="jsonRun">Analyser</button>
  `, dialog => {
    const input = dialog.querySelector('#jsonInput');
    const preview = dialog.querySelector('#jsonPreview');
    let pending = [];

    dialog.querySelector('#jsonFile').onclick = () => {
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = '.json,application/json,text/plain';
      file.onchange = async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        input.value = await chosen.text();
        toast('Fichier chargé. Appuie sur Analyser.');
      };
      file.click();
    };

    dialog.querySelector('#jsonModel').onclick = () => {
      input.value = JSON.stringify({
        title: 'Ymir',
        categories: ['Lieux'],
        infobox: {
          subtitle: 'Cité-état',
          groups: [
            { header: 'Géographie', rows: [{ label: 'Région', value: 'Détroit noir' }] },
            { header: 'Société', rows: [{ label: 'Population', value: '34 000' }] }
          ]
        },
        body: '## Histoire\nLa cité naît d\'un refus.\n\n- Premier point\n- Second point'
      }, null, 2);
    };

    dialog.querySelector('#jsonRun').onclick = () => {
      const raw = input.value.trim();
      if (!raw) return toast('Colle d’abord du JSON.', true);

      let data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        preview.innerHTML = `<div class="json-error">JSON invalide : ${esc(error.message)}</div>`;
        return;
      }

      pending = extractPages(data);
      if (!pending.length) {
        preview.innerHTML = '<div class="json-error">Aucune page exploitable. Il faut au moins un titre, un texte ou une fiche.</div>';
        return;
      }

      preview.innerHTML = `
        <div class="json-ok">${pending.length} ${plural(pending.length, 'page')} ${pending.length > 1 ? 'prêtes' : 'prête'} à importer</div>
        <div class="picker-list json-list">
          ${pending.map(item => `
            <div class="picker-item">
              <b>${esc(item.title)}</b>
              <span class="json-meta">${item.infobox && !infoboxIsEmpty(item.infobox) ? '🗂 fiche · ' : ''}${item.categories.length ? `${item.categories.length} ${plural(item.categories.length, 'catégorie')} · ` : ''}${strip(item.body).length} caractères</span>
            </div>`).join('')}
        </div>
        <button type="button" class="btn-accent quick" id="jsonConfirm">Importer</button>
      `;

      preview.querySelector('#jsonConfirm').onclick = async () => {
        const spaceId = dialog.querySelector('#jsonSpace').value || null;
        const now = Date.now();
        let created = 0;

        transaction(() => {
          pending.forEach(item => {
            const id = uid();
            const infoboxJSON = item.infobox && !infoboxIsEmpty(item.infobox)
              ? JSON.stringify(item.infobox)
              : '{}';

            run(`INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,infobox,title_align,search_text)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`, [
              id, item.title, item.body, now, now,
              spaceId ? 0 : 1, spaceId, infoboxJSON, 'left',
              buildSearchText(item.title, item.body, infoboxJSON)
            ]);

            /* Les catégories nommées sont créées à la volée si besoin —
               comme les « wanted categories » de Fandom. */
            if (spaceId) {
              item.categories.forEach(name => {
                const existing = q(
                  'SELECT id FROM categories WHERE space_id = ? AND LOWER(name) = LOWER(?)',
                  [spaceId, name]
                )[0];
                let categoryId = existing?.id;
                if (!categoryId) {
                  categoryId = uid();
                  const max = q('SELECT MAX(position) position FROM categories WHERE space_id = ?', [spaceId])[0].position;
                  run('INSERT INTO categories (id,space_id,name,intro,banner,position,created_at) VALUES (?,?,?,?,?,?,?)',
                    [categoryId, spaceId, name, '', null, (max ?? -1) + 1, now]);
                }
                run('INSERT OR IGNORE INTO page_categories (page_id,category_id) VALUES (?,?)', [id, categoryId]);
              });
            }
            created += 1;
          });
        });

        await saveDB();
        dialog.remove();
        if (spaceId) go('space', spaceId); else go('library', 'inbox');
        toast(`${created} ${plural(created, 'page')} ${created > 1 ? 'importées' : 'importée'}.`);
      };
    };

    input.focus();
  });
}

function exportDB() {
  const url = URL.createObjectURL(new Blob([db.export()], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `wiki-sauvegarde-${new Date().toISOString().slice(0, 10)}.db`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Sauvegarde exportée.');
}

function importDB() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.db,application/octet-stream';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const next = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
      const tables = next.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.flat() || [];
      if (!['pages', 'spaces', 'categories', 'page_categories', 'page_gallery'].every(table => tables.includes(table))) {
        next.close();
        throw new Error('Tables requises manquantes.');
      }
      confirmDialog('Importer cette sauvegarde ?', 'Les données actuelles seront remplacées.', async () => {
        const previous = db;
        db = next;
        try {
          run('PRAGMA foreign_keys = ON');
          const spaceColumns = new Set(q('PRAGMA table_info(spaces)').map(column => column.name));
          [
            ['accent_color', 'TEXT'],
            ['header_color', 'TEXT'],
            ['background_color', 'TEXT'],
            ['page_color', 'TEXT']
          ].forEach(([column, type]) => {
            if (!spaceColumns.has(column)) run(`ALTER TABLE spaces ADD COLUMN ${column} ${type}`);
          });

          /* Sans ces colonnes, toute la recherche planterait sur une
             sauvegarde antérieure. */
          const pageColumns = new Set(q('PRAGMA table_info(pages)').map(column => column.name));
          if (!pageColumns.has('search_text')) run('ALTER TABLE pages ADD COLUMN search_text TEXT');
          if (!pageColumns.has('deleted_at')) run('ALTER TABLE pages ADD COLUMN deleted_at INTEGER');

          const categoryColumns = new Set(q('PRAGMA table_info(categories)').map(column => column.name));
          if (!categoryColumns.has('parent_id')) run('ALTER TABLE categories ADD COLUMN parent_id TEXT');
          if (!categoryColumns.has('color')) run('ALTER TABLE categories ADD COLUMN color TEXT');

          backfillSearchText();

          goHome();
          toast('Données chargées. Enregistrement en cours...');

          requestAnimationFrame(() => {
            requestAnimationFrame(async () => {
              try {
                await saveDB();
                previous.close();
                toast('Sauvegarde importée.');
              } catch (error) {
                console.error('Persistance de la base importée impossible :', error);
                toast(
                  `Les données sont chargées, mais leur enregistrement a échoué : ${error.message}`,
                  true
                );
              }
            });
          });
        } catch (error) {
          db = previous;
          next.close();
          toast(`Import impossible : ${error.message}`, true);
        }
      });
    } catch (error) {
      toast(`Fichier SQLite invalide : ${error.message}`, true);
    }
  };
  input.click();
}

function cleanup() {
  if (editorFlush) {
    document.removeEventListener('visibilitychange', editorFlush);
    editorFlush = null;
  }
  if (editor) {
    editor.destroy();
    editor = null;
  }
  selection.clear();
  document.querySelectorAll('.overlay, .drawer-overlay, .quick-page-menu').forEach(element => element.remove());
}

/* ---- Navigation ----
   La profondeur de pile est stockée dans history.state : c'est elle qui
   fait autorité au retour, ce qui empêche stack et history de diverger. */
function go(name, param = null) {
  stack.push({ name, param });
  history.pushState({ app: true, depth: stack.length }, '');
  render();
}

function replaceCurrent(name, param = null) {
  stack[stack.length - 1] = { name, param };
  history.replaceState({ app: true, depth: stack.length }, '');
  render();
}

function back() {
  if (stack.length > 1) history.back();
  else toast('Tu es déjà à l’accueil.');
}

function goHome() {
  const steps = stack.length - 1;
  if (steps > 0) {
    history.go(-steps);
    return;
  }
  stack = [{ name: 'home' }];
  history.replaceState({ app: true, depth: 1 }, '');
  render();
}

function render() {
  cleanup();
  applyTheme();
  const route = stack.at(-1) || { name: 'home' };
  const routes = {
    home: screenHome,
    newspace: screenNewSpace,
    space: screenSpace,
    category: screenCategory,
    inbox: screenInbox,
    recent: () => replaceCurrent('library', 'all'),
    search: screenSearch,
    edit: screenEdit,
    read: screenRead,
    templates: screenTemplates,
    gallery: screenGallery,
    trash: screenTrash,
    library: screenLibrary,
    settings: screenSettings,
    appearance: screenAppearance,
    guide: screenGuide
  };
  app.innerHTML = '<div class="empty">Chargement...</div>';
  (routes[route.name] || screenHome)(route.param);
  window.scrollTo(0, 0);
}

function toast(message, error = false, action = null) {
  document.querySelectorAll('.toast').forEach(element => element.remove());

  const element = document.createElement('div');
  element.className = `toast${error ? ' err' : ''}`;
  element.setAttribute('role', error ? 'alert' : 'status');

  const label = document.createElement('span');
  label.textContent = message;
  element.appendChild(label);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.onclick = () => {
      element.remove();
      action.run();
    };
    element.appendChild(button);
  }

  document.body.appendChild(element);
  requestAnimationFrame(() => element.classList.add('show'));
  setTimeout(() => {
    element.classList.remove('show');
    setTimeout(() => element.remove(), 250);
  }, action ? 5000 : 2400);
}

window.addEventListener('popstate', event => {
  const depth = event.state?.depth || 1;
  stack = stack.slice(0, depth);
  if (!stack.length) stack = [{ name: 'home' }];
  render();
});

document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';

try {
  await initDB();
  history.replaceState({ app: true, depth: 1 }, '');
  render();
} catch (error) {
  app.innerHTML = `<div class="empty" role="alert">Erreur : ${esc(error.message || error)}</div>`;
}
