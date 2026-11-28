import { expect, type Page } from '@playwright/test'

export const ACCOUNTS = {
  demoAdmin: { email: 'demo.admin@example.com', password: 'Demo-Admin-2026!' },
  demoManager: { email: 'demo.manager@example.com', password: 'Demo-Manager-2026!' },
} as const

/** Sign in through the real dialog (not an API shortcut) so the auth UI itself is covered. */
export async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/welcome?auth=login')
  const dialog = page.getByRole('dialog', { name: 'Sign in' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('you@endava.com').fill(account.email)
  await dialog.getByPlaceholder('Your password').fill(account.password)
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  // Argon2 verification + a busy single-process backend can make the first login slow
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 60_000 })
}

export async function logout(page: Page) {
  await page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST', headers: { Origin: location.origin } }))
}

/** The demo workspace is generated on first use; wait until the Overview has numbers. */
export async function waitForData(page: Page) {
  await expect(page.getByTestId('narrative-card')).toBeVisible({ timeout: 90_000 })
}
