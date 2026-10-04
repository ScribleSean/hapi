import { expect, test } from '@playwright/test'

for (const width of [320, 390, 1280]) {
    test(`device chips and provider badges remain usable at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 })
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto('/e2e-fixtures/harness-ui-fixture.html')
        const bar = page.getByRole('group', { name: 'Filter sessions by machine' })
        await expect(bar).toBeVisible()
        for (const label of [/All \(2\)/, /Mac \(0\)/, /Windows \(2\).*offline.*last seen/]) {
            const chip = bar.getByRole('button', { name: label })
            await expect(chip).toBeVisible()
            const bounds = await chip.boundingBox()
            expect(bounds).not.toBeNull()
            expect(bounds!.x).toBeGreaterThanOrEqual(0)
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
            if (width < 768) expect(bounds!.height).toBeGreaterThanOrEqual(44)
        }
        for (const provider of ['Claude', 'Codex']) {
            const badge = page.getByText(provider, { exact: true }).and(page.locator('span'))
            await expect(badge).toBeVisible()
            const bounds = await badge.boundingBox()
            expect(bounds!.width).toBeGreaterThan(20)
            expect(bounds!.x).toBeGreaterThanOrEqual(0)
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        }
        await bar.getByRole('button', { name: /Mac \(0\)/ }).click()
        await expect(page.getByText('No sessions match your filters.')).toBeVisible()
        await expect(page.getByText('Claude', { exact: true }).and(page.locator('span'))).toHaveCount(0)
        await bar.getByRole('button', { name: /Windows \(2\)/ }).click()
        await expect(page.getByText('Claude', { exact: true }).and(page.locator('span'))).toBeVisible()
        await expect(page.getByText('Codex', { exact: true }).and(page.locator('span'))).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(errors).toEqual([])
    })
}

test('keeps All and known devices when there are no sessions', async ({ page }) => {
    await page.goto('/e2e-fixtures/harness-ui-fixture.html?mode=empty')
    await expect(page.getByRole('button', { name: /All \(0\)/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Mac \(0\)/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Windows \(0\).*offline/ })).toBeVisible()
})

test('keeps All and a single known device', async ({ page }) => {
    await page.goto('/e2e-fixtures/harness-ui-fixture.html?mode=single')
    await expect(page.getByRole('button', { name: /All \(2\)/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Windows \(2\)/ })).toBeVisible()
})
