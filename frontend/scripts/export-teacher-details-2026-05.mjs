import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = 'http://127.0.0.1:5173'
const TARGET_MONTH = '2026-05'
const OUTPUT_DIR = path.resolve(process.cwd(), 'exports', `teacher-details-${TARGET_MONTH}`)

async function selectMonth(page, monthValue) {
  const selects = page.locator('select')
  const total = await selects.count()
  for (let i = 0; i < total; i += 1) {
    const select = selects.nth(i)
    const hasOption = await select.locator(`option[value="${monthValue}"]`).count()
    if (hasOption > 0) {
      await select.selectOption(monthValue)
      return true
    }
  }
  return false
}

async function run() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  const downloads = []
  context.on('download', (d) => downloads.push(d))

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '선생님 정산' }).click()
    await page.waitForTimeout(600)

    const monthSelected = await selectMonth(page, TARGET_MONTH)
    if (!monthSelected) throw new Error(`월 선택 실패: ${TARGET_MONTH}`)

    await page.waitForTimeout(1200)
    const rows = page.locator('.teacher-report-layout .settlement-overview-table tbody tr')
    const rowCount = await rows.count()
    if (rowCount === 0) throw new Error('정산 목록 행이 없습니다.')

    console.log(`rows=${rowCount}`)

    for (let i = 0; i < rowCount; i += 1) {
      const row = rows.nth(i)
      const teacherName = (await row.locator('td').first().innerText()).trim().replace(/\s+/g, ' ')
      const viewBtn = row.getByRole('button', { name: '보기' })
      await viewBtn.click()
      await page.waitForSelector('.settlement-modal', { state: 'visible' })

      const exportBtn = page.getByRole('button', { name: '이미지 저장', exact: true })
      const beforeCount = downloads.length
      await exportBtn.click()
      const timeoutAt = Date.now() + 15000
      while (downloads.length <= beforeCount && Date.now() < timeoutAt) {
        await page.waitForTimeout(200)
      }
      if (downloads.length <= beforeCount) {
        throw new Error(`다운로드 이벤트 없음: ${teacherName}`)
      }
      const download = downloads[downloads.length - 1]
      const fileName = download.suggestedFilename()
      const savePath = path.join(OUTPUT_DIR, fileName)
      await download.saveAs(savePath)
      console.log(`saved ${i + 1}/${rowCount}: ${teacherName} -> ${fileName}`)

      await page.getByRole('button', { name: '닫기' }).click()
      await page.waitForSelector('.settlement-modal', { state: 'hidden' })
      await page.waitForTimeout(250)
    }

    console.log(`done: ${OUTPUT_DIR}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
