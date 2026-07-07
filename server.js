const fs = require("fs");
const http = require("http");
const path = require("path");
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

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

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
