const $ = (selector) => document.querySelector(selector);

const elements = {
  videoInput: $("#videoInput"),
  videoName: $("#videoName"),
  primaryFile: $("#primaryFile"),
  secondaryFile: $("#secondaryFile"),
  primaryText: $("#primaryText"),
  secondaryText: $("#secondaryText"),
  parseText: $("#parseText"),
  previewButton: $("#previewButton"),
  exportButton: $("#exportButton"),
  readyState: $("#readyState"),
  progressLabel: $("#progressLabel"),
  progressPercent: $("#progressPercent"),
  progressBar: $("#progressBar"),
  downloadLink: $("#downloadLink"),
  canvas: $("#canvas"),
  video: $("#video"),
  emptyState: $("#emptyState"),
  fontScale: $("#fontScale"),
  bottomOffset: $("#bottomOffset"),
  strokeSize: $("#strokeSize"),
  quality: $("#quality"),
  whisperStatus: $("#whisperStatus"),
  ffmpegStatus: $("#ffmpegStatus"),
  installWhisperButton: $("#installWhisperButton"),
  installFfmpegButton: $("#installFfmpegButton"),
};

const ctx = elements.canvas.getContext("2d");
let primaryCues = [];
let secondaryCues = [];
let animationFrame = 0;
let isExporting = false;
let pendingSeek = null;
let exportEndTime = null;
let lastExportInfo = null;

function setStatus(text) {
  elements.readyState.textContent = text;
}

function setProgress(label, percent) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  elements.progressLabel.textContent = label;
  elements.progressPercent.textContent = `${safePercent}%`;
  elements.progressBar.value = safePercent;
}

const dependencyControls = {
  whisper: {
    button: elements.installWhisperButton,
    status: elements.whisperStatus,
    label: "Whisper",
  },
  ffmpeg: {
    button: elements.installFfmpegButton,
    status: elements.ffmpegStatus,
    label: "FFmpeg",
  },
};

function setDependencyStatus(target, text) {
  if (dependencyControls[target]?.status) {
    dependencyControls[target].status.textContent = text;
  }
}

function updateExportState() {
  const hasVideo = Boolean(elements.video.src);
  const hasSubs = primaryCues.length > 0 || secondaryCues.length > 0;
  elements.exportButton.disabled = !hasVideo || !hasSubs || isExporting;
  if (hasVideo && hasSubs) {
    setStatus("可导出");
  } else if (hasVideo) {
    setStatus("待字幕");
  } else {
    setStatus("待上传");
  }
}

function setVideoSource(src, label) {
  elements.video.src = src;
  elements.videoName.textContent = label;
  elements.emptyState.classList.add("hidden");
  elements.downloadLink.classList.remove("visible");
  setProgress("视频已加载", 0);
  updateExportState();
}

function parseTimestamp(value) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(normalized);
}

function parseSubtitles(rawText) {
  const text = rawText.replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n+/i, "").trim();
  if (!text) return [];

  const blocks = text.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const cueText = lines
      .slice(timingIndex + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();

    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && cueText) {
      cues.push({ start, end, text: cueText });
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

async function readSubtitleFile(input) {
  const file = input.files?.[0];
  if (!file) return [];
  return parseSubtitles(await file.text());
}

function getActiveCue(cues, time) {
  return cues.find((cue) => time >= cue.start && time <= cue.end);
}

function wrapText(text, maxWidth, font) {
  ctx.font = font;
  const sourceLines = text.split("\n");
  const wrapped = [];

  for (const sourceLine of sourceLines) {
    const tokens = sourceLine.match(/[\u4e00-\u9fff]|[^\s]+|\s+/g) || [];
    let line = "";

    for (const token of tokens) {
      const candidate = `${line}${token}`;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        wrapped.push(line.trim());
        line = token.trimStart();
      }
    }

    if (line.trim()) wrapped.push(line.trim());
  }

  return wrapped.slice(-3);
}

function drawTextLine(text, x, y, font, fillStyle, strokeWidth) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.92)";
  ctx.lineWidth = strokeWidth;
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = strokeWidth;
  ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = fillStyle;
  ctx.fillText(text, x, y);
}

