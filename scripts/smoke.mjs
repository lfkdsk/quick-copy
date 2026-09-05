// End-to-end smoke test against a mocked GitHub API.
//
//   npm run build && npm run preview      # in one terminal
//   npm run smoke                         # in another
//
// Playwright is deliberately not a dependency — the Pages deploy should
// not have to install a browser. Add it when you want to run this:
//   npm i -D playwright && npx playwright install chromium

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

const BASE = process.env.QC_BASE_URL || 'http://localhost:4173/quick-copy/'
const OWNER = 'tester'
const REPO = 'quick-copy-data'
const REPO_JSON = {
  name: REPO,
  owner: { login: OWNER },
  private: false,
  default_branch: 'main',
  html_url: `https://github.com/${OWNER}/${REPO}`,
}

const SEED_SHA = 'aaaa1111'
const SEED = {
  v: 1,
  id: '20260901-101500-seedaa',
  kind: 'text',
  title: 'Deploy checklist',
  text: 'npm ci\nnpm run build\ngit push',
  tags: ['ops', 'notes'],
  createdAt: '2026-09-01T10:15:00.000Z',
}

const errors = []
const calls = []

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })

// Pretend a previous OAuth round-trip already happened.
await context.addInitScript(() => {
  localStorage.setItem('qc.oauth.token', 'gho_faketoken')
  localStorage.setItem('qc.oauth.scope', 'repo')
  localStorage.setItem('qc.repo', 'tester/quick-copy-data')
})

await context.route('https://api.github.com/**', async (route) => {
  const request = route.request()
  const path = new URL(request.url()).pathname
  const method = request.method()
  calls.push(`${method} ${path}`)
  const json = (body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/user')
    return json({ login: OWNER, name: 'Test User', avatar_url: '', html_url: '' })
  if (path === '/user/repos') return json([REPO_JSON])
  if (path === `/repos/${OWNER}/${REPO}`) return json(REPO_JSON)
  if (path.endsWith('/git/trees/main'))
    return json({
      tree: [{ path: `items/${SEED.id}.json`, type: 'blob', sha: SEED_SHA, size: 200 }],
      truncated: false,
    })
  // The blobs endpoint is asked for raw bytes, so the body is the file itself.
  if (path.includes('/git/blobs/'))
    return route.fulfill({ status: 200, body: JSON.stringify(SEED, null, 2) })
  if (method === 'POST' && path.endsWith('/git/blobs')) return json({ sha: 'newblob' })
  if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'headsha' } })
  if (path.includes('/git/commits/')) return json({ tree: { sha: 'basetree' } })
  if (method === 'POST' && path.endsWith('/git/trees')) return json({ sha: 'newtree' })
  if (method === 'POST' && path.endsWith('/git/commits')) return json({ sha: 'newcommit' })
  if (method === 'PATCH' && path.includes('/git/refs/heads/'))
    return json({ object: { sha: 'newcommit' } })
  return json({ message: `unmocked ${method} ${path}` }, 500)
})

const page = await context.newPage()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const pass = (label) => console.log(`  ok  ${label}`)

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })

  await page.getByText('Deploy checklist').waitFor({ timeout: 10_000 })
  pass('listing renders items read back from the git tree')

  const composer = page.getByPlaceholder(/Type a note/)
  await composer.fill('curl -sS https://example.com | sh')
  await page.getByPlaceholder('Title (optional)').fill('One-liner')
  await page.getByPlaceholder('tags, comma separated').fill('shell, snippet')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('One-liner').waitFor({ timeout: 10_000 })
  pass('saving a note commits and shows up immediately')

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.setInputFiles('input[type=file]', {
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await page.getByText('dot.png').waitFor({ timeout: 5000 })
  await page.getByPlaceholder('Title (optional)').fill('A single pixel')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('A single pixel').waitFor({ timeout: 10_000 })
  pass('saving an image commits the asset and its descriptor together')

  await page.getByRole('button', { name: /Images/ }).click()
  const imageCards = await page.locator('article.card').count()
  if (imageCards !== 1) throw new Error(`image filter: expected 1 card, saw ${imageCards}`)
  await page.getByRole('button', { name: /Everything/ }).click()
  pass('filter chips narrow the grid')

  await page.getByRole('searchbox').fill('checklist')
  const hits = await page.locator('article.card').count()
  if (hits !== 1) throw new Error(`search: expected 1 card, saw ${hits}`)
  pass('search filters across titles, text and tags')

  // A fresh context, because addInitScript would re-seed the token.
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  anonPage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await anonPage.goto(BASE, { waitUntil: 'networkidle' })
  await anonPage.getByRole('button', { name: /Sign in with GitHub/ }).waitFor({ timeout: 5000 })
  pass('signed-out visitors get the sign-in screen')
  await anon.close()

  if (errors.length) {
    console.error('\nConsole errors:')
    for (const error of errors) console.error(`  ${error}`)
    process.exitCode = 1
  } else {
    console.log(`\nAll checks passed (${new Set(calls).size} distinct API routes exercised).`)
  }
} catch (error) {
  console.error(`\nFAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
