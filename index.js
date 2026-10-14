"use strict";

const $ = (id) => document.getElementById(id);
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let backgroundGain = null;
let backgroundSource = null;
const backgroundAudio = new Audio();
backgroundAudio.loop = true;
backgroundAudio.preload = "auto";
const useFileAudioFallback = window.location.protocol === "file:";
let backgroundBuffer = null;
let backgroundBufferUrl = null;
let backgroundLoadId = 0;
let isPlaying = false;
let tapTimer = null;
let nextTapAt = 0;
let rightChannel = false;
let timerRemainingMs = 30 * 60_000;
let timerDeadline = null;
let ticker = null;

for (let minutes = 10; minutes <= 600; minutes += 10) {
  const option = document.createElement("option");
  option.value = String(minutes);
  option.textContent = `${minutes}分`;
  if (minutes === 30) option.selected = true;
  $("timer-select").append(option);
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function updateRemaining() {
  if (timerDeadline !== null) timerRemainingMs = Math.max(0, timerDeadline - Date.now());
  $("remaining-time").textContent = timerDeadline !== null || timerRemainingMs > 0 ? formatTime(timerRemainingMs) : "タイマーなし";
  if (timerDeadline !== null && timerRemainingMs <= 0) {
    timerRemainingMs = 0;
    stopPlayback();
    $("remaining-time").textContent = "0:00";
  }
}

function syncTimer() {
  timerDeadline = isPlaying && timerRemainingMs > 0 ? Date.now() + timerRemainingMs : null;
  clearInterval(ticker);
  if (isPlaying && timerRemainingMs > 0) ticker = setInterval(updateRemaining, 250);
  updateRemaining();
}

function stopTapping() {
  clearTimeout(tapTimer);
  tapTimer = null;
}

function updateBackgroundGains() {
  const volume = Number($("background-volume").value) / 1000;
  if (useFileAudioFallback) {
    backgroundAudio.volume = volume;
    return;
  }
  if (!backgroundGain) return;
  // Slider 50% is twice the previously preferred background setting near 10%.
  backgroundGain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.015);
}

async function loadBackgroundBuffer() {
  const url = `resources/${$("background-select").value}`;
  if (backgroundBuffer && backgroundBufferUrl === url) return backgroundBuffer;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`背景音を読み込めませんでした (${response.status})`);
  const decodedBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
  backgroundBuffer = decodedBuffer;
  backgroundBufferUrl = url;
  return decodedBuffer;
}

function stopBackground() {
  backgroundAudio.pause();
  backgroundAudio.currentTime = 0;
  if (!backgroundSource) return;
  backgroundSource.onended = null;
  try { backgroundSource.stop(); } catch {}
  backgroundSource.disconnect();
  backgroundSource = null;
}

function playBackground(buffer) {
  stopBackground();
  if (useFileAudioFallback) return;
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(backgroundGain);
  source.start();
  backgroundSource = source;
}

function stopPlayback() {
  backgroundLoadId++;
  isPlaying = false;
  stopBackground();
  if (audioContext) {
    updateBackgroundGains();
    audioContext.suspend().catch(() => {});
  }
  stopTapping();
  $("play-state").textContent = "停止中";
  $("toggle-play").innerHTML = '<span aria-hidden="true">▶</span> 再生';
  syncTimer();
}

function validFrequency() {
  if (["mokugyo", "solfeggio"].includes($("frequency-preset").value)) {
    $("frequency-error").textContent = "";
    return true;
  }
  const raw = $("frequency-input").value;
  const value = Number(raw);
  const valid = raw.trim() !== "" && /^\d+$/.test(raw) && Number.isInteger(value) && value >= 1 && value <= 880;
  $("frequency-error").textContent = valid ? "" : "周波数は1〜880 Hzの整数で入力してください。音声を停止しました。";
  return valid;
}

function scheduleTap() {
  if (!isPlaying || !audioContext) return;
  const now = audioContext.currentTime;
  if (nextTapAt < now) nextTapAt = now + 0.03;
  const pan = audioContext.createStereoPanner();
  pan.pan.value = rightChannel ? 1 : -1;
  // Slider 50% doubles the previous level, while the gain cap avoids clipping.
  const tappingGain = Math.min(1, Number($("tapping-volume").value) / 100 * 1.6);
  const preset = $("frequency-preset").value;
  const frequencies = preset === "mokugyo"
    ? [155, 177, 402]
    : preset === "solfeggio"
      ? [174, 432, 528]
      : [Number($("frequency-input").value)];
  frequencies.forEach((frequency) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, nextTapAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, tappingGain / frequencies.length), nextTapAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, nextTapAt + 0.11);
    oscillator.connect(gain).connect(pan);
    oscillator.start(nextTapAt);
    oscillator.stop(nextTapAt + 0.12);
  });
  pan.connect(audioContext.destination);
  rightChannel = !rightChannel;
  nextTapAt += 1;
  tapTimer = setTimeout(scheduleTap, Math.max(0, (nextTapAt - audioContext.currentTime - 0.12) * 1000));
}