function renderFrame() {
  const { video, canvas } = elements;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  if (video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#050607";
    ctx.fillRect(0, 0, width, height);
  }

  const primary = getActiveCue(primaryCues, video.currentTime);
  const secondary = getActiveCue(secondaryCues, video.currentTime);
  const scale = Number(elements.fontScale.value);
  const base = Math.max(22, Math.min(width, height) * 0.045 * scale);
  const primaryFont = `700 ${base}px Arial, "PingFang SC", sans-serif`;
  const secondaryFont = `600 ${base * 0.72}px Arial, "PingFang SC", sans-serif`;
  const maxWidth = width * 0.84;
  const strokeWidth = Number(elements.strokeSize.value);
  const bottom = height * (Number(elements.bottomOffset.value) / 100);
  const lineGap = base * 1.2;
  const secondaryGap = base * 0.9;

  const secondaryLines = secondary ? wrapText(secondary.text, maxWidth, secondaryFont) : [];
  const primaryLines = primary ? wrapText(primary.text, maxWidth, primaryFont) : [];
  let y = height - bottom;

  for (let i = secondaryLines.length - 1; i >= 0; i -= 1) {
    drawTextLine(secondaryLines[i], width / 2, y, secondaryFont, "#f0d267", strokeWidth * 0.82);
    y -= secondaryGap;
  }

  if (secondaryLines.length && primaryLines.length) y -= base * 0.12;

  for (let i = primaryLines.length - 1; i >= 0; i -= 1) {
    drawTextLine(primaryLines[i], width / 2, y, primaryFont, "#ffffff", strokeWidth);
    y -= lineGap;
  }
}

function startPreview() {
  cancelAnimationFrame(animationFrame);
  const loop = () => {
    renderFrame();
    animationFrame = requestAnimationFrame(loop);
  };
  loop();
}

async function loadFileSubtitles() {
  const [primary, secondary] = await Promise.all([
    readSubtitleFile(elements.primaryFile),
    readSubtitleFile(elements.secondaryFile),
  ]);
  primaryCues = primary;
  secondaryCues = secondary;
  setProgress(`已读取 ${primaryCues.length + secondaryCues.length} 条字幕`, 0);
  renderFrame();
  updateExportState();
}

function loadTextSubtitles() {
  primaryCues = parseSubtitles(elements.primaryText.value);
  secondaryCues = parseSubtitles(elements.secondaryText.value);
  setProgress(`已读取 ${primaryCues.length + secondaryCues.length} 条字幕`, 0);
  renderFrame();
  updateExportState();
}

function getSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function waitForVideoEvent(name) {
  return new Promise((resolve) => {
    elements.video.addEventListener(name, resolve, { once: true });
  });
}

