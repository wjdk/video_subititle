const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const root = __dirname;
const port = Number(process.env.PORT || 8766);
const host = process.env.HOST || "127.0.0.1";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
const cacheDir = path.join(root, ".cache");
const uploadDir = path.join(cacheDir, "uploads");
const transcriptDir = path.join(cacheDir, "transcripts");
const installTargets = {
  whisper: {
    label: "Whisper",
    script: path.join(root, "scripts", "install-whisper.js"),
  },
  ffmpeg: {
    label: "FFmpeg",
    script: path.join(root, "scripts", "install-ffmpeg.js"),
  },
  all: {
    label: "Whisper / FFmpeg",
    scripts: [
      path.join(root, "scripts", "install-ffmpeg.js"),
      path.join(root, "scripts", "install-whisper.js"),
    ],
  },
};
const installStates = {
  whisper: {
    state: "idle",
    log: "",
    code: null,
  },
  ffmpeg: {
    state: "idle",
    log: "",
    code: null,
  },
  all: {
    state: "idle",
    log: "",
    code: null,
  },
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, normalized);
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function safeFilename(value, fallback = "upload") {
  const base = path.basename(value || fallback);
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-") || fallback;
}

function getVenvPython() {
  return process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
}

function runInstallerScripts(target, installState, scripts, response) {
  installState.state = "running";
  installState.log = `Starting ${target.label} dependency installation...\n`;
  installState.code = null;

  let index = 0;
  const runNext = () => {
    const script = scripts[index];
    if (!script) {
      installState.code = 0;
      installState.state = "success";
      installState.log += `\n${target.label} dependency installation finished.\n`;
      return;
    }

    installState.log += `\n$ ${process.execPath} ${path.relative(root, script)}\n`;
    const installer = spawn(process.execPath, [script], {
      cwd: root,
      env: process.env,
    });
    installer.stdout.on("data", (chunk) => {
      installState.log += chunk.toString();
    });
    installer.stderr.on("data", (chunk) => {
      installState.log += chunk.toString();
    });
    installer.on("close", (code) => {
      if (code !== 0) {
        installState.code = code;
        installState.state = "failed";
        installState.log += `\n${target.label} dependency installation failed with code ${code}.\n`;
        return;
      }
      index += 1;
      runNext();
    });
  };

  runNext();
  send(response, 202, JSON.stringify({ state: installState.state }), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function runWhisper(inputPath) {
  return new Promise((resolve, reject) => {
    const python = getVenvPython();
    if (!fs.existsSync(python)) {
      reject(new Error("Whisper dependency is not installed. Click the dependency install button first."));
      return;
    }

    fs.mkdirSync(transcriptDir, { recursive: true });
    const inputBase = path.parse(inputPath).name;
    const srtPath = path.join(transcriptDir, `${inputBase}.srt`);
    const args = [
      "-m",
      "whisper",
      inputPath,
      "--model",
      process.env.WHISPER_MODEL || "base",
      "--output_format",
      "srt",
      "--output_dir",
      transcriptDir,
    ];
    const whisper = spawn(python, args, {
      cwd: root,
      env: process.env,
    });
    let log = "";
    whisper.stdout.on("data", (chunk) => {
      log += chunk.toString();
    });
    whisper.stderr.on("data", (chunk) => {
      log += chunk.toString();
    });
    whisper.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper transcription failed with code ${code}.\n${log}`));
        return;
      }
      fs.readFile(srtPath, "utf8", (error, srt) => {
        if (error) {
          reject(new Error(`Whisper finished but no SRT file was produced.\n${log}`));
          return;
        }
        resolve({ srt, srtPath, log });
      });
    });
  });
}

function parseSrtTimestamp(value) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(normalized);
}

function parseSrt(rawText) {
  return rawText
    .replace(/\r/g, "")
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) return null;
      const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
      const start = parseSrtTimestamp(startRaw);
      const end = parseSrtTimestamp(endRaw);
      const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) return null;
      return { start, end, text };
    })
    .filter(Boolean);
}

function wrapSubtitleLine(text, maxChars = 38) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(-3);
}

function escapeDrawtext(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%");
}

function buildDrawtextFilter(srt) {
  const cues = parseSrt(srt);
  const filters = [];
  const fontSize = 24;
  const lineHeight = 31;
  const bottomMargin = 34;

  cues.forEach((cue) => {
    const lines = wrapSubtitleLine(cue.text);
    lines.forEach((line, index) => {
      const yOffset = bottomMargin + (lines.length - 1 - index) * lineHeight;
      filters.push([
        `drawtext=text='${escapeDrawtext(line)}'`,
        `fontsize=${fontSize}`,
        "fontcolor=white",
        "borderw=3",
        "bordercolor=black",
        "shadowcolor=black",
        "shadowx=1",
        "shadowy=1",
        "x=(w-text_w)/2",
        `y=h-${yOffset}-text_h`,
        `enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'`,
      ].join(":"));
    });
  });

  return filters.join(",");
}

