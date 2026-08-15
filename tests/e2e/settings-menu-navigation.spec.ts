import {expect, test} from "@playwright/test"
import {seedDevSession} from "./helpers/dev-session"

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })

  return {promise, resolve}
}

test("keeps the settings menu open while the selected route is loading", async ({page}) => {
  const moduleRequested = deferred()
  const releaseModule = deferred()

  await seedDevSession(page)
  await page.route(/\/src\/routes\/settings\/git\/\+page\.svelte(?:\?|$)/, async route => {
    moduleRequested.resolve()
    await releaseModule.promise
    await route.continue()
  })

  await page.goto("/home")
  await page.getByRole("button", {name: "Settings"}).click()
  const sourcePath = new URL(page.url()).pathname

  const modal = page.getByTestId("modal-root")
  const gitLink = modal.getByRole("link", {name: /^Git/})

  await expect(gitLink).toBeVisible()
  await gitLink.evaluate(element => (element as HTMLAnchorElement).click())
  await moduleRequested.promise

  await expect(gitLink).toHaveAttribute("aria-busy", "true")
  await expect(gitLink.locator(".loading-spinner")).toBeVisible()
  await expect(page).toHaveURL(/#.+$/)
  expect(new URL(page.url()).pathname).toBe(sourcePath)
  await expect(gitLink).toBeVisible()

  releaseModule.resolve()

  await expect(page).toHaveURL(/\/settings\/git$/)
  await expect(gitLink).toHaveCount(0)
})
