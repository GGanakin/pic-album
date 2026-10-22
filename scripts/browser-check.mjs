// Browser integration checks; requires Node 22+ and Google Chrome.
// Start the album with npm run dev, then run: node scripts/browser-check.mjs
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const baseURL = process.env.ALBUM_URL || 'http://127.0.0.1:5173';
const visualOnly = process.argv.includes('--visual');
const musicOnly = process.argv.includes('--music-only');
const browserProfile = await mkdtemp(path.join(tmpdir(), 'pic-qa-'));
const browser = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0',
  `--user-data-dir=${browserProfile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const debuggerURL = await new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => { browser.kill(); reject(new Error('Chrome did not start in 20 seconds')); }, 20000);
  browser.once('error', error => { clearTimeout(timer); reject(error); });
  browser.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited early (${code})`)); });
  browser.stderr.on('data', data => {
    output += data.toString();
    const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
});
const socket = new WebSocket(debuggerURL);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let commandId = 0;
let sessionId;
const pending = new Map();
const errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  } else if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
});
function send(method, params = {}, targetSession = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 25000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(70);
  }
  throw new Error(`Timeout waiting for ${description}`);
}
async function click(selector) {
  const target = JSON.stringify(selector);
  await evaluate(`document.querySelector(${target}).scrollIntoView({block:'center', inline:'nearest', behavior:'instant'})`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const point = await evaluate(`(() => { const el = document.querySelector(${target}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2-visualViewport.offsetLeft, y:r.y+r.height/2-visualViewport.offsetTop, disabled:el.disabled, visible:r.width>0&&r.height>0}; })()`);
  assert.equal(point.visible, true, `${selector} must be visible`);
  assert.ok(!point.disabled, `${selector} must be enabled`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await delay(100);
}
async function key(key, code = key) {
  const keyCodes = { Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39 };
  const virtualKey = keyCodes[key] || 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
  await delay(70);
}
async function loadPage() {
  await send('Page.navigate', { url: baseURL });
  await waitFor('document.readyState === "complete" && document.querySelectorAll(".photo-card").length === 12', 'album startup');
  await evaluate('document.fonts.ready');
  await evaluate(`Promise.all([...document.querySelectorAll('.hero img, .photo-card:nth-child(-n+4) img')].map(img => img.decode()))`);
  await waitFor('getComputedStyle(document.querySelector(".photo-card")).opacity === "1"', 'photo entrance animation');
  await delay(650);
}
async function screenshot(filename, fullPage = false) {
  if (fullPage) {
    await evaluate(`Promise.all([...document.images].filter(img => !img.closest('dialog')).map(img => { img.loading = 'eager'; return img.decode().catch(() => {}); }))`);
  }
  const metrics = await send('Page.getLayoutMetrics');
  const clip = fullPage ? { x: 0, y: 0, width: metrics.cssContentSize.width, height: Math.min(6000, metrics.cssContentSize.height), scale: 1 } : undefined;
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) });
  await writeFile(filename, Buffer.from(result.data, 'base64'));
}
async function check(name, task) {
  await task();
  console.log(`✓ ${name}`);
}
async function waitForPhoto() {
  await waitFor('document.querySelector("#lightbox").open && !document.querySelector("#lightbox-image").classList.contains("is-loading") && document.querySelector("#lightbox-image").naturalWidth > 0', 'full photo');
}
async function noOverflow() {
  assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), true, 'no horizontal page overflow');
}