async function exportVideo() {
  const { video, canvas } = elements;
  if (!video.src || isExporting) return;

  const mimeType = getSupportedMimeType();
  if (!mimeType) {
    setProgress("当前浏览器不支持视频导出", 0);
    return;
  }

  isExporting = true;
  updateExportState();
  elements.downloadLink.classList.remove("visible");
  setStatus("导出中");
  setProgress("准备导出", 0);

  video.pause();
  video.currentTime = 0;
  await waitForVideoEvent("seeked");
  renderFrame();

  const canvasStream = canvas.captureStream(30);
  const outputStream = new MediaStream(canvasStream.getVideoTracks());
  if (typeof video.captureStream === "function") {
    const sourceStream = video.captureStream();
    sourceStream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
  }

  const chunks = [];
  const recorder = new MediaRecorder(outputStream, {
    mimeType,
    videoBitsPerSecond: Number(elements.quality.value),
  });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  const playbackFinished = new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener("ended", finish);
      resolve();
    };
    video.addEventListener("ended", finish, { once: true });
  });

  recorder.start(1000);
  try {
    await video.play();
  } catch (error) {
    video.muted = true;
    await video.play();
  }

  const tick = () => {
    renderFrame();
    const percent = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    setProgress("正在烧录字幕", percent);
    if (exportEndTime !== null && video.currentTime >= exportEndTime) {
      video.pause();
      if (recorder.state === "recording") recorder.stop();
      return;
    }
    if (!video.ended && !video.paused) {
      animationFrame = requestAnimationFrame(tick);
    }
  };
  tick();

  if (exportEndTime === null) {
    await playbackFinished;
    recorder.stop();
  }
  await stopped;

  let blob = new Blob(chunks, { type: mimeType });
  if (typeof window.ysFixWebmDuration === "function") {
    const durationMs = Math.round((exportEndTime || video.duration || 0) * 1000);
    if (durationMs > 0) {
      blob = await window.ysFixWebmDuration(blob, durationMs, { logger: false });
    }
  }
  lastExportInfo = {
    size: blob.size,
    type: blob.type,
  };
  const saveUrl = new URLSearchParams(window.location.search).get("saveUrl");
  if (saveUrl) {
    const response = await fetch(saveUrl, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (!response.ok) {
      throw new Error(`保存导出视频失败: ${response.status}`);
    }
    lastExportInfo.saved = await response.json();
  }
  elements.downloadLink.href = URL.createObjectURL(blob);
  elements.downloadLink.classList.add("visible");
  setProgress("导出完成", 100);
  setStatus("已完成");
  isExporting = false;
  updateExportState();
  startPreview();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.tab}Panel`).classList.add("active");
  });
});

elements.videoInput.addEventListener("change", () => {
  const file = elements.videoInput.files?.[0];
  if (!file) return;
  setVideoSource(URL.createObjectURL(file), file.name);
});

elements.video.addEventListener("loadedmetadata", () => {
  if (pendingSeek !== null) {
    elements.video.currentTime = Math.min(pendingSeek, elements.video.duration || pendingSeek);
    pendingSeek = null;
  }
  renderFrame();
  startPreview();
  updateExportState();
});

elements.video.addEventListener("seeked", renderFrame);

elements.primaryFile.addEventListener("change", loadFileSubtitles);
elements.secondaryFile.addEventListener("change", loadFileSubtitles);
elements.parseText.addEventListener("click", loadTextSubtitles);
elements.previewButton.addEventListener("click", () => {
  if (elements.video.paused) {
    elements.video.play();
  } else {
    elements.video.pause();
  }
  startPreview();
});
elements.exportButton.addEventListener("click", exportVideo);

async function refreshInstallStatus(target) {
  const control = dependencyControls[target];
  if (!control?.button) return;
  try {
    const response = await fetch(`/install-status?target=${encodeURIComponent(target)}`);
    if (!response.ok) throw new Error("status unavailable");
    const status = await response.json();
    const tail = status.log?.trim().split("\n").slice(-1)[0];
    if (status.state === "idle") {
      setDependencyStatus(target, `可安装 ${control.label}`);
      control.button.disabled = false;
    } else if (status.state === "running") {
      setDependencyStatus(target, tail || `正在安装 ${control.label}...`);
      control.button.disabled = true;
      window.setTimeout(() => refreshInstallStatus(target), 1600);
    } else if (status.state === "success") {
      setDependencyStatus(target, `${control.label} 已安装`);
      control.button.disabled = false;
    } else {
      setDependencyStatus(target, tail || `${control.label} 安装失败`);
      control.button.disabled = false;
    }
  } catch (error) {
    setDependencyStatus(target, "启动本地服务后可安装");
    control.button.disabled = true;
  }
}

async function installDependencies(target) {
  const control = dependencyControls[target];
  if (!control?.button) return;
  control.button.disabled = true;
  setDependencyStatus(target, `开始安装 ${control.label}...`);
  try {
    const response = await fetch("/install-dependencies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `安装请求失败: ${response.status}`);
    }
    await refreshInstallStatus(target);
  } catch (error) {
    setDependencyStatus(target, error.message || "安装请求失败");
    control.button.disabled = false;
  }
}

if (elements.installWhisperButton) {
  elements.installWhisperButton.addEventListener("click", () => installDependencies("whisper"));
  refreshInstallStatus("whisper");
}

if (elements.installFfmpegButton) {
  elements.installFfmpegButton.addEventListener("click", () => installDependencies("ffmpeg"));
  refreshInstallStatus("ffmpeg");
}

[elements.fontScale, elements.bottomOffset, elements.strokeSize].forEach((input) => {
  input.addEventListener("input", renderFrame);
});

setProgress("等待开始", 0);
updateExportState();

async function loadTestAssetsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const videoUrl = params.get("video");
  const primaryUrl = params.get("primary");
  const secondaryUrl = params.get("secondary");
  const seek = Number(params.get("seek"));
  const exportEnd = Number(params.get("exportEnd"));

  if (!videoUrl && !primaryUrl && !secondaryUrl) return;

  if (Number.isFinite(seek)) {
    pendingSeek = seek;
  }
  if (Number.isFinite(exportEnd) && exportEnd > 0) {
    exportEndTime = exportEnd;
  }

  if (params.get("autoExport") === "1") {
    const startAutoExport = () => {
      exportVideo().catch((error) => {
        setStatus("导出失败");
        setProgress(error.message || "导出失败", 0);
      });
    };
    if (elements.video.readyState >= 1) {
      startAutoExport();
    } else {
      elements.video.addEventListener("loadedmetadata", startAutoExport, { once: true });
    }
  }

  if (primaryUrl) {
    primaryCues = parseSubtitles(await fetch(primaryUrl).then((response) => response.text()));
  }
  if (secondaryUrl) {
    secondaryCues = parseSubtitles(await fetch(secondaryUrl).then((response) => response.text()));
  }
  if (primaryUrl || secondaryUrl) {
    setProgress(`已读取 ${primaryCues.length + secondaryCues.length} 条字幕`, 0);
  }
  if (videoUrl) {
    setVideoSource(videoUrl, videoUrl.split("/").pop() || "测试视频");
  }
  updateExportState();
}

window.subtitleAppDebugState = () => ({
  primaryCueCount: primaryCues.length,
  secondaryCueCount: secondaryCues.length,
  currentTime: elements.video.currentTime,
  duration: elements.video.duration,
  width: elements.video.videoWidth,
  height: elements.video.videoHeight,
  exportDisabled: elements.exportButton.disabled,
  status: elements.readyState.textContent,
  progress: elements.progressLabel.textContent,
  lastExportInfo,
});

loadTestAssetsFromUrl().catch((error) => {
  setStatus("测试加载失败");
  setProgress(error.message || "测试加载失败", 0);
});
