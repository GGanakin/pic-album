(() => {
  'use strict';

  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scrollBehavior = () => reducedMotion.matches ? 'instant' : 'smooth';
  const data = window.WEDDING_ALBUM;
  if (!data?.photos?.length) {
    $('#gallery-status').textContent = '相册暂时没有打开，请刷新页面重试。';
    return;
  }

  const photoById = new Map(data.photos.map(photo => [photo.id, photo]));
  const collectionById = new Map(data.collections.map(collection => [collection.id, collection]));
  const coverOrder = ['GK6A5834', 'GK6A5964', 'GK6A6124', 'GK6A6057', 'GK6A5753', 'GK6A6184', 'GK6A5880', 'GK6A6014', 'GK6A6103', 'GK6A5790', 'GK6A6083', 'GK6A5947', 'GK6A6174', 'GK6A5830', 'GK6A5952', 'GK6A6045'];
  const coverIds = new Set(coverOrder);
  const photos = [...coverOrder.map(id => photoById.get(id)).filter(Boolean), ...data.photos.filter(photo => !coverIds.has(photo.id))];
  const FAVORITES_KEY = 'our-little-forever:favorites:v1';
  const LAYOUT_KEY = 'our-little-forever:layout:v1';
  const PAGE_SIZE = 12;

  const readStored = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const validFavorites = value => new Set(Array.isArray(value) ? value.filter(id => photoById.has(id)) : []);
  let favorites = validFavorites(readStored(FAVORITES_KEY, []));
  const savedLayout = readStored(LAYOUT_KEY, 'masonry');
  const state = { collection: 'all', favoritesOnly: false, limit: PAGE_SIZE, layout: savedLayout === 'grid' ? 'grid' : 'masonry' };
  const gallery = $('#gallery');
  const dialog = $('#lightbox');
  const viewerImage = $('#lightbox-image');
  const viewport = $('#photo-viewport');
  const toast = $('#toast');
  let masonryFrame = 0;
  let toastTimer;
  let galleryNeedsRender = false;

  function getFilteredPhotos() {
    return photos.filter(photo => (!state.favoritesOnly || favorites.has(photo.id)) && (state.collection === 'all' || photo.collection === state.collection));
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.innerHTML = icon('heart');
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(text);
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function setNavigation(active) {
    $$('[data-nav]').forEach(item => {
      const selected = item.dataset.nav === active;
      item.classList.toggle('is-active', selected);
      if (selected) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }

  function updateFavoriteCount() {
    const count = $('#favorites-count');
    count.textContent = favorites.size;
    count.hidden = favorites.size === 0;
    $('[data-nav="favorites"]').setAttribute('aria-label', `心动收藏，共 ${favorites.size} 张照片`);
  }

  function renderFilters() {
    const base = state.favoritesOnly ? photos.filter(photo => favorites.has(photo.id)) : photos;
    const options = [{ id: 'all', name: '全部瞬间', icon: 'sparkles' }, ...data.collections];
    $('#collection-filters').innerHTML = options.map(collection => {
      const count = collection.id === 'all' ? base.length : base.filter(photo => photo.collection === collection.id).length;
      const active = collection.id === state.collection;
      return `<button type="button" class="filter-button${active ? ' is-active' : ''}" data-collection="${collection.id}" aria-pressed="${active}" aria-label="${collection.name}，${count} 张照片">${icon(collection.icon)}<span>${collection.name}</span><span class="filter-number">${count}</span></button>`;
    }).join('');
  }

  function cardHTML(photo, index) {
    const collection = collectionById.get(photo.collection);
    const favorite = favorites.has(photo.id);
    return `<article class="photo-card" data-photo-id="${photo.id}" style="--photo-ratio:${photo.width / photo.height};--delay:${Math.min(index % PAGE_SIZE, 7) * 35}ms">
      <button class="photo-open" type="button" data-open-photo="${photo.id}" aria-label="放大查看：${escapeHTML(photo.title)}，${collection.name}">
        <img src="${photo.thumb}" alt="${escapeHTML(photo.title)} · ${collection.name}" width="${photo.width}" height="${photo.height}" loading="${index < 4 ? 'eager' : 'lazy'}" decoding="async">
        <span class="photo-hover">${icon('zoom')}靠近这一刻</span>
      </button>
      <div class="card-footer"><div><h3 class="card-title">${escapeHTML(photo.title)}</h3><p class="card-note">${String(photos.indexOf(photo) + 1).padStart(2, '0')}<span>·</span>${collection.name}</p></div>
        <button class="favorite-button${favorite ? ' is-favorite' : ''}" type="button" data-favorite="${photo.id}" aria-label="${favorite ? '取消收藏' : '收藏'}：${escapeHTML(photo.title)}" aria-pressed="${favorite}">${icon('heart')}</button>
      </div>
    </article>`;
  }

  function fitMasonry() {
    masonryFrame = 0;
    if (state.layout !== 'masonry') return;
    const gap = parseFloat(getComputedStyle(gallery).columnGap) || 21;
    $$('.photo-card', gallery).forEach(card => {
      card.style.gridRowEnd = `span ${Math.ceil(card.getBoundingClientRect().height + gap)}`;
    });
  }

  function queueMasonry() {
    if (!masonryFrame) masonryFrame = requestAnimationFrame(fitMasonry);
  }

  function attachImageFallbacks() {
    $$('img:not([data-fallback-ready])', gallery).forEach(img => {
      img.dataset.fallbackReady = 'true';
      img.addEventListener('error', () => {
        const photo = photoById.get(img.closest('[data-photo-id]').dataset.photoId);
        if (!img.dataset.retried) {
          img.dataset.retried = 'true';
          img.src = photo.original;
        } else if (!img.parentElement.querySelector('.image-error-note')) {
          const note = document.createElement('span');
          note.className = 'image-error-note';
          note.textContent = '照片暂未加载，点击重试';
          img.parentElement.append(note);
        }
      });
    });
  }

  function renderGallery({ append = false } = {}) {
    const filtered = getFilteredPhotos();
    const visible = filtered.slice(0, state.limit);
    const oldCount = append ? gallery.children.length : 0;
    gallery.setAttribute('aria-busy', 'true');
    if (append) gallery.insertAdjacentHTML('beforeend', visible.slice(oldCount).map((photo, index) => cardHTML(photo, oldCount + index)).join(''));
    else gallery.innerHTML = visible.map(cardHTML).join('');
    gallery.dataset.layout = state.layout;
    renderFilters();
    setNavigation(state.favoritesOnly ? 'favorites' : 'album');
    $('#gallery-eyebrow').textContent = state.favoritesOnly ? 'A LITTLE COLLECTION OF FAVORITES' : 'THE MOMENTS WE KEEP';
    $('#gallery-heading').innerHTML = `${state.favoritesOnly ? '心动，值得再看一次' : '把心动，慢慢收藏'}<span class="heading-dot">.</span>`;
    const description = state.favoritesOnly
      ? `私藏的 ${filtered.length} 个瞬间，每一张都偏爱`
      : state.collection === 'all'
        ? `${filtered.length} 个瞬间，一辈子的偏爱`
        : `${collectionById.get(state.collection).name} · ${filtered.length} 帧浪漫，与你有关`;
    $('#gallery-status').innerHTML = `<span class="status-dot"></span>${description}`;
    $('#empty-state').hidden = filtered.length > 0;
    $('#gallery-bottom').hidden = filtered.length === 0;
    $('#page-count').textContent = `已翻过 ${visible.length} / ${filtered.length} 个心动瞬间`;
    $('#load-more').hidden = visible.length >= filtered.length;
    $('#album-end').hidden = visible.length < filtered.length;
    if (!filtered.length) {
      $('#empty-state h3').textContent = state.collection !== 'all' && favorites.size ? '这一辑的心动，还等你来收藏' : '把最心动的瞬间，留在这里';
    }
    attachImageFallbacks();
    queueMasonry();
    gallery.setAttribute('aria-busy', 'false');
    if (append) requestAnimationFrame(() => gallery.children[oldCount]?.querySelector('.photo-open').focus({ preventScroll: true }));
  }

  function setLayout(layout) {
    state.layout = layout;
    gallery.dataset.layout = layout;
    $$('.layout-button').forEach(button => {
      const active = button.dataset.layout === layout;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* The layout still works without browser storage. */ }
    queueMasonry();
  }

  function goToAlbum(favoritesOnly = false) {
    state.favoritesOnly = favoritesOnly;
    state.collection = 'all';
    state.limit = PAGE_SIZE;
    renderGallery();
    $('#memories').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }

  function favoriteBurst(button) {
    if (reducedMotion.matches || !button) return;
    const rect = button.getBoundingClientRect();
    const parent = dialog.open ? dialog : document.body;
    for (let i = 0; i < 6; i++) {
      const particle = document.createElement('span');
      particle.className = 'heart-particle';
      particle.textContent = i % 2 ? '♡' : '♥';
      particle.setAttribute('aria-hidden', 'true');
      particle.style.cssText = `left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;font-size:${10 + Math.random() * 8}px;--dx:${(i - 2.5) * 15}px;--dy:${Math.random() * 25}px;--turn:${(i - 2.5) * 15}deg`;
      parent.append(particle);
      particle.addEventListener('animationend', () => particle.remove(), { once: true });
    }
  }

  function updateFavoriteButtons(id) {
    const favorite = favorites.has(id);
    const photo = photoById.get(id);
    $$(`[data-favorite="${id}"]`).forEach(button => {
      button.classList.toggle('is-favorite', favorite);
      button.setAttribute('aria-pressed', String(favorite));
      button.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'}：${photo.title}`);
    });
    if (dialog.open && viewPhotos[viewIndex]?.id === id) syncViewerFavorite();
  }

  function toggleFavorite(id, origin) {
    const adding = !favorites.has(id);
    if (adding) favorites.add(id);
    else favorites.delete(id);
    let saved = true;
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); }
    catch { saved = false; }
    updateFavoriteCount();
    updateFavoriteButtons(id);
    if (adding) favoriteBurst(origin);
    showToast(adding ? (saved ? '把这一份心动，悄悄收藏 ♡' : '已收藏，当前浏览器暂时无法记住收藏') : '已从心动收藏中移出');
    if (state.favoritesOnly) {
      if (dialog.open) galleryNeedsRender = true;
      else {
        const nextId = getFilteredPhotos()[0]?.id;
        renderGallery();
        const nextButton = nextId && $(`[data-favorite="${nextId}"]`);
        (nextButton || $('#gallery-heading')).focus({ preventScroll: true });
      }
    }
    if (origin?.isConnected && adding) {
      origin.classList.add('is-popping');
      setTimeout(() => origin.classList.remove('is-popping'), 450);
    }
  }

  $('#collection-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-collection]');
    if (!button) return;
    state.collection = button.dataset.collection;
    state.limit = PAGE_SIZE;
    renderGallery();
    const replacement = $(`[data-collection="${state.collection}"]`);
    replacement.focus({ preventScroll: true });
    replacement.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'nearest' });
  });
  $$('.layout-button').forEach(button => button.addEventListener('click', () => setLayout(button.dataset.layout)));
  $('#load-more').addEventListener('click', () => { state.limit += PAGE_SIZE; renderGallery({ append: true }); });
  $('#explore-album').addEventListener('click', () => goToAlbum());
  $('[data-nav="album"]').addEventListener('click', event => { event.preventDefault(); goToAlbum(); });
  $('[data-nav="favorites"]').addEventListener('click', () => goToAlbum(true));
  $('[data-nav="story"]').addEventListener('click', () => setNavigation('story'));
  $('.hero-actions > a').addEventListener('click', event => { event.preventDefault(); goToAlbum(); });
  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    state.favoritesOnly = false;
    state.collection = 'all';
    state.limit = PAGE_SIZE;
    renderGallery();
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  });
  gallery.addEventListener('click', event => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) toggleFavorite(favorite.dataset.favorite, favorite);
  });

  let galleryWidth = 0;
  const galleryResize = new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (Math.abs(width - galleryWidth) > .5) { galleryWidth = width; queueMasonry(); }
  });
  galleryResize.observe(gallery);
  document.fonts.ready.then(queueMasonry);

  // The viewer uses the complete current collection, including photos beyond the first page.
  let viewPhotos = [];
  let viewIndex = 0;
  let photoLoadToken = 0;
  let photoLoaded = false;
  let isPlaying = false;
  let slideshowTimer;
  let lastOpener;
  let bodyOverflow = '';
  let bodyPadding = '';
  let zoom = 1;
  const pan = { x: 0, y: 0 };
  const pointers = new Map();
  let gesture = null;
  let pinch = null;
  let wasPinching = false;
  let lastPointerMovement = 0;
  let lastPointerWasBackdrop = false;

  function clearSlideshowTimer() {
    clearTimeout(slideshowTimer);
    slideshowTimer = undefined;
    $('#slideshow-progress').classList.remove('is-playing');
  }

  function scheduleSlide() {
    clearSlideshowTimer();
    if (!isPlaying || !photoLoaded || viewPhotos.length < 2 || !dialog.open) return;
    const progress = $('#slideshow-progress');
    void progress.offsetWidth;
    progress.classList.add('is-playing');
    slideshowTimer = setTimeout(() => navigatePhoto(1, true), 4500);
  }

  function setPlaying(playing) {
    isPlaying = Boolean(playing && viewPhotos.length > 1);
    const button = $('#lightbox-play');
    button.setAttribute('aria-pressed', String(isPlaying));
    button.setAttribute('aria-label', isPlaying ? '暂停自动播放' : '自动播放照片');
    $('use', button).setAttribute('href', isPlaying ? '#i-pause' : '#i-play');
    $('span', button).textContent = isPlaying ? '暂停' : '播放';
    if (isPlaying) scheduleSlide();
    else clearSlideshowTimer();
  }

  function clampPan() {
    const maxX = Math.max(0, (viewerImage.offsetWidth * zoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (viewerImage.offsetHeight * zoom - viewport.clientHeight) / 2);
    pan.x = Math.max(-maxX, Math.min(maxX, pan.x));
    pan.y = Math.max(-maxY, Math.min(maxY, pan.y));
  }

  function applyTransform() {
    clampPan();
    viewerImage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    viewport.classList.toggle('is-zoomed', zoom > 1.01);
    $('#zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
    $('#zoom-out').disabled = zoom <= 1 || !photoLoaded;
    $('#zoom-in').disabled = zoom >= 3 || !photoLoaded;
  }

  function setZoom(value, point) {
    const nextZoom = Math.min(3, Math.max(1, value));
    if (point && nextZoom !== zoom) {
      const rect = viewport.getBoundingClientRect();
      const x = point.x - rect.left - rect.width / 2;
      const y = point.y - rect.top - rect.height / 2;
      pan.x = x - (x - pan.x) * nextZoom / zoom;
      pan.y = y - (y - pan.y) * nextZoom / zoom;
    }
    zoom = nextZoom;
    if (zoom === 1) pan.x = pan.y = 0;
    applyTransform();
  }

  function syncViewerFavorite() {
    const photo = viewPhotos[viewIndex];
    if (!photo) return;
    const active = favorites.has(photo.id);
    const button = $('#lightbox-favorite');
    button.classList.toggle('is-favorite', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? '取消收藏这张照片' : '收藏这张照片');
    $('span', button).textContent = active ? '已收藏' : '收藏';
  }

  function syncFilmstrip() {
    $$('.filmstrip-button').forEach((button, index) => {
      const current = index === viewIndex;
      button.classList.toggle('is-current', current);
      button.setAttribute('aria-pressed', String(current));
    });
    requestAnimationFrame(() => {
      if (dialog.open) $('.filmstrip-button.is-current')?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest', inline: 'center' });
    });
  }

  function showCurrentPhoto() {
    const photo = viewPhotos[viewIndex];
    if (!photo) return;
    const token = ++photoLoadToken;
    const collection = collectionById.get(photo.collection);
    clearSlideshowTimer();
    photoLoaded = false;
    pointers.clear();
    gesture = pinch = null;
    wasPinching = false;
    viewport.classList.remove('is-dragging');
    zoom = 1;
    pan.x = pan.y = 0;
    applyTransform();
    viewerImage.classList.add('is-loading');
    viewerImage.alt = `${photo.title} · ${collection.name}`;
    $('#lightbox-loader').hidden = false;
    $('#lightbox-error').hidden = true;
    $('#lightbox-title').textContent = photo.title;
    $('#lightbox-collection').textContent = `${collection.name} · ${collection.english}`;
    $('#lightbox-count').textContent = `${String(viewIndex + 1).padStart(2, '0')} / ${String(viewPhotos.length).padStart(2, '0')}`;
    $('#lightbox-prev').disabled = $('#lightbox-next').disabled = viewPhotos.length < 2;
    $('#lightbox-play').disabled = viewPhotos.length < 2;
    const download = $('#download-photo');
    download.href = photo.original;
    download.download = photo.original.split('/').at(-1);
    syncViewerFavorite();
    syncFilmstrip();

    const preload = new Image();
    let fallback = false;
    preload.onload = async () => {
      if (token !== photoLoadToken || !dialog.open) return;
      viewerImage.src = preload.src;
      try { await viewerImage.decode(); } catch { /* onerror handles unavailable source images. */ }
      if (token !== photoLoadToken || !dialog.open) return;
      photoLoaded = true;
      viewerImage.classList.remove('is-loading');
      $('#lightbox-loader').hidden = true;
      applyTransform();
      scheduleSlide();
      if (viewPhotos.length > 1) {
        const neighbor = new Image();
        neighbor.src = viewPhotos[(viewIndex + 1) % viewPhotos.length].src;
      }
    };
    preload.onerror = () => {
      if (token !== photoLoadToken || !dialog.open) return;
      if (!fallback) { fallback = true; preload.src = photo.original; return; }
      $('#lightbox-loader').hidden = true;
      $('#lightbox-error').hidden = false;
      setPlaying(false);
    };
    preload.src = photo.src;
  }

  function openViewer(id, sequence = getFilteredPhotos()) {
    if (!photoById.has(id)) return;
    if (!sequence.some(photo => photo.id === id)) sequence = photos;
    viewPhotos = [...sequence];
    viewIndex = Math.max(0, viewPhotos.findIndex(photo => photo.id === id));
    if (!dialog.open) {
      lastOpener = document.activeElement;
      bodyOverflow = document.body.style.overflow;
      bodyPadding = document.body.style.paddingRight;
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbar) document.body.style.paddingRight = `${scrollbar}px`;
      dialog.append(toast);
      dialog.showModal();
      window.albumMusic?.setViewer(true);
      $('#lightbox-close').focus({ preventScroll: true });
    }
    setPlaying(false);
    $('#filmstrip').innerHTML = viewPhotos.map((photo, index) => `<button class="filmstrip-button" type="button" data-view-index="${index}" aria-label="第 ${index + 1} 张：${escapeHTML(photo.title)}" aria-pressed="false"><img src="${photo.thumb}" alt="" loading="lazy" width="43" height="55"></button>`).join('');
    showCurrentPhoto();
  }

  function closeViewer() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    window.albumMusic?.setViewer(false);
    photoLoadToken++;
    setPlaying(false);
    pointers.clear();
    document.body.style.overflow = bodyOverflow;
    document.body.style.paddingRight = bodyPadding;
    document.body.append(toast);
    if (galleryNeedsRender) { renderGallery(); galleryNeedsRender = false; }
    if (lastOpener?.isConnected) lastOpener.focus({ preventScroll: true });
    else $('#gallery-heading').focus({ preventScroll: true });
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeViewer(); });

  function navigatePhoto(direction, automatic = false) {
    if (viewPhotos.length < 2) return;
    if (!automatic) setPlaying(false);
    viewIndex = (viewIndex + direction + viewPhotos.length) % viewPhotos.length;
    showCurrentPhoto();
  }

  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-open-photo]');
    if (opener) openViewer(opener.dataset.openPhoto);
  });
  $('#random-photo').addEventListener('click', () => {
    const sequence = getFilteredPhotos();
    const available = sequence.length ? sequence : photos;
    openViewer(available[Math.floor(Math.random() * available.length)].id, available);
  });
  $('#play-memories').addEventListener('click', () => { openViewer(photos[0].id, photos); setPlaying(true); });
  $('#lightbox-close').addEventListener('click', closeViewer);
  $('#lightbox-prev').addEventListener('click', () => navigatePhoto(-1));
  $('#lightbox-next').addEventListener('click', () => navigatePhoto(1));
  $('#lightbox-play').addEventListener('click', () => setPlaying(!isPlaying));
  $('#lightbox-favorite').addEventListener('click', event => toggleFavorite(viewPhotos[viewIndex].id, event.currentTarget));
  $('#retry-photo').addEventListener('click', showCurrentPhoto);
  $('#zoom-in').addEventListener('click', () => { setPlaying(false); setZoom(zoom + .5); });
  $('#zoom-out').addEventListener('click', () => { setPlaying(false); setZoom(zoom - .5); });
  $('#zoom-reset').addEventListener('click', () => setZoom(1));
  $('#filmstrip').addEventListener('click', event => {
    const button = event.target.closest('[data-view-index]');
    if (!button) return;
    setPlaying(false);
    viewIndex = Number(button.dataset.viewIndex);
    showCurrentPhoto();
  });
  viewport.addEventListener('dblclick', event => {
    if (!photoLoaded || lastPointerWasBackdrop) return;
    setPlaying(false);
    setZoom(zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY });
  });
  viewport.addEventListener('wheel', event => {
    if (!photoLoaded) return;
    event.preventDefault();
    setPlaying(false);
    setZoom(zoom + (event.deltaY < 0 ? .2 : -.2), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  const pointerDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  viewport.addEventListener('pointerdown', event => {
    if (!photoLoaded || event.target.closest('button, a') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      gesture = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      wasPinching = false;
      lastPointerMovement = 0;
      lastPointerWasBackdrop = event.target === viewport;
      if (zoom > 1) { viewport.classList.add('is-dragging'); setPlaying(false); }
    } else if (pointers.size === 2) {
      pinch = { distance: pointerDistance(), zoom };
      wasPinching = true;
      viewport.classList.add('is-dragging');
      setPlaying(false);
    }
  });
  viewport.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      setZoom(pinch.zoom * pointerDistance() / Math.max(1, pinch.distance));
    } else if (pointers.size === 1 && gesture) {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      lastPointerMovement = Math.hypot(dx, dy);
      if (zoom > 1) {
        pan.x = gesture.panX + dx;
        pan.y = gesture.panY + dy;
        applyTransform();
      }
    }
  });
  function finishPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const endedGesture = gesture;
    const hadPinch = wasPinching;
    pointers.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      viewport.classList.remove('is-dragging');
      gesture = pinch = null;
      if (endedGesture && !hadPinch && zoom === 1 && event.type !== 'pointercancel') {
        const dx = event.clientX - endedGesture.x;
        const dy = event.clientY - endedGesture.y;
        lastPointerMovement = Math.hypot(dx, dy);
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) navigatePhoto(dx < 0 ? 1 : -1);
      }
    } else if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      gesture = { x: remaining.x, y: remaining.y, panX: pan.x, panY: pan.y };
      pinch = null;
    }
  }
  viewport.addEventListener('pointerup', finishPointer);
  viewport.addEventListener('pointercancel', finishPointer);
  viewport.addEventListener('click', event => {
    if (event.target === viewport && lastPointerWasBackdrop && zoom === 1 && lastPointerMovement < 8 && !wasPinching) closeViewer();
  });
  new ResizeObserver(() => { if (dialog.open) applyTransform(); }).observe(viewport);

  document.addEventListener('keydown', event => {
    if (!dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'Escape': event.preventDefault(); closeViewer(); break;
      case 'ArrowLeft': event.preventDefault(); navigatePhoto(-1); break;
      case 'ArrowRight': event.preventDefault(); navigatePhoto(1); break;
      case '+': case '=': event.preventDefault(); if (photoLoaded) { setPlaying(false); setZoom(zoom + .5); } break;
      case '-': event.preventDefault(); if (photoLoaded) { setPlaying(false); setZoom(zoom - .5); } break;
      case '0': event.preventDefault(); setZoom(1); break;
      case ' ':
        if (!event.target.closest('button, a')) { event.preventDefault(); setPlaying(!isPlaying); }
        break;
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });

  $('#letter-toggle').addEventListener('click', event => {
    const button = event.currentTarget;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    $('#love-letter').hidden = !open;
    $('span', button).textContent = open ? '把悄悄话收好' : '打开写给彼此的悄悄话';
    if (open) requestAnimationFrame(() => $('#love-letter').scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' }));
  });
  $('#back-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: scrollBehavior() }));
  let scrollFrame = 0;
  window.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      $('#back-to-top').hidden = window.scrollY < 650;
      const isStory = $('#our-story').getBoundingClientRect().top < window.innerHeight * .55;
      setNavigation(isStory ? 'story' : state.favoritesOnly ? 'favorites' : 'album');
    });
  }, { passive: true });

  window.addEventListener('storage', event => {
    if (event.key !== FAVORITES_KEY && event.key !== null) return;
    favorites = validFavorites(readStored(FAVORITES_KEY, []));
    updateFavoriteCount();
    if (state.favoritesOnly) {
      if (dialog.open) galleryNeedsRender = true;
      else renderGallery();
    } else photos.forEach(photo => updateFavoriteButtons(photo.id));
    if (dialog.open) syncViewerFavorite();
  });

  updateFavoriteCount();
  setLayout(state.layout);
  renderGallery();
})();
