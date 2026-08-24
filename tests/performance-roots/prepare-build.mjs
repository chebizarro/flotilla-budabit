import {execFile} from "node:child_process"
import {mkdir, rm} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outputRoot = path.join(projectRoot, "test-results/performance-roots")

await rm(outputRoot, {recursive: true, force: true})
await mkdir(outputRoot, {recursive: true})
await execFileAsync("./build.sh", [], {
  cwd: projectRoot,
  env: {
    ...process.env,
    VITE_BUILD_HASH: "performance-roots",
    VITE_BUILD_ID: "performance-roots",
    VITE_PERFORMANCE_DIAGNOSTICS: "1",
  },
  maxBuffer: 20 * 1024 * 1024,
})
