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

test('HTTP Claude remains readable and sendable on phones without runner controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/e2e-fixtures/http-claude-fixture.html?thinking=1&capabilities=1')
    await expect(page.getByText('Existing HTTP transcript remains readable.')).toBeVisible()
    await expect(page.getByText(/HTTP Claude session: messaging only/)).toBeVisible()
    for (const name of [/^Abort$/, /^Terminal$/, /^Files$/, /^Settings$/, /^Attach/]) {
        await expect(page.getByRole('button', { name })).toHaveCount(0)
    }
    await page.getByRole('button', { name: /More/ }).click()
    await expect(page.getByRole('menuitem', { name: /Archive|Reopen|Resume/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('textbox').fill('Send a normal prompt')
    await page.getByRole('button', { name: /^Send$/ }).click()
    await expect.poll(() => page.evaluate(() => window.fixturePrompts)).toEqual(['Send a normal prompt'])
    await page.getByRole('textbox').fill('/clear')
    await page.getByRole('button', { name: /^Send$/ }).click()
    await expect.poll(() => page.evaluate(() => window.fixturePrompts)).toEqual(['Send a normal prompt', '/clear'])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+m')
    expect(await page.evaluate(() => window.fixtureCalls.filter(name => /abort|switch|setModel|setEffort|Permission|Slash|Skills|upload|resume|reopen|readSessionFile|Git|fork|rewind|clearConversation/i.test(name)))).toEqual([])
    expect(errors).toEqual([])
})

test('native Claude retains its runner controls', async ({ page }) => {
    await page.goto('/e2e-fixtures/http-claude-fixture.html?native=1')
    await expect(page.getByRole('button', { name: /^Abort$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Settings$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Terminal$/ })).toBeVisible()
    await expect(page.getByText(/HTTP Claude session: messaging only/)).toHaveCount(0)
})
