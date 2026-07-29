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

function strip(html) {
  const documentHTML = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (documentHTML.body.textContent || '').replace(/\s+/g, ' ').trim();
}

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
    'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'PRE', 'CODE', 'A'
  ]);
  const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');

  [...parsed.body.querySelectorAll('*')].forEach(element => {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }

    [...element.attributes].forEach(attribute => {
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
  run('CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY,title TEXT,body TEXT,created_at INTEGER,updated_at INTEGER,is_inbox INTEGER DEFAULT 1,space_id TEXT,template_id TEXT,infobox TEXT,cover TEXT,is_pinned INTEGER DEFAULT 0,title_align TEXT DEFAULT "left")');
  run('CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,name TEXT,emoji TEXT,fields TEXT,created_at INTEGER)');
  run('CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY,space_id TEXT,name TEXT,intro TEXT,banner TEXT,template_id TEXT,position INTEGER,created_at INTEGER)');
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
    ['spaces', 'image', 'TEXT'],
    ['spaces', 'banner', 'TEXT'],
    ['spaces', 'home_body', 'TEXT'],
    ['spaces', 'model', 'TEXT'],
    ['spaces', 'accent_color', 'TEXT'],
    ['spaces', 'header_color', 'TEXT'],
    ['spaces', 'background_color', 'TEXT'],
    ['spaces', 'page_color', 'TEXT']
  ].forEach(item => ensureColumn(...item));

  run('CREATE INDEX IF NOT EXISTS idx_pages_space_updated ON pages(space_id, updated_at DESC)');
  run('CREATE INDEX IF NOT EXISTS idx_categories_space ON categories(space_id, position)');
  run('CREATE INDEX IF NOT EXISTS idx_gallery_page ON page_gallery(page_id, position)');
  await saveDB();
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
  document.body.style.setProperty('--project-page-bg', palette.page);
  document.body.style.setProperty('--project-page-text', contrast(palette.page));
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
      const appearance = getHomeAppearance();
      applyHomeAppearance(appearance);
      document.querySelector('meta[name="theme-color"]').content = appearance.header;
    } else {
      document.querySelector('meta[name="theme-color"]').content = '#0C0C0C';
    }
    return;
  }

  const palette = getSpacePalette(space);
  applyPalette(palette);
  document.querySelector('meta[name="theme-color"]').content = palette.header;
}

const logoHTML = () => '<span class="logo"><span class="w">W</span>iki</span>';