const context = await send('Target.createBrowserContext', {}, null);
try {
  const target = await send('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }, null);
  ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null));
  await send('Target.activateTarget', { targetId: target.targetId }, null);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await loadPage();
  await screenshot('/tmp/pic-desktop.png');
  await screenshot('/tmp/pic-desktop-full.png', true);

  if (!visualOnly) {
    await check('Music starts only on click, plays real local audio, and serves valid byte ranges', async () => {
      assert.equal(await evaluate('document.querySelector("#bgm-audio").paused'), true);
      assert.equal(await evaluate('document.querySelector("#bgm-audio").volume'), .25);
      const ranges = await evaluate(`(async () => {
        const url = 'assets/music/there-is-romance.mp3';
        const head = await fetch(url, {method:'HEAD'});
        const size = Number(head.headers.get('content-length'));
        const part = await fetch(url, {headers:{Range:'bytes=0-1023'}});
        const suffix = await fetch(url, {headers:{Range:'bytes=-128'}});
        const invalid = await fetch(url, {headers:{Range:'bytes='+size+'-'}});
        return {mime:head.headers.get('content-type'), size, status:part.status, range:part.headers.get('content-range'), bytes:(await part.arrayBuffer()).byteLength, suffixStatus:suffix.status, suffixBytes:(await suffix.arrayBuffer()).byteLength, invalid:invalid.status};
      })()`);
      assert.equal(ranges.mime, 'audio/mpeg');
      assert.ok(ranges.size > 1000000);
      assert.equal(ranges.status, 206);
      assert.equal(ranges.range, `bytes 0-1023/${ranges.size}`);
      assert.equal(ranges.bytes, 1024);
      assert.equal(ranges.suffixStatus, 206);
      assert.equal(ranges.suffixBytes, 128);
      assert.equal(ranges.invalid, 416);
      await click('#music-play');
      await waitFor('document.querySelector("#bgm-audio").currentTime > .2', 'audible music playback');
      assert.equal(await evaluate('document.querySelector("#bgm-audio").muted'), false);
      await click('#music-expand');
      await screenshot('/tmp/pic-music-desktop.png');
      await click('#music-close');
      await click('#music-play');
      assert.equal(await evaluate('document.querySelector("#bgm-audio").paused'), true);
    });
    await check('Every music track decodes, the playlist loops, and rapid controls stay synchronized', async () => {
      await click('#music-expand');
      for (const [index, seconds] of [198, 153, 213, 340].entries()) {
        await click('[data-music-track="'+index+'"]');
        await waitFor('document.querySelector("#bgm-audio").currentTime > .2', 'track '+index+' playback');
        const duration = await evaluate('document.querySelector("#bgm-audio").duration');
        assert.ok(Math.abs(duration - seconds) < 5, `track ${index} has complete duration: ${duration}`);
      }
      await evaluate('document.querySelector("#bgm-audio").currentTime = document.querySelector("#bgm-audio").duration - .15');
      await waitFor('document.querySelector("#bgm-audio").src.endsWith("there-is-romance.mp3") && document.querySelector("#bgm-audio").currentTime > .1', 'playlist wrap');
      await click('#music-close');
      await evaluate('document.querySelector("#music-next").click(); document.querySelector("#music-next").click(); document.querySelector("#music-play").click()');
      await delay(300);
      assert.equal(await evaluate('document.querySelector("#bgm-audio").paused'), true);
      assert.equal(await evaluate('document.querySelector("#music-play").getAttribute("aria-pressed")'), 'false');
    });
    await check('Music survives opening photos; volume keys do not navigate photos; preferences persist', async () => {
      await click('#music-play');
      await waitFor('!document.querySelector("#bgm-audio").paused', 'music resume');
      await click('.photo-open');
      await waitForPhoto();
      assert.equal(await evaluate('document.querySelector("#lightbox").contains(document.querySelector("#music-player"))'), true);
      assert.equal(await evaluate('document.querySelector("#bgm-audio").paused'), false);
      await click('#music-expand');
      const photo = await evaluate('document.querySelector("#lightbox-count").textContent');
      await evaluate('document.querySelector("#music-volume").focus()');
      await key('ArrowRight');
      assert.equal(await evaluate('document.querySelector("#lightbox-count").textContent'), photo);
      await evaluate('document.querySelector("#music-volume").value = 37; document.querySelector("#music-volume").dispatchEvent(new Event("input", {bubbles:true}))');
      assert.equal(await evaluate('document.querySelector("#bgm-audio").volume'), .37);
      await key('Escape');
      assert.equal(await evaluate('document.querySelector("#music-panel").hidden'), true);
      assert.equal(await evaluate('document.querySelector("#lightbox").open'), true);
      await click('#lightbox-close');
      assert.equal(await evaluate('document.querySelector("#bgm-audio").paused'), false);
      await send('Page.reload');
      await waitFor('document.querySelector("#music-player")?.hidden === false', 'music reload');
      assert.equal(await evaluate('document.querySelector("#bgm-audio").paused'), true);
      assert.equal(await evaluate('document.querySelector("#bgm-audio").volume'), .37);
      assert.equal(await evaluate('document.querySelector("#bgm-audio").src.endsWith("meditation-impromptu-01.mp3")'), true);
    });
    await check('Unavailable music shows a recoverable error', async () => {
      await send('Network.enable');
      await send('Network.setCacheDisabled', {cacheDisabled:true});
      await send('Network.setBlockedURLs', {urls:['*meditation-impromptu-01.mp3']});
      await click('#music-play');
      await waitFor('document.querySelector("#music-feedback").textContent.includes("暂时无法播放")', 'music error feedback');
      assert.equal(await evaluate('document.querySelector("#music-play").getAttribute("aria-pressed")'), 'false');
      await send('Network.setBlockedURLs', {urls:[]});
      await click('#music-play');
      await waitFor('document.querySelector("#bgm-audio").currentTime > .1', 'music retry');
      await click('#music-play');
      await send('Network.setCacheDisabled', {cacheDisabled:false});
    });
  }
  if (!visualOnly && !musicOnly) {
    await check('60 photos, all preview and original URLs respond successfully', async () => {
      const result = await evaluate(`(async () => { const photos = window.WEDDING_ALBUM.photos; const failed = []; for (let i=0; i<photos.length; i+=8) { await Promise.all(photos.slice(i,i+8).flatMap(p => [p.thumb,p.src,p.original].map(async url => { if (!(await fetch(url,{method:'HEAD'})).ok) failed.push(url); }))); } return {count:photos.length, failed}; })()`);
      assert.equal(result.count, 60);
      assert.deepEqual(result.failed, []);
    });
    await check('Desktop masonry has no overlaps or horizontal overflow', async () => {
      await noOverflow();
      const overlap = await evaluate(`(() => { const rects = [...document.querySelectorAll('.photo-card')].map(el => el.getBoundingClientRect()); return rects.some((a,i) => rects.some((b,j) => j > i && Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)); })()`);
      assert.equal(overlap, false);
    });
    await check('All four filters show the correct scene and all 60 photos can be revealed', async () => {
      for (const id of ['forest', 'white', 'classic', 'garden']) {
        await click(`[data-collection="${id}"]`);
        const actual = await evaluate(`(() => { const ids = [...document.querySelectorAll('.photo-card')].map(el=>el.dataset.photoId); return ids.every(id=>window.WEDDING_ALBUM.photos.find(p=>p.id===id).collection===${JSON.stringify(id)}); })()`);
        assert.equal(actual, true);
      }
      await click('[data-collection="all"]');
      for (let i = 0; i < 4; i++) await click('#load-more');
      assert.equal(await evaluate('document.querySelectorAll(".photo-card").length'), 60);
      assert.equal(await evaluate('document.querySelector("#load-more").hidden'), true);
    });
    await check('Favorite persistence, filtered favorites, and removing the last favorite in the viewer', async () => {
      await click('[data-nav="album"]');
      await click('.favorite-button');
      assert.equal(await evaluate('document.querySelector("#favorites-count").textContent'), '1');
      await send('Page.reload');
      await waitFor('document.querySelector("#favorites-count")?.textContent === "1"', 'persisted favorite');
      await click('[data-nav="favorites"]');
      assert.equal(await evaluate('document.querySelectorAll(".photo-card").length'), 1);
      await click('.photo-open');
      await waitForPhoto();
      assert.equal(await evaluate('document.querySelector("#lightbox-next").disabled'), true);
      await click('#lightbox-favorite');
      await key('Escape');
      await waitFor('!document.querySelector("#empty-state").hidden', 'favorites view after closing');
      assert.equal(await evaluate('document.querySelector("#empty-state").hidden'), false);
      assert.equal(await evaluate('document.querySelector("#favorites-count").hidden'), true);
      assert.equal(await evaluate('document.activeElement.id'), 'gallery-heading');
      await click('#explore-album');
    });
    await check('Layout preference persists after reload', async () => {
      await click('[data-layout="grid"].layout-button');
      await send('Page.reload');
      await waitFor('document.querySelector("#gallery")?.dataset.layout === "grid"', 'saved grid layout');
      await click('[data-layout="masonry"].layout-button');
    });
    await check('Viewer keyboard navigation, zoom, drag, double-click, download, and focus restoration', async () => {
      await click('.photo-open');
      await waitForPhoto();
      const firstTitle = await evaluate('document.querySelector("#lightbox-title").textContent');
      await key('ArrowRight');
      await waitForPhoto();
      assert.notEqual(await evaluate('document.querySelector("#lightbox-title").textContent'), firstTitle);
      await key('ArrowLeft');
      await waitForPhoto();
      assert.equal(await evaluate('document.querySelector("#lightbox-title").textContent'), firstTitle);
      await click('#zoom-in');
      await click('#zoom-in');
      assert.equal(await evaluate('document.querySelector("#zoom-reset").textContent'), '200%');
      const center = await evaluate(`(() => {const r = document.querySelector('#photo-viewport').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...center, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y + 65, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y + 65, button: 'left', clickCount: 1 });
      assert.ok(await evaluate('Math.abs(new DOMMatrix(getComputedStyle(document.querySelector("#lightbox-image")).transform).m42)>10'));
      await click('#zoom-reset');
      for (const count of [1, 2]) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...center, button: 'left', clickCount: count });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...center, button: 'left', clickCount: count });
      }
      await delay(250);
      assert.equal(await evaluate('document.querySelector("#lightbox").open'), true);
      assert.equal(await evaluate('document.querySelector("#zoom-reset").textContent'), '200%');
      await click('#zoom-reset');
      assert.equal(await evaluate('document.querySelector("#download-photo").download.endsWith(".jpg")'), true);
      await screenshot('/tmp/pic-viewer.png');
      await key('Escape');
      await waitFor('document.body.style.overflow === ""', 'viewer cleanup');
      assert.equal(await evaluate('document.querySelector("#lightbox").open'), false);
      assert.equal(await evaluate('document.activeElement.classList.contains("photo-open")'), true);
      assert.equal(await evaluate('document.body.style.overflow'), '');
    });
    await check('Slideshow advances and pauses on manual navigation', async () => {
      await click('#play-memories');
      await waitForPhoto();
      const first = await evaluate('document.querySelector("#lightbox-count").textContent');
      await waitFor(`document.querySelector('#lightbox-count').textContent !== ${JSON.stringify(first)}`, 'slideshow advance', 8000);
      await click('#lightbox-next');
      assert.equal(await evaluate('document.querySelector("#lightbox-play").getAttribute("aria-pressed")'), 'false');
      await key('Escape');
    });
    await check('Letter expands and collapses', async () => {
      await click('#letter-toggle');
      assert.equal(await evaluate('document.querySelector("#love-letter").hidden'), false);
      await click('#letter-toggle');
      assert.equal(await evaluate('document.querySelector("#love-letter").hidden'), true);
    });
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await loadPage();
  await screenshot('/tmp/pic-mobile.png');
  await screenshot('/tmp/pic-mobile-full.png', true);
  await evaluate('document.querySelector("#memories").scrollIntoView({behavior:"instant",block:"start"})');
  await delay(250);
  await screenshot('/tmp/pic-mobile-gallery.png');

  if (!visualOnly) {
    await check('Mobile music panel fits the screen and remains available in the viewer', async () => {
      await click('#music-expand');
      await waitFor('!document.querySelector("#music-panel").hidden', 'mobile music panel');
      await screenshot('/tmp/pic-music-mobile.png');
      for (const width of [390, 320]) {
        await send('Emulation.setDeviceMetricsOverride', {width, height:844, deviceScaleFactor:1, mobile:true});
        await noOverflow();
        assert.equal(await evaluate('(() => {const r=document.querySelector("#music-panel").getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()'), true);
      }
      await click('#music-close');
      await click('.photo-open');
      await waitForPhoto();
      await click('#music-expand');
      await screenshot('/tmp/pic-music-mobile-viewer.png');
      assert.equal(await evaluate('(() => {const r=document.querySelector("#music-panel").getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0;})()'), true);
      await click('#music-close');
      await click('#lightbox-close');
      await send('Emulation.setDeviceMetricsOverride', {width:390, height:844, deviceScaleFactor:1, mobile:true});
    });
    await check('Mobile has two columns and no horizontal overflow', async () => {
      await noOverflow();
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#gallery")).gridTemplateColumns.split(" ").length'), 2);
    });
    await check('Mobile swipe, pinch zoom, and modal focus containment', async () => {
      await click('.photo-open');
      await waitForPhoto();
      const first = await evaluate('document.querySelector("#lightbox-count").textContent');
      const center = await evaluate(`(() => {const r = document.querySelector('#photo-viewport').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x + 65, y: center.y, id: 1 }] });
      for (let offset = 35; offset >= -65; offset -= 25) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + offset, y: center.y, id: 1 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await delay(200);
      assert.equal(await evaluate('document.querySelector("#lightbox").open'), true);
      assert.notEqual(await evaluate('document.querySelector("#lightbox-count").textContent'), first);
      await waitForPhoto();
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 35, y: center.y, id: 2 }, { x: center.x + 35, y: center.y, id: 3 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - 75, y: center.y, id: 2 }, { x: center.x + 75, y: center.y, id: 3 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok(await evaluate('parseInt(document.querySelector("#zoom-reset").textContent)>150'));
      await click('#zoom-reset');
      await screenshot('/tmp/pic-mobile-viewer.png');
      for (let i = 0; i < 12; i++) {
        await key('Tab');
        assert.equal(await evaluate('document.querySelector("#lightbox").contains(document.activeElement)'), true);
      }
      await click('#lightbox-close');
    });
    await check('Reduced-motion mode and 320px / 768px responsive layouts', async () => {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await click('.favorite-button');
      assert.equal(await evaluate('document.querySelectorAll(".heart-particle").length'), 0);
      for (const width of [320, 768]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 760 });
        await delay(200);
        await noOverflow();
      }
    });
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log('All browser checks passed. Screenshots saved to /tmp/pic-*.png');
  } else console.log('Desktop and mobile screenshots saved to /tmp/pic-*.png');
} catch (error) {
  try { await screenshot('/tmp/pic-check-failure.png'); } catch { /* Preserve the original assertion. */ }
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await send('Target.disposeBrowserContext', { browserContextId: context.browserContextId }, null);
  socket.close();
  browser.kill('SIGTERM');
  await new Promise(resolve => { browser.once('exit', resolve); setTimeout(resolve, 1500); });
  await rm(browserProfile, { recursive: true, force: true }).catch(() => {});
}
