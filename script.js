(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const photos = window.ARCHIVE_PHOTOS || [];
  const byId = new Map(photos.map((p) => [p.id, p]));
  const galleryIds = photos.filter((p) => p.folder === 'photos').map((p) => p.id);
  const homeIds = photos.filter((p) => p.folder === 'home-photos').map((p) => p.id);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const deployment = window.ARCHIVE_DEPLOYMENT || {};
  const siteKey = new URL('.', location.href).pathname;
  const DRAFT_KEY = 'my-archive.draft.v1:' + siteKey;
  const THEME_KEY = 'my-archive.theme.v1';
  const defaults = clone(window.ARCHIVE_CONFIG);
  let published = clone(defaults), state = clone(defaults), revision = 0, draftBase = 0;
  let online = false, ready = false, dirty = false, draftSaved = true, viewOverride = null;
  let editorPage = 0, library = 'photos', visibleIds = [], lightboxIds = [], activeIndex = 0, draggedId = null;
  let toastTimer, searchTimer, resizeFrame;
  const pageSize = 36;
  function storageRead(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function notify(message) {
    clearTimeout(toastTimer);
    const toast = $('toast');
    ($('editor').open ? $('editor') : document.body).append(toast);
    toast.textContent = message; toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }
  function normalize(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.order)) throw new Error('配置格式不正确');
    const order = [...new Set(value.order.filter((id) => galleryIds.includes(id)))];
    galleryIds.forEach((id) => { if (!order.includes(id)) order.push(id); });
    const result = { ...defaults, order };
    result.featured = Array.isArray(value.featured) ? [...new Set(value.featured.filter((id) => byId.has(id)))].slice(0, 3) : defaults.featured;
    if (['masonry', 'grid', 'list'].includes(value.layout)) result.layout = value.layout;
    if (Number.isInteger(value.columns) && value.columns >= 2 && value.columns <= 6) result.columns = value.columns;
    if (Number.isInteger(value.gap) && value.gap >= 8 && value.gap <= 40) result.gap = value.gap;
    result.captions = typeof value.captions === 'boolean' ? value.captions : defaults.captions;
    for (const [key, max] of Object.entries({ title: 40, subtitle: 40, description: 300, about: 600 })) {
      if (typeof value[key] === 'string') result[key] = value[key].slice(0, max);
    }
    return result;
  }
  function source(id) {
    const path = 'assets/' + id.split('/').map(encodeURIComponent).join('/');
    const base = (deployment.assetBaseUrl || '').replace(/\/+$/, '');
    return base ? base + '/' + path : path;
  }
  function makeImage(id, eager = false) {
    const photo = byId.get(id), img = document.createElement('img');
    img.src = source(id); img.alt = photo.file; img.width = photo.width; img.height = photo.height;
    img.loading = eager ? 'eager' : 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => img.parentElement?.classList.add('load-error'));
    img.addEventListener('load', () => img.parentElement?.classList.remove('load-error'));
    return img;
  }
  function saveDraft() {
    if (!dirty) draftBase = revision;
    dirty = true; draftSaved = true;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ config: state, baseRevision: draftBase })); }
    catch { draftSaved = false; notify('浏览器无法保存草稿，请导出配置，避免关闭后丢失。'); }
    $('draftStatus').textContent = draftSaved ? '草稿已保存在此浏览器。发布后，所有访客都能看到修改。' : '草稿仅在当前页面中，请导出配置保存。';
    $('draftBanner').hidden = false;
  }
  function renderHero() {
    $('heroImages').replaceChildren();
    state.featured.forEach((id, index) => {
      const figure = document.createElement('figure'); figure.className = 'hero-card';
      const button = document.createElement('button'); button.setAttribute('aria-label', '查看精选照片 ' + byId.get(id).file);
      button.append(makeImage(id, true)); button.addEventListener('click', () => openLightbox(state.featured, id));
      const caption = document.createElement('figcaption');
      const label = document.createElement('span'); label.textContent = String(index + 1).padStart(2, '0') + ' / SELECTED MOMENT';
      const arrow = document.createElement('span'); arrow.textContent = '↗'; caption.append(label, arrow); figure.append(button, caption); $('heroImages').append(figure);
    });
  }
  function renderPage() {
    $('titleText').textContent = state.title; $('subtitleText').textContent = state.subtitle;
    $('heroDescription').textContent = state.description; $('aboutText').textContent = state.about;
    document.title = 'MY ARCHIVE — ' + state.title + ' ' + state.subtitle;
    $('navCount').textContent = state.order.length;
    renderHero(); renderGallery(); $('draftBanner').hidden = !dirty;
  }
  function renderGallery() {
    const query = $('searchInput').value.trim().toLowerCase();
    visibleIds = state.order.filter((id) => byId.get(id).file.toLowerCase().includes(query));
    const grid = $('galleryGrid'), fragment = document.createDocumentFragment();
    grid.replaceChildren(); grid.dataset.layout = viewOverride || state.layout;
    grid.classList.toggle('no-captions', !state.captions);
    $('imageCount').textContent = query ? `${visibleIds.length} / ${state.order.length} 张照片` : `${state.order.length} 张照片 / ORIGINAL FRAMES`;
    $('emptyState').hidden = visibleIds.length > 0;
    document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === grid.dataset.layout)));
    visibleIds.forEach((id, index) => {
      const figure = document.createElement('figure'); figure.className = 'gallery-item'; figure.dataset.id = id;
      const button = document.createElement('button'); button.className = 'photo-button'; button.setAttribute('aria-label', '查看照片 ' + byId.get(id).file);
      button.append(makeImage(id)); button.addEventListener('click', () => openLightbox(visibleIds, id));
      const caption = document.createElement('figcaption'), name = document.createElement('span'), count = document.createElement('span');
      name.textContent = byId.get(id).file; count.textContent = String(index + 1).padStart(3, '0'); caption.append(name, count);
      figure.append(button, caption); fragment.append(figure);
    });
    grid.append(fragment); arrangeGallery();
  }
  function arrangeGallery() {
    const grid = $('galleryGrid'), width = grid.clientWidth;
    if (!width) return;
    const cols = innerWidth <= 620 ? 2 : innerWidth <= 1000 ? Math.min(state.columns, 3) : state.columns;
    const gap = innerWidth <= 620 ? Math.min(state.gap, 16) : state.gap;
    grid.style.setProperty('--cols', cols); grid.style.setProperty('--gap', gap + 'px');
    if (grid.dataset.layout !== 'masonry') { grid.style.height = ''; grid.querySelectorAll('.gallery-item').forEach((el) => { el.style.cssText = ''; }); return; }
    const colWidth = (width - gap * (cols - 1)) / cols, heights = Array(cols).fill(0);
    [...grid.children].forEach((el) => {
      const photo = byId.get(el.dataset.id), column = heights.indexOf(Math.min(...heights));
      el.style.width = colWidth + 'px'; el.style.transform = `translate(${column * (colWidth + gap)}px,${heights[column]}px)`;
      heights[column] += colWidth * photo.height / photo.width + (state.captions ? 29 : 0) + gap;
    });
    grid.style.height = Math.max(0, Math.max(...heights) - gap) + 'px';
  }
  function openLightbox(ids, id) {
    lightboxIds = ids.slice(); activeIndex = lightboxIds.indexOf(id); showLightbox();
    if (!$('lightbox').open) $('lightbox').showModal();
  }
  function showLightbox() {
    const id = lightboxIds[activeIndex], p = byId.get(id); if (!p) return;
    $('lightboxError').hidden = true;
    $('lightboxImage').src = source(id); $('lightboxImage').alt = p.file;
    $('lightboxTitle').textContent = `${p.file} · ${p.width} × ${p.height} px`;
    $('lightboxCount').textContent = `${String(activeIndex + 1).padStart(3, '0')} / ${String(lightboxIds.length).padStart(3, '0')}`;
    $('originalLink').href = source(id);
    $('lightboxPrev').disabled = $('lightboxNext').disabled = lightboxIds.length < 2;
  }
  function moveLightbox(step) { activeIndex = (activeIndex + step + lightboxIds.length) % lightboxIds.length; showLightbox(); }
  $('lightboxImage').addEventListener('error', () => { $('lightboxError').hidden = false; });
  $('lightboxClose').onclick = () => $('lightbox').close();
  $('lightboxPrev').onclick = () => moveLightbox(-1); $('lightboxNext').onclick = () => moveLightbox(1);
  $('lightbox').addEventListener('click', (event) => { if (event.target === $('lightbox') || event.target.tagName === 'FIGURE') $('lightbox').close(); });
  document.addEventListener('keydown', (event) => {
    if (!$('lightbox').open) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveLightbox(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveLightbox(1); }
  });
  let touchStart;
  $('lightboxImage').addEventListener('touchstart', (e) => { touchStart = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  $('lightboxImage').addEventListener('touchend', (e) => { if (!touchStart || !e.changedTouches.length) return; const dx = e.changedTouches[0].clientX - touchStart[0], dy = e.changedTouches[0].clientY - touchStart[1]; if (Math.abs(dx) > 65 && Math.abs(dy) < 45) moveLightbox(dx > 0 ? -1 : 1); touchStart = null; }, { passive: true });
  $('searchInput').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderGallery, 150); };
  document.querySelectorAll('[data-view]').forEach((button) => { button.onclick = () => { viewOverride = button.dataset.view; renderGallery(); }; });
  if (storageRead(THEME_KEY) === 'light') document.body.classList.add('is-light');
  $('themeToggle').onclick = () => { const light = document.body.classList.toggle('is-light'); try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch { /* Theme still works for this page. */ } };
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(arrangeGallery); }).observe($('galleryGrid'));
  function syncEditor() {
    for (const key of ['Title', 'Subtitle', 'Description', 'About', 'Layout', 'Columns', 'Gap']) $('edit' + key).value = state[key[0].toLowerCase() + key.slice(1)];
    $('editCaptions').checked = state.captions; $('columnOutput').value = state.columns; $('gapOutput').value = state.gap + ' px';
    $('draftStatus').textContent = dirty ? (draftSaved ? '已恢复此浏览器中的草稿，尚未发布。' : '草稿仅在当前页面中，请导出配置保存。') : '调整后自动保存本地草稿；发布后，所有访客都能看到修改。';
    renderFeatured(); renderEditorGrid(); updateConnection();
  }
  function updateConnection() {
    $('connectionStatus').textContent = !ready ? '正在检测在线保存服务…' : online ? '已连接在线服务。输入管理密码即可发布。' : '当前为本地 / 静态模式。导出 site-config.js，替换网站同名文件并重新上传，即可更新公开页面。';
    $('passwordLabel').hidden = $('publishButton').hidden = !online;
  }
  function openEditor() { syncEditor(); $('editor').showModal(); }
  function closeEditor() { $('editor').close(); }
  $('editOpen').onclick = $('resumeEdit').onclick = openEditor;
  $('editClose').onclick = $('previewButton').onclick = closeEditor;
  $('editor').addEventListener('close', () => { $('adminPassword').value = ''; viewOverride = null; renderPage(); document.body.append($('toast')); });
  for (const key of ['Title', 'Subtitle', 'Description', 'About', 'Layout', 'Columns', 'Gap']) {
    $('edit' + key).addEventListener('input', (event) => {
      state[key[0].toLowerCase() + key.slice(1)] = ['Columns', 'Gap'].includes(key) ? Number(event.target.value) : event.target.value;
      $('columnOutput').value = state.columns; $('gapOutput').value = state.gap + ' px'; saveDraft();
    });
  }
  $('editCaptions').onchange = (e) => { state.captions = e.target.checked; saveDraft(); };
  function renderFeatured() {
    $('featuredList').replaceChildren();
    state.featured.forEach((id, index) => {
      const row = document.createElement('div'); row.className = 'featured-row';
      const label = document.createElement('span'); label.textContent = `${index + 1}. ${byId.get(id).file}`;
      const move = document.createElement('button'); move.textContent = '↑'; move.title = '精选前移'; move.setAttribute('aria-label', byId.get(id).file + ' 精选前移'); move.disabled = index === 0;
      move.onclick = () => { [state.featured[index - 1], state.featured[index]] = [state.featured[index], state.featured[index - 1]]; saveDraft(); renderFeatured(); };
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', '移除精选 ' + byId.get(id).file);
      remove.onclick = () => { state.featured.splice(index, 1); saveDraft(); renderFeatured(); renderEditorGrid(); };
      row.append(makeImage(id), label, move, remove); $('featuredList').append(row);
    });
    if (!state.featured.length) { const text = document.createElement('p'); text.className = 'help'; text.textContent = '还没有精选照片，点击照片上的 ☆ 添加。'; $('featuredList').append(text); }
  }
  function toggleFeatured(id) {
    if (state.featured.includes(id)) state.featured = state.featured.filter((item) => item !== id);
    else if (state.featured.length < 3) state.featured.push(id);
    else { notify('首页已有 3 张精选，请先移除一张再添加。'); return; }
    saveDraft(); renderFeatured(); renderEditorGrid();
  }
  function movePhoto(id, target) {
    const index = state.order.indexOf(id); if (index < 0) return;
    const position = Math.max(0, Math.min(state.order.length - 1, target)); if (position === index) return;
    state.order.splice(index, 1); state.order.splice(position, 0, id); saveDraft(); renderEditorGrid();
  }
  function renderEditorGrid() {
    const query = $('editSearch').value.trim().toLowerCase(), ids = (library === 'photos' ? state.order : homeIds).filter((id) => byId.get(id).file.toLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(ids.length / pageSize)); editorPage = Math.min(editorPage, pages - 1);
    $('editCount').textContent = ids.length + ' 张'; $('pageInfo').textContent = `${editorPage + 1} / ${pages}`;
    $('pagePrev').disabled = editorPage === 0; $('pageNext').disabled = editorPage === pages - 1;
    $('showCollection').setAttribute('aria-pressed', String(library === 'photos')); $('showHome').setAttribute('aria-pressed', String(library === 'home'));
    const grid = $('editGrid'); grid.replaceChildren();
    ids.slice(editorPage * pageSize, (editorPage + 1) * pageSize).forEach((id) => {
      const p = byId.get(id), index = state.order.indexOf(id), card = document.createElement('article');
      card.className = 'edit-card'; card.dataset.id = id; card.draggable = index >= 0;
      const thumb = document.createElement('div'); thumb.className = 'edit-thumbnail'; thumb.append(makeImage(id));
      const badge = document.createElement('span'); badge.className = 'edit-index'; badge.textContent = index >= 0 ? String(index + 1).padStart(3, '0') + ' ⠿' : '首页备选'; thumb.append(badge);
      const info = document.createElement('div'); info.className = 'edit-card-info'; const name = document.createElement('p'); name.className = 'edit-name'; name.textContent = p.file; name.title = p.file;
      const actions = document.createElement('div'); actions.className = 'edit-actions';
      const action = (label, title, handler, disabled = false) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.setAttribute('aria-label', title + ' ' + p.file); b.onclick = handler; b.disabled = disabled; return b; };
      if (index >= 0) actions.append(action('← 前移', '前移', () => movePhoto(id, index - 1), index === 0), action('后移 →', '后移', () => movePhoto(id, index + 1), index === state.order.length - 1));
      const star = action(state.featured.includes(id) ? '★' : '☆', '设置首页精选', () => toggleFeatured(id)); star.classList.toggle('featured', state.featured.includes(id)); star.setAttribute('aria-pressed', String(state.featured.includes(id))); actions.append(star);
      info.append(name, actions);
      if (index >= 0) {
        const position = document.createElement('div'); position.className = 'position-control'; position.append('到第');
        const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = String(state.order.length); input.value = index + 1; input.setAttribute('aria-label', p.file + ' 目标位置');
        const move = action('移动', '移动到指定位置', () => { const n = Number(input.value); if (!Number.isInteger(n) || n < 1 || n > state.order.length) return notify(`请输入 1—${state.order.length} 之间的位置。`); movePhoto(id, n - 1); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') move.click(); }); position.append(input, '张', move); info.append(position);
      }
      card.append(thumb, info); grid.append(card);
    });
    if (!ids.length) { const p = document.createElement('p'); p.className = 'help'; p.textContent = '没有找到匹配的照片。'; grid.append(p); }
  }
  $('editGrid').addEventListener('dragstart', (e) => {
    if (e.target.closest('button,input')) { e.preventDefault(); return; }
    const card = e.target.closest('.edit-card'); if (!card || library !== 'photos') return;
    draggedId = card.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', draggedId); card.classList.add('is-dragging');
  });
  $('editGrid').addEventListener('dragover', (e) => { const card = e.target.closest('.edit-card'); if (draggedId && card && card.dataset.id !== draggedId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('drag-over'); } });
  $('editGrid').addEventListener('dragleave', (e) => { const card = e.target.closest('.edit-card'); if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over'); });
  $('editGrid').addEventListener('drop', (e) => { e.preventDefault(); const card = e.target.closest('.edit-card'); if (draggedId && card && draggedId !== card.dataset.id) movePhoto(draggedId, state.order.indexOf(card.dataset.id)); draggedId = null; });
  $('editGrid').addEventListener('dragend', () => { draggedId = null; $('editGrid').querySelectorAll('.drag-over,.is-dragging').forEach((el) => el.classList.remove('drag-over', 'is-dragging')); });
  $('editSearch').oninput = () => { editorPage = 0; renderEditorGrid(); };
  $('showCollection').onclick = () => { library = 'photos'; editorPage = 0; renderEditorGrid(); };
  $('showHome').onclick = () => { library = 'home'; editorPage = 0; renderEditorGrid(); };
  function changePage(delta) { editorPage += delta; renderEditorGrid(); $('editGrid').scrollIntoView({ block: 'start' }); }
  $('pagePrev').onclick = () => changePage(-1); $('pageNext').onclick = () => changePage(1);
  $('exportButton').onclick = () => {
    if (state.featured.length !== 3) return notify('请先选好 3 张首页精选照片。');
    const content = 'window.ARCHIVE_CONFIG = ' + JSON.stringify(state, null, 2) + ';\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'application/javascript;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'site-config.js'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify('已导出配置。替换网站 site-config.js 并重新上传即可生效。');
  };
  $('importButton').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 200000) throw new Error('配置文件过大');
      let text = (await file.text()).trim();
      if (text.startsWith('window.ARCHIVE_CONFIG')) text = text.replace(/^window\.ARCHIVE_CONFIG\s*=\s*/, '').replace(/;\s*$/, '');
      const next = normalize(JSON.parse(text));
      if (next.featured.length !== 3) throw new Error('配置需要包含 3 张有效的精选照片');
      state = next; saveDraft(); syncEditor(); notify('配置已导入本地草稿，尚未发布。');
    } catch (error) { notify('导入失败：' + error.message); }
    e.target.value = '';
  };
  $('resetButton').onclick = () => {
    if (!confirm('放弃此浏览器中的草稿，恢复为已发布的版本？')) return;
    state = clone(published); dirty = false; viewOverride = null; draftBase = revision;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* Current state is still restored. */ }
    $('draftBanner').hidden = true; syncEditor(); notify('已恢复已发布版本。');
  };
  $('publishButton').onclick = async () => {
    if (state.featured.length !== 3) return notify('发布前，请选好 3 张首页精选照片。');
    const password = $('adminPassword').value; if (!password) { $('adminPassword').focus(); return notify('请输入网站管理密码。'); }
    const button = $('publishButton'); button.disabled = true; button.textContent = '正在发布…';
    const snapshot = clone(state), base = dirty ? draftBase : revision;
    try {
      const response = await fetch(new URL('api/config', new URL('.', location.href)), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + password }, body: JSON.stringify({ config: snapshot, revision: base }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (response.status === 409) throw new Error('网站已在别处更新。请先导出草稿备份，再刷新页面、恢复已发布版本后重新编辑。');
      if (!response.ok) throw new Error(result.error || '发布失败，请稍后重试');
      published = snapshot; revision = result.revision;
      if (JSON.stringify(state) === JSON.stringify(snapshot)) {
        dirty = false; draftBase = revision; try { localStorage.removeItem(DRAFT_KEY); } catch { /* Publication itself succeeded. */ }
        $('draftBanner').hidden = true; $('draftStatus').textContent = '已成功发布，所有访客都能看到这个版本。';
      } else { draftBase = revision; saveDraft(); }
      $('adminPassword').value = ''; notify('发布成功，公开网站已更新。');
    } catch (error) { notify(error.name === 'TimeoutError' ? '发布请求超时，请刷新检查网站版本；本地草稿仍保留。' : error.message); }
    finally { button.disabled = false; button.textContent = '发布到网站 ↗'; }
  };
  async function init() {
    renderPage();
    if (location.protocol !== 'file:' && deployment.enableApi !== false) {
      try {
        const response = await fetch(new URL('api/config', new URL('.', location.href)), { cache: 'no-store', signal: AbortSignal.timeout(7000) });
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const result = await response.json();
          if (result.service === 'my-archive' && Number.isInteger(result.revision)) { published = normalize(result.config); revision = result.revision; online = result.editable === true; }
        }
      } catch { /* Plain static hosting and offline use keep the bundled configuration. */ }
    }
    ready = true;
    if (!dirty) {
      state = clone(published); draftBase = revision;
      try {
        const draft = JSON.parse(storageRead(DRAFT_KEY));
        if (draft?.config) { state = normalize(draft.config); draftBase = Number.isInteger(draft.baseRevision) ? draft.baseRevision : 0; dirty = true; }
      } catch { notify('旧草稿无法读取，已加载网站版本。'); }
      renderPage();
    }
    updateConnection(); if ($('editor').open) syncEditor();
  }
  init();
})();