function burnSubtitles(inputPath, srtPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    const inputBase = path.parse(inputPath).name;
    const outputName = `${inputBase}-subtitled.mp4`;
    const outputPath = path.join(root, "output", outputName);
    const srt = fs.readFileSync(srtPath, "utf8");
    const filter = buildDrawtextFilter(srt);
    if (!filter) {
      reject(new Error("No drawable subtitle cues were generated."));
      return;
    }
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ], {
      cwd: root,
      env: process.env,
    });
    let log = "";
    ffmpeg.stdout.on("data", (chunk) => {
      log += chunk.toString();
    });
    ffmpeg.stderr.on("data", (chunk) => {
      log += chunk.toString();
    });
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg subtitle burn failed with code ${code}.\n${log}`));
        return;
      }
      resolve({ outputPath, outputName, log, burned: true });
    });
  });
}

function muxSubtitleTrack(inputPath, srtPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    const inputBase = path.parse(inputPath).name;
    const outputName = `${inputBase}-subtitled.mp4`;
    const outputPath = path.join(root, "output", outputName);
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-i",
      srtPath,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-c:s",
      "mov_text",
      "-metadata:s:s:0",
      "language=eng",
      "-movflags",
      "+faststart",
      outputPath,
    ], {
      cwd: root,
      env: process.env,
    });
    let log = "";
    ffmpeg.stdout.on("data", (chunk) => {
      log += chunk.toString();
    });
    ffmpeg.stderr.on("data", (chunk) => {
      log += chunk.toString();
    });
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg subtitle mux failed with code ${code}.\n${log}`));
        return;
      }
      resolve({ outputPath, outputName, log, burned: false });
    });
  });
}

function transcribeVideo(inputPath, response) {
  const python = getVenvPython();
  if (!fs.existsSync(python)) {
    send(response, 500, JSON.stringify({
      error: "Whisper dependency is not installed. Click the dependency install button first.",
    }), {
      "Content-Type": "application/json; charset=utf-8",
    });
    return;
  }

  runWhisper(inputPath)
    .then(({ srt, srtPath, log }) => {
      send(response, 200, JSON.stringify({
        srt,
        srtFile: path.relative(root, srtPath),
        log,
      }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    })
    .catch((error) => {
      send(response, 500, JSON.stringify({
        error: error.message,
      }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/install-status") {
    const target = url.searchParams.get("target") || "whisper";
    if (!installStates[target]) {
      send(response, 400, JSON.stringify({ error: "unsupported dependency target" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }
    send(response, 200, JSON.stringify(installStates[target]), {
      "Content-Type": "application/json; charset=utf-8",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/install-dependencies") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        send(response, 400, JSON.stringify({ error: "invalid json" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }

      const target = payload.target;
      const installTarget = installTargets[target];
      const installState = installStates[target];
      if (!installTarget || !installState) {
        send(response, 400, JSON.stringify({ error: "unsupported dependency target" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }
      if (installState.state === "running") {
        send(response, 409, JSON.stringify({ error: "install already running" }), {
          "Content-Type": "application/json; charset=utf-8",
        });
        return;
      }

      runInstallerScripts(
        installTarget,
        installState,
        installTarget.scripts || [installTarget.script],
        response,
      );
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/transcribe") {
    const originalName = safeFilename(url.searchParams.get("file"), "upload-video");
    const ext = path.extname(originalName) || ".mp4";
    const stem = path.basename(originalName, ext);
    const uniqueName = `${Date.now()}-${stem}${ext}`;
    const uploadPath = path.join(uploadDir, uniqueName);

    fs.mkdirSync(uploadDir, { recursive: true });
    const stream = fs.createWriteStream(uploadPath);
    request.pipe(stream);
    stream.on("finish", () => {
      transcribeVideo(uploadPath, response);
    });
    stream.on("error", (error) => {
      send(response, 500, JSON.stringify({ error: error.message }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/auto-subtitle") {
    const originalName = safeFilename(url.searchParams.get("file"), "upload-video");
    const ext = path.extname(originalName) || ".mp4";
    const stem = path.basename(originalName, ext);
    const uniqueName = `${Date.now()}-${stem}${ext}`;
    const uploadPath = path.join(uploadDir, uniqueName);

    fs.mkdirSync(uploadDir, { recursive: true });
    const stream = fs.createWriteStream(uploadPath);
    request.pipe(stream);
    stream.on("finish", async () => {
      try {
        const { srt, srtPath, log: whisperLog } = await runWhisper(uploadPath);
        if (!srt.includes("-->")) {
          throw new Error("Whisper did not produce usable subtitles for this video.");
        }
        let videoResult;
        try {
          videoResult = await burnSubtitles(uploadPath, srtPath);
        } catch (error) {
          if (!error.message.includes("No such filter")) throw error;
          videoResult = await muxSubtitleTrack(uploadPath, srtPath);
          videoResult.log = `${error.message}\n\nFell back to embedded MP4 subtitle track.\n${videoResult.log}`;
        }
        send(response, 200, JSON.stringify({
          srt,
          srtFile: path.relative(root, srtPath),
          videoFile: path.relative(root, videoResult.outputPath),
          videoUrl: `/${path.relative(root, videoResult.outputPath).replace(/\\/g, "/")}`,
          downloadName: videoResult.outputName,
          burned: videoResult.burned !== false,
          log: `${whisperLog}\n${videoResult.log}`,
        }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (error) {
        send(response, 500, JSON.stringify({ error: error.message }), {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
    });
    stream.on("error", (error) => {
      send(response, 500, JSON.stringify({ error: error.message }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/save-export") {
    const filename = url.searchParams.get("file") || "subtitled-output.webm";
    const outputPath = safePath(path.join("output", filename));
    if (!outputPath) {
      send(response, 400, JSON.stringify({ error: "bad path" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const stream = fs.createWriteStream(outputPath);
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
    });
    request.pipe(stream);
    stream.on("finish", () => {
      send(response, 200, JSON.stringify({
        file: path.relative(root, outputPath),
        size,
      }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    });
    stream.on("error", (error) => {
      send(response, 500, JSON.stringify({ error: error.message }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed");
    return;
  }

  const filePath = safePath(url.pathname === "/" ? "/index.html" : url.pathname);
  if (!filePath) {
    send(response, 400, "Bad Request");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      send(response, 404, "Not Found");
      return;
    }

    const headers = {
      "Content-Length": stats.size,
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, host, () => {
  console.log(`Video subtitle test server: http://${host}:${port}`);
});
