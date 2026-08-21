const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  
  await page.goto('http://127.0.0.1:3000/admin');
  
  const content = await page.content();
  const hasDeliveries = content.includes('Deliveries');
  console.log('Has Deliveries text:', hasDeliveries);
  
  await browser.close();
})();
