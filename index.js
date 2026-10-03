"use strict";

const $ = (id) => document.getElementById(id);
const backgrounds = [new Audio(), new Audio()];
backgrounds.forEach((audio) => { audio.preload = "auto"; });
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let activeBackground = 0;
let backgroundWeights = [1, 0];
let crossfading = false;
const CROSSFADE_SECONDS = 0.35;
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
  const volume = Number($("background-volume").value) / 100;
  backgrounds.forEach((audio, index) => { audio.volume = volume * backgroundWeights[index]; });
}

function crossfadeBackground() {
  if (!isPlaying || crossfading) return;
  const current = backgrounds[activeBackground];
  if (!Number.isFinite(current.duration) || current.duration - current.currentTime > CROSSFADE_SECONDS) return;

  const nextIndex = 1 - activeBackground;
  const next = backgrounds[nextIndex];
  crossfading = true;
  next.currentTime = 0;
  next.play().then(() => {
    backgroundWeights[activeBackground] = 1;
    backgroundWeights[nextIndex] = 0;
    const previousIndex = activeBackground;
    activeBackground = nextIndex;
    const startedAt = performance.now();
    const fadeTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / (CROSSFADE_SECONDS * 1000));
      backgroundWeights[previousIndex] = 1 - progress;
      backgroundWeights[nextIndex] = progress;
      updateBackgroundGains();
      if (progress < 1) return;
      clearInterval(fadeTimer);
      backgrounds[previousIndex].pause();
      backgrounds[previousIndex].currentTime = 0;
      crossfading = false;
    }, 25);
  }).catch(() => { crossfading = false; });
}

backgrounds.forEach((audio) => audio.addEventListener("timeupdate", crossfadeBackground));

function stopPlayback() {
  isPlaying = false;
  backgrounds.forEach((audio) => { audio.pause(); audio.currentTime = 0; });
  activeBackground = 0;
  backgroundWeights = [1, 0];
  crossfading = false;
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
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const pan = audioContext.createStereoPanner();
  oscillator.type = "sine";
  oscillator.frequency.value = Number($("frequency-input").value);
  pan.pan.value = rightChannel ? 1 : -1;
  gain.gain.setValueAtTime(0.0001, nextTapAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Number($("tapping-volume").value) / 100 * 0.18), nextTapAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, nextTapAt + 0.11);
  oscillator.connect(gain).connect(pan).connect(audioContext.destination);
  oscillator.start(nextTapAt);
  oscillator.stop(nextTapAt + 0.12);
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
  try {
    audioContext ??= new AudioContextClass();
    await audioContext.resume();
    backgrounds[activeBackground].src = `resources/${$("background-select").value}`;
    backgrounds[1 - activeBackground].src = `resources/${$("background-select").value}`;
    backgrounds.forEach((audio) => audio.load());
    updateBackgroundGains();
    await backgrounds[activeBackground].play();
    isPlaying = true;
    rightChannel = false;
    nextTapAt = audioContext.currentTime + 0.05;
    $("play-state").textContent = "再生中";
    $("toggle-play").innerHTML = '<span aria-hidden="true">■</span> 停止';
    scheduleTap();
    syncTimer();
  } catch (error) {
    stopPlayback();
    $("frequency-error").textContent = "音声を開始できませんでした。もう一度お試しください。";
  }
}

$("toggle-play").addEventListener("click", () => isPlaying ? stopPlayback() : startPlayback());
$("background-select").addEventListener("change", () => {
  const wasPlaying = isPlaying;
  backgrounds.forEach((audio) => { audio.pause(); audio.src = `resources/${$("background-select").value}`; audio.load(); });
  activeBackground = 0;
  backgroundWeights = [1, 0];
  crossfading = false;
  updateBackgroundGains();
  if (wasPlaying) backgrounds[activeBackground].play().catch(() => stopPlayback());
});
$("background-volume").addEventListener("input", (event) => {
  updateBackgroundGains();
  $("background-volume-label").textContent = `${event.target.value}%`;
});
$("tapping-volume").addEventListener("input", (event) => $("tapping-volume-label").textContent = `${event.target.value}%`);
$("frequency-preset").addEventListener("change", (event) => {
  if (event.target.value !== "custom") $("frequency-input").value = event.target.value;
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
