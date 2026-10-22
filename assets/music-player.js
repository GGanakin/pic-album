(() => {
  'use strict';

  const tracks = [
    { id: 'there-is-romance', title: '此刻温柔', original: 'There is Romance', mood: '浪漫钢琴', duration: '3:18' },
    { id: 'morning', title: '晨光微风', original: 'Morning', mood: '吉他 · 竖琴 · 长笛', duration: '2:33' },
    { id: 'meditation-impromptu-01', title: '静谧时光', original: 'Meditation Impromptu 01', mood: '轻柔钢琴', duration: '3:33' },
    { id: 'canon-in-d-two-harps', title: '与你的卡农', original: 'Canon in D for Two Harps', mood: '双竖琴', duration: '5:40' },
  ];
  const $ = selector => document.querySelector(selector);
  const audio = $('#bgm-audio');
  const player = $('#music-player');
  const panel = $('#music-panel');
  const playButton = $('#music-play');
  const expandButton = $('#music-expand');
  const volumeInput = $('#music-volume');
  const feedback = $('#music-feedback');
  const storageKey = 'our-little-forever:music:v1';
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Storage is optional. */ }
  let trackIndex = Math.max(0, tracks.findIndex(track => track.id === saved?.track));
  let volume = typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
    ? Math.max(0, Math.min(1, saved.volume)) : .25;
  let wantsPlay = false;
  let hasStarted = false;
  let buffering = false;
  let requestId = 0;

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ track: tracks[trackIndex].id, volume })); }
    catch { /* Music also works in private browsing and local files. */ }
  }

  function render() {
    const playing = !audio.paused && !audio.ended;
    const active = wantsPlay || playing;
    player.classList.toggle('is-playing', playing && !buffering);
    playButton.setAttribute('aria-pressed', String(active));
    playButton.setAttribute('aria-label', active ? '暂停背景音乐' : '播放背景音乐');
    playButton.querySelector('use').setAttribute('href', active ? '#i-pause' : '#i-play');
    $('#music-title').textContent = hasStarted ? tracks[trackIndex].title : '听一段浪漫';
    $('#music-status').textContent = audio.error ? '播放失败 · 点击重试'
      : buffering && active ? '音乐加载中…'
      : playing ? `${tracks[trackIndex].mood} · 正在播放`
      : hasStarted ? '已暂停 · 点击继续' : '轻音乐 · 点击播放';
    document.querySelectorAll('[data-music-track]').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === trackIndex));
    });
  }

  function setPanel(open, restoreFocus = false) {
    panel.hidden = !open;
    expandButton.setAttribute('aria-expanded', String(open));
    expandButton.setAttribute('aria-label', open ? '收起音乐列表' : '展开音乐列表与音量设置');
    if (open) $('#music-close').focus({ preventScroll: true });
    else if (restoreFocus) expandButton.focus({ preventScroll: true });
  }

  function fail(message) {
    wantsPlay = false;
    buffering = false;
    feedback.textContent = message;
    render();
  }

  async function play() {
    const currentRequest = ++requestId;
    hasStarted = true;
    wantsPlay = true;
    buffering = true;
    feedback.textContent = '';
    if (audio.error) audio.load();
    render();
    try {
      await audio.play();
      if (currentRequest !== requestId) return;
      buffering = false;
      render();
    } catch (error) {
      if (currentRequest !== requestId) return;
      fail(error.name === 'NotAllowedError' ? '请点击播放按钮开启音乐。' : '音乐暂时无法播放，请点击重试或切换下一首。');
    }
  }

  function pause() {
    requestId++;
    wantsPlay = false;
    buffering = false;
    audio.pause();
    render();
  }

  function selectTrack(index, startPlaying) {
    pause();
    trackIndex = (index + tracks.length) % tracks.length;
    audio.src = `assets/music/${tracks[trackIndex].id}.mp3`;
    feedback.textContent = '';
    save();
    render();
    if (startPlaying) void play();
  }

  function applyVolume() {
    // iOS may reserve volume control for the device's hardware buttons.
    try { audio.volume = volume; } catch { /* Fall back to device volume. */ }
    const hardwareVolume = Math.abs(audio.volume - volume) > .01;
    audio.muted = !hardwareVolume && volume === 0;
    volumeInput.hidden = hardwareVolume;
    $('#music-volume-value').hidden = hardwareVolume;
    $('#music-volume-hint').hidden = !hardwareVolume;
    volumeInput.value = String(Math.round(volume * 100));
    $('#music-volume-value').textContent = `${Math.round(volume * 100)}%`;
    volumeInput.setAttribute('aria-valuetext', volume === 0 ? '静音' : `${Math.round(volume * 100)}%`);
  }

  $('#music-tracks').innerHTML = tracks.map((track, index) => `<button type="button" class="music-track" data-music-track="${index}" aria-pressed="false"><span class="music-track-number">0${index + 1}</span><span class="music-track-copy"><strong>${track.title}<em>${track.mood}</em></strong><small>${track.original}</small></span><span class="music-track-duration">${track.duration}</span></button>`).join('');
  $('#music-tracks').addEventListener('click', event => {
    const button = event.target.closest('[data-music-track]');
    if (button) selectTrack(Number(button.dataset.musicTrack), true);
  });
  playButton.addEventListener('click', () => wantsPlay || !audio.paused ? pause() : void play());
  $('#music-next').addEventListener('click', () => selectTrack(trackIndex + 1, wantsPlay || !audio.paused));
  expandButton.addEventListener('click', () => setPanel(panel.hidden));
  $('#music-close').addEventListener('click', () => setPanel(false, true));
  volumeInput.addEventListener('input', () => {
    volume = Number(volumeInput.value) / 100;
    applyVolume();
    save();
  });
  player.addEventListener('keydown', event => {
    // Keep the viewer's arrow/space shortcuts away from music controls.
    event.stopPropagation();
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setPanel(false, true);
    }
  });
  $('#lightbox').addEventListener('cancel', event => {
    if (!panel.hidden) { event.preventDefault(); setPanel(false, true); }
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !player.contains(event.target)) setPanel(false);
  });
  audio.addEventListener('playing', () => { wantsPlay = true; buffering = false; render(); });
  audio.addEventListener('pause', () => { wantsPlay = false; buffering = false; render(); });
  audio.addEventListener('waiting', () => { buffering = true; render(); });
  audio.addEventListener('ended', () => selectTrack(trackIndex + 1, true));
  audio.addEventListener('error', () => fail('音乐暂时无法播放，请点击重试或切换下一首。'));
  window.addEventListener('pagehide', pause);

  window.albumMusic = {
    setViewer(open) {
      setPanel(false);
      // Only move the controls. Moving the audio element would interrupt playback.
      $(open ? '#music-viewer-slot' : '#music-home').append(player);
    },
  };
  audio.src = `assets/music/${tracks[trackIndex].id}.mp3`;
  applyVolume();
  setPanel(false);
  render();
  player.hidden = false;
})();