function globalHeader(title = '') {
  return `
    <header class="top global">
      <button type="button" class="menu-btn" id="openMenu" aria-label="Menu global">
        <span></span><span></span><span></span>
      </button>
      ${logoHTML()}
      ${title ? `<div class="title">${esc(title)}</div>` : ''}
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
  document.getElementById('ctxToc')?.addEventListener('click', openContextDrawer);
  document.getElementById('ctxPin')?.addEventListener('click', () => togglePin(stack.at(-1).param));
}

function pageCard(page) {
  return `
    <button type="button" class="card page-card" data-page="${esc(page.id)}">
      <div class="t">${esc(page.title?.trim() || 'Sans titre')}${page.is_pinned ? ' ★' : ''}</div>
      ${strip(page.body) ? `<div class="p">${esc(strip(page.body).slice(0, 130))}</div>` : ''}
      <div class="d">${fmt(page.updated_at)}</div>
    </button>
  `;
}

function rcard(page) {
  const space = page.space_id ? getSpace(page.space_id) : null;
  return `
    <div class="rcard-shell">
      <button type="button" class="rcard" data-page="${esc(page.id)}">
        <div class="rcard-img">${safeImage(page.cover) ? `<img src="${esc(safeImage(page.cover))}" alt="">` : ''}</div>
        <div class="rcard-t">${esc(page.title?.trim() || 'Sans titre')}</div>
        <div class="rcard-m"><span>${space?.emoji || '📥'}</span><span>${esc(space?.name || 'Inbox')}</span></div>
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

function portalCard(category) {
  const banner = safeImage(category.banner);
  return `
    <button type="button" class="portal-card${banner ? '' : ' portal-card--empty'}" data-category="${esc(category.id)}">
      ${banner ? `<img src="${esc(banner)}" alt="">` : `<div class="portal-placeholder">${esc(category.name[0])}</div>`}
      <span class="portal-name">${esc(category.name)}</span>
      <span class="portal-mark" aria-hidden="true">+</span>
    </button>
  `;
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
  const recent = q('SELECT id,title,cover,space_id,updated_at FROM pages ORDER BY updated_at DESC LIMIT 8');
  const inbox = q('SELECT COUNT(*) count FROM pages WHERE space_id IS NULL')[0].count;

  app.innerHTML = `
    ${globalHeader()}
    <main>
      <div class="sec-row"><div class="sec">Re-plongez-vous</div><button type="button" class="sec-link" id="recentAll">Voir tout</button></div>
      <div class="hscroll">${recent.map(rcard).join('') || '<div class="empty">Rien pour le moment.</div>'}</div>
      <div class="sec">Mes projets</div>
      <div class="hscroll avatars">
        ${spaces.map(space => {
          const image = safeImage(space.image);
          const iconColor = getSpacePalette(space).accent;
          return `<button type="button" class="avatar" data-space="${esc(space.id)}"><span class="av-c" data-avatar-image="${esc(image)}" style="background-color:${iconColor};color:${contrast(iconColor)}">${image ? '' : esc(space.emoji || space.name[0])}</span><span class="av-n">${esc(space.name)}</span></button>`;
        }).join('')}
        <button type="button" class="avatar" id="newSpace"><span class="av-c av-add">+</span><span class="av-n">Créer</span></button>
      </div>
      <button type="button" class="card row" id="toInbox"><span class="emo">📥</span><span class="grow"><span class="t">Inbox</span><span class="p">Idées non classées</span></span>${inbox ? `<span class="badge">${inbox}</span>` : ''}</button>
      <button type="button" class="card row" id="toTemplates"><span class="emo">🧩</span><span class="grow"><span class="t">Templates</span><span class="p">Fiches réutilisables</span></span></button>
    </main>
    <button type="button" class="fab" id="fab" aria-label="Nouvelle page">+</button>
  `;

  bindGlobal();
  app.querySelectorAll('[data-avatar-image]').forEach(element => {
    if (element.dataset.avatarImage) element.style.backgroundImage = `url("${element.dataset.avatarImage.replace(/"/g, '%22')}")`;
  });
  app.querySelectorAll('[data-space]').forEach(element => {
    element.addEventListener('click', () => go('space', element.dataset.space));
  });
  document.getElementById('newSpace').onclick = () => go('newspace');
  document.getElementById('toInbox').onclick = () => go('inbox');
  document.getElementById('toTemplates').onclick = () => go('templates');
  document.getElementById('recentAll').onclick = () => go('recent');
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
  const pages = q('SELECT * FROM pages WHERE space_id = ? ORDER BY updated_at DESC', [id]);

  app.innerHTML = `
    ${wrapHeader(space, null, globalHeader())}
    <main class="project-home">
      ${safeImage(space.banner) ? `<div class="space-hero"><img src="${esc(safeImage(space.banner))}" alt=""></div>` : ''}
      <section class="project-intro">
        <div class="project-body">${esc(space.home_body || 'Ce projet n’a pas encore d’introduction.')}</div>
        <div class="project-actions"><button type="button" class="action-link" id="editSpace">Modifier le projet</button><button type="button" class="action-link" id="randomPage">Page au hasard</button></div>
      </section>
      <div class="project-stats"><div class="project-stat"><b>${pages.length}</b><span>Pages</span></div><div class="project-stat"><b>${categories.length}</b><span>Catégories</span></div><div class="project-stat"><b>${pages.filter(page => page.cover).length}</b><span>Illustrées</span></div></div>
      <div class="sec project-section-title">Catégories</div>
      ${categories.length ? `<div class="portal-grid">${categories.map(portalCard).join('')}</div>` : '<div class="category-empty">Aucune catégorie.</div>'}
      <div class="sec-row"><div class="sec">Dernières pages</div><button type="button" class="sec-link" id="allPages">Voir tout</button></div>
      ${pages.slice(0, 4).map(pageCard).join('') || '<div class="empty project-empty">Aucune page dans ce projet.</div>'}
    </main>
    <button type="button" class="fab" id="fab" aria-label="Nouvelle page">+</button>
  `;

  bindGlobal();
  document.getElementById('editSpace').onclick = () => editSpace(space);
  document.getElementById('allPages').onclick = openContextDrawer;
  document.getElementById('fab').onclick = () => quickNote(id);
  document.getElementById('randomPage').onclick = () => pages.length
    ? go('read', pages[Math.floor(Math.random() * pages.length)].id)
    : toast('Aucune page dans ce projet.');
  wirePages();
}

function editSpace(space) {
  const initialPalette = getSpacePalette(space);
  let projectImage = safeImage(space.image) || null;
  let projectBanner = safeImage(space.banner) || null;

  openDialog('Modifier le projet', `
    <form id="spaceEditForm">
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

      const palette = readPalette();
      if (Object.values(palette).some(value => !value)) {
        return toast('Vérifie les codes couleur. Utilise #RGB ou #RRGGBB.', true);
      }

      run(`
        UPDATE spaces
        SET home_body = ?, image = ?, banner = ?, accent_color = ?, header_color = ?,
            background_color = ?, page_color = ?
        WHERE id = ?
      `, [
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
  const pages = q('SELECT p.* FROM pages p JOIN page_categories pc ON pc.page_id = p.id WHERE pc.category_id = ? ORDER BY p.updated_at DESC', [id]);

  app.innerHTML = `
    ${wrapHeader(space, null, globalHeader())}
    <main>
      ${safeImage(category.banner) ? `<div class="category-hero"><img src="${esc(safeImage(category.banner))}" alt=""></div>` : ''}
      <section class="category-heading"><div class="category-heading-row"><h1>${esc(category.name)}</h1><button type="button" class="btn-ghost" id="editCategory">Modifier</button></div>${category.intro ? `<p>${esc(category.intro)}</p>` : ''}</section>
      ${pages.length ? `<div class="entity-grid">${pages.map(entityCard).join('')}</div>` : '<div class="category-empty">Cette catégorie est vide.<br>Crée une page pour commencer.</div>'}
      <button type="button" class="btn-accent quick" id="newCatPage">+ Nouvelle page</button>
    </main>
  `;

  bindGlobal();
  document.getElementById('editCategory').onclick = () => editCategory(category);
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
    </form>
  `, dialog => {
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

async function quickNote(spaceId, categoryId = null) {
  try {
    if (categoryId && getCategory(categoryId)?.space_id !== spaceId) {
      throw new Error('La catégorie ne correspond pas au projet.');
    }
    const id = uid();
    const now = Date.now();
    transaction(() => {
      run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,infobox,title_align) VALUES (?,?,?,?,?,?,?,?,?)', [id, '', '', now, now, spaceId ? 0 : 1, spaceId, '{}', 'left']);
      if (categoryId) run('INSERT INTO page_categories (page_id,category_id) VALUES (?,?)', [id, categoryId]);
    });
    await saveDB();
    go('edit', id);
  } catch (error) {
    toast(`Impossible de créer la note : ${error.message}`, true);
  }
}

function screenInbox() {
  const pages = q('SELECT id,title,body,updated_at,is_pinned FROM pages WHERE space_id IS NULL ORDER BY updated_at DESC');
  app.innerHTML = `${globalHeader('Inbox')}<main>${pages.map(pageCard).join('') || '<div class="empty">Rien dans l’Inbox.</div>'}</main><button type="button" class="fab" id="fab" aria-label="Nouvelle note">+</button>`;
  bindGlobal();
  document.getElementById('fab').onclick = () => quickNote(null);
  wirePages();
}

function screenRecent() {
  const pages = q('SELECT id,title,body,updated_at,is_pinned FROM pages ORDER BY updated_at DESC');
  app.innerHTML = `${globalHeader('Pages récentes')}<main>${pages.map(pageCard).join('') || '<div class="empty">Aucune page.</div>'}</main>`;
  bindGlobal();
  wirePages();
}

function screenSearch() {
  let timer = null;
  app.innerHTML = `${globalHeader('Recherche')}<main><form class="search-row" id="searchForm"><label class="sr-only" for="searchInput">Rechercher</label><input class="search-input" id="searchInput" type="search" placeholder="Rechercher dans le wiki..."><button class="btn-accent" type="submit">OK</button></form><div id="results"><div class="empty">Tape un mot : titres et textes sont fouillés.</div></div></main>`;
  bindGlobal();

  const input = document.getElementById('searchInput');
  const results = document.getElementById('results');
  const draw = () => {
    const query = input.value.trim();
    if (!query) {
      results.innerHTML = '<div class="empty">Tape un mot : titres et textes sont fouillés.</div>';
      return;
    }
    const needle = normalize(query);
    const pages = q('SELECT id,title,body,updated_at,is_pinned FROM pages ORDER BY updated_at DESC')
      .filter(page => normalize(`${page.title} ${strip(page.body)}`).includes(needle))
      .slice(0, 50);
    results.innerHTML = pages.map(pageCard).join('') || `<div class="empty">Aucun résultat pour « ${esc(query)} ».</div>`;
    wirePages(results);
  };

  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 180);
  };
  document.getElementById('searchForm').onsubmit = event => {
    event.preventDefault();
    draw();
  };
  input.focus();
}

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
      <button type="button" class="tb" data-command="italic" aria-label="Italique" aria-pressed="false">I</button>
      <button type="button" class="tb" data-command="h2" aria-label="Titre 2" aria-pressed="false">H2</button>
      <button type="button" class="tb" data-command="h3" aria-label="Titre 3" aria-pressed="false">H3</button>
      <button type="button" class="tb" data-command="bullet" aria-label="Liste" aria-pressed="false">•</button>
      <button type="button" class="tb" data-command="quote" aria-label="Citation" aria-pressed="false">Q</button>
      <button type="button" class="tb" data-command="link" aria-label="Lien wiki">Link</button>
    </div>
  `;
}

function screenEdit(id) {
  const page = getPage(id);
  if (!page) return goHome();
  const space = page.space_id ? getSpace(page.space_id) : null;
  const categories = space ? getSpaceCategories(space.id) : [];
  const selected = new Set(getPageCategories(id).map(category => category.id));

  app.innerHTML = `
    ${wrapHeader(space, page, globalHeader('Édition'))}
    <main>
      <label class="sr-only" for="pageTitle">Titre</label><input class="title-input" id="pageTitle" maxlength="160" placeholder="Titre" value="${esc(page.title || '')}">
      <div class="cover-picker"><button type="button" class="cover-preview" id="coverPreview">Ajouter une image de couverture</button><div class="cover-actions"><button type="button" class="btn-ghost" id="coverBtn">Choisir une image</button><button type="button" class="btn-ghost" id="clearCover">Retirer</button></div></div>
      ${categories.length ? `<div class="lab">Catégories</div><div class="category-chips">${categories.map(category => `<button type="button" class="category-chip" data-category-choice="${esc(category.id)}" aria-pressed="${selected.has(category.id)}">${esc(category.name)}</button>`).join('')}</div>` : ''}
      <div class="editor-wrap"><div id="editor"></div></div>
    </main>
    ${toolbar()}
    <button type="button" class="btn-accent save-page" id="savePage">Enregistrer</button>
  `;

  bindGlobal();
  let cover = safeImage(page.cover) || null;
  const preview = document.getElementById('coverPreview');
  const refreshCover = () => {
    preview.style.backgroundImage = cover ? `url("${cover.replace(/"/g, '%22')}")` : '';
    preview.textContent = cover ? '' : 'Ajouter une image de couverture';
  };
  refreshCover();
  document.getElementById('coverBtn').onclick = async () => {
    const image = await pickImage();
    if (image) {
      cover = image;
      refreshCover();
    }
  };
  preview.onclick = document.getElementById('coverBtn').onclick;
  document.getElementById('clearCover').onclick = () => {
    cover = null;
    refreshCover();
  };
  app.querySelectorAll('[data-category-choice]').forEach(button => {
    button.onclick = () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  });

  editor = new Editor({
    element: document.getElementById('editor'),
    content: sanitizeHTML(page.body || ''),
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] } }), Wikilink, WikiRule],
    onUpdate: updateToolbar,
    onSelectionUpdate: updateToolbar
  });

  const commands = {
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    bullet: () => editor.chain().focus().toggleBulletList().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(),
    link: () => openPicker(insertWikilink)
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
    try {
      const now = Date.now();
      const categoryIds = [...app.querySelectorAll('[data-category-choice][aria-pressed="true"]')]
        .map(item => item.dataset.categoryChoice);

      transaction(() => {
        run('UPDATE pages SET title=?,body=?,cover=?,updated_at=?,is_inbox=? WHERE id=?', [
          document.getElementById('pageTitle').value.trim(),
          sanitizeHTML(editor.getHTML()),
          cover,
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
  const pages = q('SELECT id,title FROM pages ORDER BY title COLLATE NOCASE');
  openDialog('Choisir une page', `
    <label class="sr-only" for="pickerSearch">Rechercher une page</label>
    <input class="field" id="pickerSearch" type="search" placeholder="Rechercher une page">
    <div class="picker-list" id="pickerList"></div>
  `, dialog => {
    const input = dialog.querySelector('#pickerSearch');
    const list = dialog.querySelector('#pickerList');
    const draw = () => {
      const filtered = pages.filter(page => normalize(page.title).includes(normalize(input.value)));
      list.innerHTML = filtered.map(page => `<button type="button" class="picker-item" data-pick="${esc(page.id)}">${esc(page.title?.trim() || 'Sans titre')}</button>`).join('') || '<div class="empty">Aucune page.</div>';
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

function screenRead(id) {
  const page = getPage(id);
  if (!page) return goHome();
  const space = page.space_id ? getSpace(page.space_id) : null;
  const categories = getPageCategories(id);
  const backlinks = q('SELECT id,title,body,updated_at,is_pinned FROM pages WHERE id<>? AND body LIKE ?', [id, `%data-wikilink="${id}"%`]);

  app.innerHTML = `
    ${wrapHeader(space, page, globalHeader())}
    <main class="read">
      ${safeImage(page.cover) ? `<img class="page-cover" src="${esc(safeImage(page.cover))}" alt="">` : ''}
      <h1 class="page-title">${esc(page.title?.trim() || 'Sans titre')}</h1>
      ${categories.length ? `<div class="category-chips">${categories.map(category => `<button type="button" class="category-chip" data-category="${esc(category.id)}">${esc(category.name)}</button>`).join('')}</div>` : ''}
      <div class="project-actions read-actions"><button type="button" class="action-link" id="editPage">✎ Modifier</button><button type="button" class="action-link" id="galleryPage">▦ Galerie</button><button type="button" class="action-link" id="duplicatePage">＋ Dupliquer</button><button type="button" class="action-link" id="exportPdf">↓ Export PDF</button><button type="button" class="action-link danger-text" id="deletePage">× Supprimer</button></div>
      <article class="page-body">${sanitizeHTML(page.body || '<p>Page vide.</p>')}</article>
      <div class="sec">Liens entrants</div>${backlinks.map(pageCard).join('') || '<div class="empty">Aucun lien entrant.</div>'}
    </main>
  `;

  bindGlobal();
  document.getElementById('editPage').onclick = () => go('edit', id);
  document.getElementById('galleryPage').onclick = () => go('gallery', id);
  document.getElementById('duplicatePage').onclick = () => duplicatePage(id);
  document.getElementById('deletePage').onclick = () => deletePage(id);
  document.getElementById('exportPdf').onclick = () => exportPagePDF(page, space);
  wirePages();

  app.querySelectorAll('a[data-wikilink]').forEach(link => {
    const target = getPage(link.dataset.wikilink);
    link.textContent = target?.title?.trim() || 'Page supprimée';
    link.classList.toggle('dead', !target);
    link.removeAttribute('href');
    link.onclick = event => {
      event.preventDefault();
      if (target) go('read', target.id);
    };
  });
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
  transaction(() => {
    run('INSERT INTO pages (id,title,body,created_at,updated_at,is_inbox,space_id,template_id,infobox,cover,title_align) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [copyId, `${page.title || 'Sans titre'} (copie)`, page.body || '', now, now, page.space_id ? 0 : 1, page.space_id, page.template_id, page.infobox || '{}', page.cover || null, page.title_align || 'left']);
    getPageCategories(id).forEach(category => run('INSERT INTO page_categories (page_id,category_id) VALUES (?,?)', [copyId, category.id]));
  });
  await saveDB();
  if (navigate) go('read', copyId);
  return copyId;
}

function exportPagePDF(page, space) {
  if (typeof html2pdf === 'undefined') {
    toast('Librairie PDF non chargée.', true);
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
          scale: 2,
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

function deletePage(id) {
  confirmDialog('Supprimer cette page ?', 'La page et sa galerie seront définitivement supprimées.', async () => {
    transaction(() => {
      run('DELETE FROM page_gallery WHERE page_id = ?', [id]);
      run('DELETE FROM page_categories WHERE page_id = ?', [id]);
      run('DELETE FROM pages WHERE id = ?', [id]);
    });
    await saveDB();
    back();
  });
}

function openRecentPageMenu(anchor, id) {
  document.querySelector('.quick-page-menu')?.remove();

  const page = getPage(id);
  if (!page) return;

  const menu = document.createElement('div');
  menu.className = 'more-menu quick-page-menu';
  menu.innerHTML = `
    <button type="button" class="more-menu-item" data-action="rename">Renommer</button>
    <button type="button" class="more-menu-item" data-action="duplicate">Dupliquer</button>
    <button type="button" class="more-menu-item danger" data-action="delete">Supprimer</button>
  `;
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

  menu.querySelector('[data-action="rename"]').onclick = () => {
    close();
    renamePageFromHome(id);
  };

  menu.querySelector('[data-action="duplicate"]').onclick = async event => {
    event.currentTarget.disabled = true;
    try {
      await duplicatePage(id, false);
      close();
      render();
      toast('Page dupliquée.');
    } catch (error) {
      close();
      toast(`Duplication impossible : ${error.message}`, true);
    }
  };

  menu.querySelector('[data-action="delete"]').onclick = () => {
    close();
    deletePageFromHome(id);
  };

  setTimeout(() => {
    outsideListener = event => {
      if (!menu.contains(event.target) && event.target !== anchor) close();
    };
    document.addEventListener('pointerdown', outsideListener, true);
  }, 0);
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
      run('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?', [
        input.value.trim(),
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

function deletePageFromHome(id) {
  confirmDialog('Supprimer cette page ?', 'La page et sa galerie seront définitivement supprimées.', async () => {
    transaction(() => {
      run('DELETE FROM page_gallery WHERE page_id = ?', [id]);
      run('DELETE FROM page_categories WHERE page_id = ?', [id]);
      run('DELETE FROM pages WHERE id = ?', [id]);
    });
    await saveDB();
    render();
    toast('Page supprimée.');
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

function pickImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
        toast('Choisis une image JPEG, PNG ou WebP de moins de 12 Mo.', true);
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
    };
    input.click();
  });
}

function openDialog(title, content, setup) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
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
  openDialog(title, `<p>${esc(message)}</p><div class="confirm-actions"><button type="button" class="cancel" data-cancel>Annuler</button><button type="button" class="danger" data-confirm>Confirmer</button></div>`, dialog => {
    dialog.querySelector('[data-cancel]').onclick = () => dialog.remove();
    dialog.querySelector('[data-confirm]').onclick = async event => {
      event.currentTarget.disabled = true;
      await onConfirm();
      dialog.remove();
    };
  });
}

function openHomeSettings() {
  const initial = getHomeAppearance();

  openDialog('Paramètres de l’accueil', `
    <form id="homeSettingsForm">
      <p class="theme-help">Personnalise uniquement l’accueil général. Les thèmes de chaque projet restent indépendants.</p>

      ${themeColorField('homeHeader', 'Couleur du header', initial.header)}
      ${themeColorField('homeBackground', 'Fond de l’accueil', initial.background)}

      <div class="home-theme-preview" id="homeThemePreview" aria-label="Aperçu de l’accueil">
        <div class="home-theme-preview-head">
          <span class="home-theme-preview-menu">☰</span>
          <strong><span>W</span>iki</strong>
          <span class="home-theme-preview-search">⌕</span>
        </div>
        <div class="home-theme-preview-body">Aperçu de l’accueil</div>
      </div>

      <button type="button" class="btn-ghost theme-reset" id="resetHomeAppearance">Réinitialiser</button>
      <button type="submit" class="btn-accent quick">Enregistrer</button>
    </form>
  `, dialog => {
    const controls = [
      ['homeHeader', 'header'],
      ['homeBackground', 'background']
    ];
    const onHome = stack.at(-1)?.name === 'home';

    const readAppearance = () => Object.fromEntries(controls.map(([id, key]) => [
      key,
      normalizeHex(dialog.querySelector(`#${id}Text`).value)
    ]));

    const updatePreview = () => {
      const appearance = readAppearance();
      if (Object.values(appearance).some(value => !value)) return;

      const preview = dialog.querySelector('#homeThemePreview');
      preview.style.setProperty('--home-preview-header', appearance.header);
      preview.style.setProperty('--home-preview-header-text', contrast(appearance.header));
      preview.style.setProperty('--home-preview-background', appearance.background);
      preview.style.setProperty('--home-preview-background-text', contrast(appearance.background));

      if (onHome) applyHomeAppearance(appearance);
    };

    controls.forEach(([id]) => {
      const picker = dialog.querySelector(`#${id}Picker`);
      const text = dialog.querySelector(`#${id}Text`);

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

    dialog.querySelector('#resetHomeAppearance').onclick = () => {
      const defaults = homeAppearanceDefaults();
      controls.forEach(([id, key]) => {
        dialog.querySelector(`#${id}Picker`).value = defaults[key];
        dialog.querySelector(`#${id}Text`).value = defaults[key];
        dialog.querySelector(`#${id}Text`).setAttribute('aria-invalid', 'false');
      });
      updatePreview();
    };

    dialog.addEventListener('dialog-cancel', applyTheme, { once: true });
    updatePreview();

    dialog.querySelector('#homeSettingsForm').onsubmit = event => {
      event.preventDefault();
      const appearance = readAppearance();

      if (Object.values(appearance).some(value => !value)) {
        return toast('Vérifie les codes couleur. Utilise #RGB ou #RRGGBB.', true);
      }

      localStorage.setItem(HOME_APPEARANCE_KEY, JSON.stringify(appearance));
      dialog.remove();
      render();
      toast('Paramètres de l’accueil enregistrés.');
    };
  });
}

function openGlobalDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.innerHTML = `
    <aside class="drawer">
      <div class="drawer-head">${logoHTML()}<button type="button" class="icon-btn" data-close aria-label="Fermer">X</button></div>
      <nav class="drawer-nav"><button type="button" class="dr-item" data-route="home"><span class="dr-ico">⌂</span>Accueil</button><button type="button" class="dr-item" data-route="inbox"><span class="dr-ico">📥</span>Inbox</button><button type="button" class="dr-item" data-route="templates"><span class="dr-ico">🧩</span>Templates</button></nav>
      <div class="drawer-sep"></div>
      <button type="button" class="dr-item" id="exportDB"><span class="dr-ico">💾</span>Exporter mes données</button>
      <button type="button" class="dr-item" id="importDB"><span class="dr-ico">📂</span>Importer une sauvegarde</button>
      <button type="button" class="dr-item" id="theme"><span class="dr-ico">◐</span>Changer de thème</button>
      <button type="button" class="dr-item" id="settings"><span class="dr-ico dr-ico-settings">⚙︎</span>Paramètres</button>
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
    button.dataset.route === 'home' ? goHome() : go(button.dataset.route);
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
  };
  overlay.querySelector('#settings').onclick = () => {
    close();
    setTimeout(openHomeSettings, 250);
  };
}

function openContextDrawer() {
  const space = currentSpace();
  if (!space) return;
  const categories = getSpaceCategories(space.id);
  const pages = q('SELECT id,title FROM pages WHERE space_id = ? ORDER BY updated_at DESC LIMIT 50', [space.id]);
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
          // La base validée est déjà utilisable en mémoire. On affiche
          // l'accueil avant l'export et l'écriture potentiellement coûteux.
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
  if (editor) {
    editor.destroy();
    editor = null;
  }
  document.querySelectorAll('.overlay, .drawer-overlay, .quick-page-menu').forEach(element => element.remove());
}

function go(name, param = null) {
  stack.push({ name, param });
  history.pushState({ app: true }, '');
  render();
}

function replaceCurrent(name, param = null) {
  stack[stack.length - 1] = { name, param };
  history.replaceState({ app: true }, '');
  render();
}

function back() {
  if (stack.length > 1) history.back();
  else toast('Tu es déjà à l’accueil.');
}

function goHome() {
  stack = [{ name: 'home' }];
  history.replaceState({ app: true }, '');
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
    recent: screenRecent,
    search: screenSearch,
    edit: screenEdit,
    read: screenRead,
    templates: screenTemplates,
    gallery: screenGallery
  };
  app.innerHTML = '<div class="empty">Chargement...</div>';
  (routes[route.name] || screenHome)(route.param);
  window.scrollTo(0, 0);
}

function toast(message, error = false) {
  const element = document.createElement('div');
  element.className = `toast${error ? ' err' : ''}`;
  element.setAttribute('role', error ? 'alert' : 'status');
  element.textContent = message;
  document.body.appendChild(element);
  requestAnimationFrame(() => element.classList.add('show'));
  setTimeout(() => {
    element.classList.remove('show');
    setTimeout(() => element.remove(), 250);
  }, 2400);
}

window.addEventListener('popstate', () => {
  if (stack.length > 1) stack.pop();
  render();
});

document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';

try {
  await initDB();
  history.replaceState({ app: true }, '');
  render();
} catch (error) {
  app.innerHTML = `<div class="empty" role="alert">Erreur : ${esc(error.message || error)}</div>`;
}