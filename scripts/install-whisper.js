const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const venvDir = path.join(root, ".venv");
const python = process.platform === "win32"
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!fs.existsSync(venvDir)) {
  run("python3", ["-m", "venv", ".venv"]);
}

run(python, ["-m", "pip", "install", "--upgrade", "pip"]);
run(python, ["-m", "pip", "install", "openai-whisper"]);

console.log("");
console.log("Whisper Python package is installed in .venv.");
console.log("Note: Whisper also needs ffmpeg on PATH to transcribe most video/audio files.");
console.log("On macOS, install ffmpeg with Homebrew if needed: brew install ffmpeg");
