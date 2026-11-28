import { expect, test } from '@playwright/test'
import { ACCOUNTS, login, waitForData } from './helpers'

test.describe('Delivery workflows', () => {
  test('saved view: save on Tickets with a filter, reopen from Overview, delete', async ({ page }) => {
    await login(page, ACCOUNTS.demoManager)
    await waitForData(page)
    const name = `E2E blocked ${Date.now()}`
    await page.goto('/jira?status=blocked')
    await page.getByRole('button', { name: 'Saved views' }).click()
    await page.getByRole('button', { name: /Save current view/ }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('View saved').first()).toBeVisible()

    await page.goto('/')
    await waitForData(page)
    await page.getByRole('button', { name: 'Saved views' }).click()
    await page.getByRole('button', { name }).click()
    await expect(page).toHaveURL(/\/jira\?.*status=blocked/)

    await page.getByRole('button', { name: 'Saved views' }).click()
    const row = page.locator('div', { has: page.getByRole('button', { name }) }).last()
    await row.hover()
    await page.getByRole('button', { name: 'Delete view' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Saved views' }).click()
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  })

  test('sprint page shows an active sprint with KPIs and the sprint-scoped forecast', async ({ page }) => {
    await login(page, ACCOUNTS.demoAdmin)
    await waitForData(page)
    await page.goto('/sprints')
    await expect(page.getByText('Tickets in sprint')).toBeVisible({ timeout: 60_000 })
    const forecast = page.getByTestId('forecast-card')
    await expect(forecast).toBeVisible()
    await expect(forecast.getByText(/by sprint end/i)).toBeVisible()
  })

  test('scheduled digest: create, preview, delete', async ({ page }) => {
    await login(page, ACCOUNTS.demoManager)
    await waitForData(page)
    await page.goto('/reports')
    const name = `E2E digest ${Date.now()}`
    await page.getByRole('button', { name: 'New digest' }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByLabel('Recipients').fill('pm@example.com')
    await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click()
    await expect(page.getByText('Digest scheduled').first()).toBeVisible()
    const row = page.getByRole('row', { name: new RegExp(name) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Preview' }).click()
    const preview = page.getByRole('dialog')
    await expect(preview.getByText(/To pm@example.com/)).toBeVisible({ timeout: 60_000 })  // builds the PDF first
    await expect(preview.getByText(/tickets completed/)).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
    await row.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0)
  })

  test('report generation produces a downloadable PDF and appears in history', async ({ page }) => {
    await login(page, ACCOUNTS.demoManager)
    await waitForData(page)
    await page.goto('/reports')
    await page.getByRole('button', { name: /Generate PDF/ }).click()
    await expect(page.getByRole('row', { name: /management/i }).first()).toBeVisible({ timeout: 60_000 })
  })

  test('employee detail opens from the people table with a personal narrative', async ({ page }) => {
    await login(page, ACCOUNTS.demoAdmin)
    await waitForData(page)
    await page.goto('/employees')
    const firstRow = page.getByRole('row').nth(1)
    await expect(firstRow).toBeVisible({ timeout: 60_000 })
    await firstRow.click()
    await expect(page).toHaveURL(/\/employees\/.+/)
    await expect(page.getByTestId('narrative-card').getByText(/This period in one paragraph/)).toBeVisible()
  })

  test('AI Insights: risk table, recommendations, assistant answer', async ({ page }) => {
    await login(page, ACCOUNTS.demoManager)
    await waitForData(page)
    await page.getByRole('link', { name: 'AI Insights' }).click()
    await expect(page).toHaveURL(/\/intelligence/)
    const risk = page.getByTestId('risk-table')
    await expect(risk).toBeVisible({ timeout: 90_000 })  // first call trains the model
    await expect(risk.locator('tbody tr').first()).toBeVisible()
    await risk.locator('tbody tr').first().click()
    await expect(risk.getByText('Why this score')).toBeVisible()

    await page.getByRole('tab', { name: /Recommended actions/ }).click()
    await expect(page.getByTestId('recommendations').or(page.getByText('Nothing to recommend'))).toBeVisible()

    await page.getByRole('tab', { name: 'Ask' }).click()
    await page.getByRole('button', { name: 'Who has the most blocked tickets?' }).click()
    await expect(page.getByText(/understood as: people/)).toBeVisible({ timeout: 30_000 })
  })
})
