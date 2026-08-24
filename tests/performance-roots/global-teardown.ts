import {mkdir, readFile, readdir, writeFile} from "node:fs/promises"
import path from "node:path"

type SummaryRun = {
  profile: string
  measurements: Array<{
    cache: string
    route: string
    shellMs: number
    firstUsefulMs: number
    settledMs: number
    server: {requestCount: number; responseBytes: number}
    longTasks: unknown[]
  }>
}

export default async function globalTeardown() {
  const output = path.resolve("test-results/performance-roots")
  await mkdir(output, {recursive: true})
  const files = (await readdir(output).catch(() => [])).filter(file => file.endsWith(".json"))
  const runs = await Promise.all(
    files.map(
      async file => JSON.parse(await readFile(path.join(output, file), "utf8")) as SummaryRun,
    ),
  )
  const lines = [
    "# Budabit Root Performance",
    "",
    "Timings are informational; fixture and milestone assertions are enforced.",
    "",
    "| Profile | Cache | Route | Shell ms | Useful ms | Settled ms | Requests | Bytes | Long tasks |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...runs.flatMap(run =>
      run.measurements.map(
        measurement =>
          `| ${run.profile} | ${measurement.cache} | ${measurement.route} | ${Math.round(measurement.shellMs)} | ${Math.round(measurement.firstUsefulMs)} | ${Math.round(measurement.settledMs)} | ${measurement.server.requestCount} | ${measurement.server.responseBytes} | ${measurement.longTasks.length} |`,
      ),
    ),
    "",
  ]
  await writeFile(path.join(output, "summary.md"), `${lines.join("\n")}\n`)
}
