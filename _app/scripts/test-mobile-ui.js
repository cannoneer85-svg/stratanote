import { chromium } from 'playwright-core';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotPath = join(__dirname, 'mobile-sidebar-layout.png');

const BASE_URL = 'http://localhost:3001';

async function runMobileTest() {
  console.log('=== Запуск E2E-тестирования мобильной верстки ===');
  
  let browser;
  try {
    // Launch local Chrome instance to avoid downloading massive browser binaries
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome'
    });
    
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/04.1',
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    
    const page = await context.newPage();
    
    console.log(`1. Переход на ${BASE_URL}...`);
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);
    
    // 2. Login if login page is displayed
    if (await page.locator('input[placeholder*="Имя пользователя"]').count() > 0) {
      console.log('2. Обнаружена страница логина. Авторизация...');
      await page.fill('input[placeholder*="Имя пользователя"]', 'admin');
      await page.fill('input[placeholder*="Пароль"]', 'admin');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(1500);
    }
    
    console.log('3. Проверка состояния сайдбара...');
    // If sidebar overlay is not visible, it means the sidebar is closed. Toggle it.
    const isSidebarClosed = await page.locator('div.fixed.inset-0.bg-black\\/60').count() === 0;
    if (isSidebarClosed) {
      console.log('4. Сайдбар закрыт. Клик на кнопку меню (гамбургер)...');
      const menuBtn = page.locator('button:has(svg.lucide-menu), button[title*="панель"]');
      if (await menuBtn.count() > 0) {
        await menuBtn.click();
        await page.waitForTimeout(500); // Wait for transition animation
      } else {
        console.warn('Предупреждение: Кнопка меню не найдена, возможно сайдбар уже открыт.');
      }
    }
    
    // 5. Verify layout size
    console.log('5. Проверка геометрических размеров элементов сайдбара...');
    const sidebar = page.locator('.bg-background-panel').first();
    if (await sidebar.count() === 0) {
      throw new Error('Критическая ошибка: Элемент сайдбара (.bg-background-panel) не найден на странице!');
    }
    
    const boundingBox = await sidebar.boundingBox();
    console.log(`   - Измеренная ширина сайдбара: ${boundingBox.width}px`);
    console.log(`   - Измеренная высота сайдбара: ${boundingBox.height}px`);
    
    if (boundingBox.width < 300) {
      throw new Error(`Ошибка верстки: сайдбар слишком узкий (${boundingBox.width}px). Элементы сжаты!`);
    }
    console.log('✓ Геометрия сайдбара соответствует стандарту мобильной версии (320px/20rem).');
    
    // 5.5. Verify notifications popover works on mobile
    console.log('5.5. Проверка работы поповера уведомлений...');
    const bellBtn = page.locator('button[title*="Уведомления"]');
    if (await bellBtn.count() > 0) {
      console.log('   - Клик на колокольчик для открытия поповера...');
      await bellBtn.click();
      await page.waitForTimeout(300);

      const popover = page.locator('div:has-text("Рецензии на согласование")').last();
      const popoverBox = await popover.boundingBox();
      console.log(`   - Положение поповера: x=${popoverBox.x}, width=${popoverBox.width}`);
      const rightEdge = popoverBox.x + popoverBox.width;
      console.log(`   - Правая граница поповера: ${rightEdge}px`);

      if (rightEdge > 375) {
        throw new Error(`Ошибка верстки: поповер выходит за правый край экрана (${rightEdge}px > 375px)!`);
      }
      console.log('✓ Поповер полностью помещается на мобильном экране.');

      // Click close button inside popover
      const closeBtn = popover.locator('button[title="Закрыть"]');
      if (await closeBtn.count() > 0) {
        console.log('   - Клик на крестик "X" для закрытия поповера...');
        await closeBtn.click();
        await page.waitForTimeout(300);
      } else {
        throw new Error('Кнопка закрытия "X" в поповере не найдена!');
      }
    }

    // 6. Capture screenshot
    console.log('6. Создание скриншота мобильной версии...');
    await page.screenshot({ path: screenshotPath });
    console.log(`✓ Скриншот успешно сохранен: ${screenshotPath}`);
    console.log('=== Тестирование мобильной версии успешно завершено! ===');
  } catch (err) {
    console.error('❌ Ошибка во время выполнения теста мобильной версии:', err.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runMobileTest();