async function startPlayback() {
  if (!validFrequency()) { stopPlayback(); return; }
  if (!AudioContextClass) {
    $("frequency-error").textContent = "このブラウザでは音声を再生できません。";
    return;
  }
  const loadId = ++backgroundLoadId;
  try {
    audioContext ??= new AudioContextClass();
    await audioContext.resume();
    let buffer = null;
    if (useFileAudioFallback) {
      backgroundAudio.src = `resources/${$("background-select").value}`;
      updateBackgroundGains();
      await backgroundAudio.play();
    } else {
      backgroundGain ??= audioContext.createGain();
      backgroundGain.connect(audioContext.destination);
      buffer = await loadBackgroundBuffer();
      if (loadId !== backgroundLoadId) return;
      updateBackgroundGains();
      playBackground(buffer);
    }
    if (loadId !== backgroundLoadId) {
      stopBackground();
      return;
    }
    isPlaying = true;
    rightChannel = false;
    nextTapAt = audioContext.currentTime + 0.05;
    $("play-state").textContent = "再生中";
    $("toggle-play").innerHTML = '<span aria-hidden="true">■</span> 停止';
    scheduleTap();
    syncTimer();
  } catch (error) {
    if (loadId !== backgroundLoadId) return;
    stopPlayback();
    $("frequency-error").textContent = "音声を開始できませんでした。もう一度お試しください。";
  }
}

$("toggle-play").addEventListener("click", () => isPlaying ? stopPlayback() : startPlayback());
$("background-select").addEventListener("change", async () => {
  backgroundBuffer = null;
  backgroundBufferUrl = null;
  if (!isPlaying) return;
  const loadId = ++backgroundLoadId;
  if (useFileAudioFallback) {
    backgroundAudio.src = `resources/${$("background-select").value}`;
    updateBackgroundGains();
    backgroundAudio.play().catch(() => {
      if (loadId !== backgroundLoadId) return;
      stopPlayback();
      $("frequency-error").textContent = "背景音を読み込めませんでした。もう一度お試しください。";
    });
    return;
  }
  try {
    const buffer = await loadBackgroundBuffer();
    if (!isPlaying || loadId !== backgroundLoadId) return;
    playBackground(buffer);
  } catch {
    if (loadId !== backgroundLoadId) return;
    stopPlayback();
    $("frequency-error").textContent = "背景音を読み込めませんでした。もう一度お試しください。";
  }
});
$("background-volume").addEventListener("input", (event) => {
  updateBackgroundGains();
  $("background-volume-label").textContent = `${event.target.value}%`;
});
$("tapping-volume").addEventListener("input", (event) => $("tapping-volume-label").textContent = `${event.target.value}%`);
$("frequency-preset").addEventListener("change", (event) => {
  const isComposite = ["mokugyo", "solfeggio"].includes(event.target.value);
  $("frequency-input").disabled = isComposite;
  if (event.target.value !== "custom" && !isComposite) $("frequency-input").value = event.target.value;
  if (!validFrequency()) stopPlayback();
});
$("frequency-input").addEventListener("input", () => {
  $("frequency-preset").value = ["40", "174", "432", "528"].includes($("frequency-input").value) ? $("frequency-input").value : "custom";
  if (!validFrequency()) stopPlayback();
});
$("timer-select").addEventListener("change", (event) => { $("timer-input").value = event.target.value; $("timer-error").textContent = ""; });
$("timer-set").addEventListener("click", () => {
  const raw = $("timer-input").value;
  const minutes = Number(raw);
  if (raw.trim() === "" || !/^\d+$/.test(raw) || minutes < 1 || minutes > 600) {
    $("timer-error").textContent = "タイマーは1〜600分の整数で入力してください。";
    return;
  }
  timerRemainingMs = minutes * 60_000;
  $("timer-error").textContent = "";
  syncTimer();
});
$("timer-off").addEventListener("click", () => {
  timerRemainingMs = 0;
  timerDeadline = null;
  clearInterval(ticker);
  $("timer-error").textContent = "";
  $("remaining-time").textContent = "タイマーなし";
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateRemaining(); });
window.addEventListener("pageshow", updateRemaining);
