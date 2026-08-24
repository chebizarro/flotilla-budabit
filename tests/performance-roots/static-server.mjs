import {createReadStream} from "node:fs"
import {readFile, stat} from "node:fs/promises"
import {createServer} from "node:http"
import path from "node:path"
import {fileURLToPath} from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const buildRoot = path.join(projectRoot, "build")
let requestCount = 0
let responseBytes = 0

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
}

const sendJson = (response, payload) => {
  const body = JSON.stringify(payload)
  response.writeHead(200, {"cache-control": "no-store", "content-type": "application/json"})
  response.end(body)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost")
    if (url.pathname === "/__perf/state") {
      sendJson(response, {requestCount, responseBytes})
      return
    }
    if (url.pathname === "/__perf/reset" && request.method === "POST") {
      requestCount = 0
      responseBytes = 0
      sendJson(response, {ok: true})
      return
    }

    const decodedPath = decodeURIComponent(url.pathname)
    const relativePath = decodedPath.replace(/^\/+/, "")
    let filePath = path.resolve(buildRoot, relativePath || "index.html")
    if (!filePath.startsWith(`${path.resolve(buildRoot)}${path.sep}`)) {
      response.writeHead(403).end()
      return
    }
    let fileStat = await stat(filePath).catch(() => null)
    if ((!fileStat || !fileStat.isFile()) && !decodedPath.startsWith("/_app/")) {
      filePath = path.join(buildRoot, "index.html")
      fileStat = await stat(filePath).catch(() => null)
    }
    if (!fileStat?.isFile()) {
      response.writeHead(404, {"cache-control": "no-store"}).end("Not found")
      return
    }

    requestCount += 1
    responseBytes += fileStat.size
    const immutable = decodedPath.startsWith("/_app/immutable/")
    const headers = {
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-store, must-revalidate",
      "content-length": fileStat.size,
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    }
    if (decodedPath === "/service-worker.js") headers["service-worker-allowed"] = "/"
    response.writeHead(200, headers)
    if (request.method === "HEAD") response.end()
    else createReadStream(filePath).pipe(response)
  } catch (error) {
    response.writeHead(500, {"content-type": "text/plain"})
    response.end(error instanceof Error ? error.message : String(error))
  }
})

await readFile(path.join(buildRoot, "index.html"))
server.listen(1849, "localhost")

const close = () => server.close(() => process.exit(0))
process.on("SIGINT", close)
process.on("SIGTERM", close)
