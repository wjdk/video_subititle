const { spawnSync } = require("child_process");

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (commandExists("ffmpeg")) {
  console.log("FFmpeg is already installed and available on PATH.");
  process.exit(0);
}

if (process.platform === "darwin") {
  if (!commandExists("brew")) {
    console.error("Homebrew is required to install FFmpeg automatically on macOS.");
    console.error("Install Homebrew first, then click the button again: https://brew.sh/");
    process.exit(1);
  }
  run("brew", ["install", "ffmpeg"]);
  process.exit(0);
}

if (process.platform === "linux") {
  if (commandExists("apt-get")) {
    console.error("FFmpeg can be installed with apt, but this app will not run sudo automatically.");
    console.error("Please run: sudo apt-get update && sudo apt-get install -y ffmpeg");
    process.exit(1);
  }
  if (commandExists("dnf")) {
    console.error("Please run: sudo dnf install ffmpeg");
    process.exit(1);
  }
  if (commandExists("pacman")) {
    console.error("Please run: sudo pacman -S ffmpeg");
    process.exit(1);
  }
}

if (process.platform === "win32") {
  if (commandExists("winget")) {
    run("winget", ["install", "--id", "Gyan.FFmpeg", "-e"]);
    process.exit(0);
  }
  console.error("Please install FFmpeg manually and add it to PATH.");
  console.error("Download: https://ffmpeg.org/download.html");
  process.exit(1);
}

console.error("Unsupported platform for automatic FFmpeg installation.");
console.error("Please install FFmpeg manually and make sure it is available on PATH.");
process.exit(1);
