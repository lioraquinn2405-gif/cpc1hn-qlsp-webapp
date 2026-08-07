import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('text=Email hoặc số điện thoại', { timeout: 15000 });
await page.locator('input[type="text"]').first().fill('0900000080');
await page.locator('input[type="password"]').first().fill('test123456');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(1500);

console.log('--- Them lo moi (clausii, 1 chai) ---');
await page.locator('button', { hasText: 'Thêm lô mới' }).first().click();
await page.waitForTimeout(500);
const addForm = page.locator('form').filter({ has: page.locator('text=Tên (chủng)') });
await addForm.locator('select').selectOption('clausii');
await addForm.locator('input[type="text"]').fill('TESTNK01');
await addForm.locator('button[type="submit"]').click();
await page.waitForTimeout(1500);

// Mo nhom "Cho KQKN" neu dang dong, roi tim dong TESTNK01
const choKqknLink = page.locator('text=Chờ KQKN').first();
if (await choKqknLink.count()) { await choKqknLink.click(); await page.waitForTimeout(500); }

const row = page.locator('tr', { hasText: 'TESTNK01' });
await row.waitFor({ timeout: 10000 });
console.log('Da tim thay dong TESTNK01');

console.log('\n--- Test 1: chon "Khong dat" nhung CHUA chon con nhiem -> phai hien canh bao do ---');
const nkSelect = row.locator('select').first();
await nkSelect.selectOption('Không đạt');
await page.waitForTimeout(800);
const warningText = await row.locator('text=Bắt buộc chọn con nhiễm').count();
console.log('Co hien canh bao "Bat buoc chon con nhiem"?', warningText > 0 ? 'CO (dung)' : 'KHONG (SAI)');
await page.screenshot({ path: 'scripts/_shot-nk-warning.png', clip: { x: 0, y: 0, width: 1400, height: 400 } });

console.log('\n--- Test 2: chon con nhiem -> canh bao phai bien mat ---');
const nknSelect = row.locator('select').nth(1);
await nknSelect.selectOption('Gram dương');
await page.waitForTimeout(800);
const warningAfter = await row.locator('text=Bắt buộc chọn con nhiễm').count();
console.log('Canh bao con khong (phai = 0)?', warningAfter);

console.log('\n--- Test 3: doi sang "Dat (sub)" -> kiem tra co option nay khong ---');
const options = await nkSelect.locator('option').allTextContents();
console.log('Cac option cua dropdown Nhiem khuan:', JSON.stringify(options));
await nkSelect.selectOption('Đạt (sub)');
await page.waitForTimeout(800);
await page.screenshot({ path: 'scripts/_shot-nk-datsub.png', clip: { x: 0, y: 0, width: 1400, height: 400 } });

console.log('\n--- CONSOLE ERRORS ---');
console.log(consoleErrors.join('\n') || '(none)');
await browser.close();
