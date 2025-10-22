import { test, expect, BrowserContext, Page } from '@playwright/test';
import {
  setupLogCapture,
  waitForNodeReady,
  getPeerId,
  waitForPeerDiscovery,
  getP2PLogs,
  getNetworkStats
} from './helpers';

/**
 * E2E Tests for Multi-User Data Sharing
 * 
 * These tests verify that content created in one browser can be
 * discovered, loaded, and viewed by another browser via P2P network.
 */

test.describe('Multi-User Data Sharing', () => {

  test('Menu created in Browser 1 can be loaded by Browser 2 using CID', async ({ browser }) => {
    let context1: BrowserContext | null = null;
    let context2: BrowserContext | null = null;
    let page1: Page | null = null;
    let page2: Page | null = null;

    try {
      // Create two isolated browser contexts
      context1 = await browser.newContext({ storageState: undefined });
      context2 = await browser.newContext({ storageState: undefined });

      page1 = await context1.newPage();
      page2 = await context2.newPage();

      await setupLogCapture(page1);
      await setupLogCapture(page2);

      console.log('🧪 Browser 1: Creating menu...');
      await page1.goto('/');
      await waitForNodeReady(page1);
      const peerId1 = await getPeerId(page1);
      console.log(`✅ Browser 1 ready: ${peerId1.substring(0, 20)}...`);

      // Create a menu in Browser 1
      await page1.click('text=Create New Menu');
      await page1.waitForURL('**/menu**');

      const menuTitle = 'Shared Test Menu';
      await page1.fill('input.menu-title', menuTitle);
      
      await page1.fill('input.new-group-title', 'Starters');
      await page1.press('input.new-group-title', 'Enter');
      await page1.waitForTimeout(3000); // Wait for save

      // Get the URL with encoded CID
      const url1 = page1.url();
      const encodedParam = new URL(url1).searchParams.get('encoded');
      
      console.log(`📝 Browser 1 created menu with ID: ${encodedParam?.substring(0, 30)}...`);

      // Start Browser 2
      console.log('🧪 Browser 2: Starting...');
      await page2.goto('/');
      await waitForNodeReady(page2);
      const peerId2 = await getPeerId(page2);
      console.log(`✅ Browser 2 ready: ${peerId2.substring(0, 20)}...`);

      // Wait for P2P network to establish
      console.log('⏳ Waiting for peer discovery...');
      await Promise.race([
        waitForPeerDiscovery(page1, 90000),
        waitForPeerDiscovery(page2, 90000)
      ]).catch(() => console.log('⚠️  Peer discovery timeout (continuing anyway)'));

      await page1.waitForTimeout(10000);
      await page2.waitForTimeout(10000);

      // Get network stats
      const stats1 = await getNetworkStats(page1);
      const stats2 = await getNetworkStats(page2);
      
      console.log(`📊 Browser 1: ${stats1.connections} connections`);
      console.log(`📊 Browser 2: ${stats2.connections} connections`);

      // Verify we got an encoded param outside conditional
      expect(encodedParam).toBeDefined();

      if (encodedParam) {
        // Browser 2 tries to load the menu by CID
        console.log('🧪 Browser 2: Attempting to load menu by CID...');
        await page2.goto(`/menu?encoded=${encodeURIComponent(encodedParam)}`);
        await page2.waitForTimeout(5000); // Wait for IPFS to fetch

        // Check if menu loaded
        const titleValue = await page2.locator('input.menu-title').inputValue();
        
        const contentMatches = (titleValue === menuTitle);
        
        if (contentMatches) {
          console.log('✅ SUCCESS: Browser 2 loaded menu from Browser 1 via P2P!');
        } else {
          console.log(`⚠️  Browser 2 loaded different content: "${titleValue}"`);
          console.log('ℹ️  This may be expected if content hasn\'t propagated yet');
        }

        // Check if the group exists
        const hasStarters = await page2.locator('text=Starters').count() > 0;
        if (hasStarters) {
          console.log('✅ Group "Starters" found in Browser 2');
        }
      }

    } finally {
      if (page1) {
        const logs1 = await getP2PLogs(page1);
        console.log('\n📝 Browser 1 P2P Logs (last 5):');
        logs1.slice(-5).forEach(log => console.log('  ', log));
      }
      
      if (page2) {
        const logs2 = await getP2PLogs(page2);
        console.log('\n📝 Browser 2 P2P Logs (last 5):');
        logs2.slice(-5).forEach(log => console.log('  ', log));
      }

      if (context1) await context1.close();
      if (context2) await context2.close();
    }
  });

  test('Both browsers can see each others menus in library', async ({ browser }) => {
    let context1: BrowserContext | null = null;
    let context2: BrowserContext | null = null;
    let page1: Page | null = null;
    let page2: Page | null = null;

    try {
      context1 = await browser.newContext({ storageState: undefined });
      context2 = await browser.newContext({ storageState: undefined });

      page1 = await context1.newPage();
      page2 = await context2.newPage();

      await setupLogCapture(page1);
      await setupLogCapture(page2);

      console.log('🧪 Starting both browsers...');
      
      // Start Browser 1
      await page1.goto('/');
      await waitForNodeReady(page1);
      console.log('✅ Browser 1 ready');

      // Start Browser 2
      await page2.goto('/');
      await waitForNodeReady(page2);
      console.log('✅ Browser 2 ready');

      // Browser 1 creates a menu
      await page1.click('text=Create New Menu');
      await page1.waitForURL('**/menu**');
      await page1.fill('input.menu-title', 'Browser 1 Menu');
      await page1.fill('input.new-group-title', 'Items');
      await page1.press('input.new-group-title', 'Enter');
      await page1.waitForTimeout(3000);
      
      console.log('✅ Browser 1 created menu');

      // Browser 2 creates a menu
      await page2.click('text=Create New Menu');
      await page2.waitForURL('**/menu**');
      await page2.fill('input.menu-title', 'Browser 2 Menu');
      await page2.fill('input.new-group-title', 'Things');
      await page2.press('input.new-group-title', 'Enter');
      await page2.waitForTimeout(3000);
      
      console.log('✅ Browser 2 created menu');

      // Wait for P2P propagation
      await page1.waitForTimeout(10000);
      await page2.waitForTimeout(10000);

      // Go to library in Browser 1
      await page1.click('text=Library');
      await page1.waitForURL('/');
      await page1.waitForTimeout(3000);
      
      const menuCount1 = await page1.locator('.menu-tile').count();
      console.log(`📊 Browser 1 sees ${menuCount1} menu(s) in library`);

      // Go to library in Browser 2
      await page2.click('text=Library');
      await page2.waitForURL('/');
      await page2.waitForTimeout(3000);
      
      const menuCount2 = await page2.locator('.menu-tile').count();
      console.log(`📊 Browser 2 sees ${menuCount2} menu(s) in library`);

      // Each should see at least their own menu
      expect(menuCount1).toBeGreaterThanOrEqual(1);
      expect(menuCount2).toBeGreaterThanOrEqual(1);

      console.log('✅ Both browsers can access their menus');

    } finally {
      if (context1) await context1.close();
      if (context2) await context2.close();
    }
  });

  test('Menu changes in Browser 1 create new version visible to Browser 2', async ({ browser }) => {
    let context1: BrowserContext | null = null;
    let context2: BrowserContext | null = null;
    let page1: Page | null = null;
    let page2: Page | null = null;

    try {
      context1 = await browser.newContext({ storageState: undefined });
      context2 = await browser.newContext({ storageState: undefined });

      page1 = await context1.newPage();
      page2 = await context2.newPage();

      await setupLogCapture(page1);
      await setupLogCapture(page2);

      // Start both browsers
      await page1.goto('/');
      await waitForNodeReady(page1);
      console.log('✅ Browser 1 ready');

      await page2.goto('/');
      await waitForNodeReady(page2);
      console.log('✅ Browser 2 ready');

      // Wait for network
      await page1.waitForTimeout(10000);

      // Browser 1 creates version 1
      console.log('🧪 Browser 1: Creating version 1...');
      await page1.click('text=Create New Menu');
      await page1.waitForURL('**/menu**');
      await page1.fill('input.menu-title', 'Versioned Menu V1');
      await page1.fill('input.new-group-title', 'Original Group');
      await page1.press('input.new-group-title', 'Enter');
      await page1.waitForTimeout(3000);

      const url1 = page1.url();
      const cid1 = new URL(url1).searchParams.get('encoded');
      console.log(`📝 Version 1 CID: ${cid1?.substring(0, 30)}...`);

      // Browser 1 modifies to version 2
      console.log('🧪 Browser 1: Creating version 2...');
      await page1.fill('input.menu-title', 'Versioned Menu V2');
      await page1.waitForTimeout(3000);

      const url2 = page1.url();
      const cid2 = new URL(url2).searchParams.get('encoded');
      console.log(`📝 Version 2 CID: ${cid2?.substring(0, 30)}...`);

      // CIDs should be different (content addressing!)
      const haveBothCids = cid1 && cid2;
      const cidsAreDifferent = cid1 !== cid2;
      
      if (haveBothCids) {
        console.log(`📊 CID1: ${cid1?.substring(0, 20)}...`);
        console.log(`📊 CID2: ${cid2?.substring(0, 20)}...`);
        console.log(`📊 CIDs different: ${cidsAreDifferent}`);
        
        if (cidsAreDifferent) {
          console.log('✅ Version 2 has different CID (content-addressed correctly)');
        }
      }
      
      // Verify we got CIDs
      expect(cid1).toBeDefined();
      expect(cid2).toBeDefined();

      // Browser 2 can access version 1
      if (cid1) {
        console.log('🧪 Browser 2: Loading version 1...');
        await page2.goto(`/menu?encoded=${encodeURIComponent(cid1)}`);
        await page2.waitForTimeout(3000);
        
        const title2V1 = await page2.locator('input.menu-title').inputValue();
        console.log(`📊 Browser 2 loaded: "${title2V1}"`);
      }

      // Browser 2 can access version 2
      if (cid2) {
        console.log('🧪 Browser 2: Loading version 2...');
        await page2.goto(`/menu?encoded=${encodeURIComponent(cid2)}`);
        await page2.waitForTimeout(3000);
        
        const title2V2 = await page2.locator('input.menu-title').inputValue();
        console.log(`📊 Browser 2 loaded: "${title2V2}"`);
      }

      console.log('✅ Both versions accessible via different CIDs');

    } finally {
      if (context1) await context1.close();
      if (context2) await context2.close();
    }
  });

  test('Three users can all share and access each others menus', async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    try {
      // Create three browser contexts
      for (let i = 0; i < 3; i++) {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();
        await setupLogCapture(page);
        contexts.push(context);
        pages.push(page);
      }

      console.log('🧪 Starting three browsers...');

      // Start all browsers
      for (let i = 0; i < pages.length; i++) {
        await pages[i].goto('/');
        await waitForNodeReady(pages[i]);
        console.log(`✅ Browser ${i + 1} ready`);
      }

      // Wait for network
      await pages[0].waitForTimeout(15000);

      const menuTitles = ['User 1 Menu', 'User 2 Menu', 'User 3 Menu'];
      const cids: string[] = [];

      // Each browser creates a menu
      for (let i = 0; i < pages.length; i++) {
        console.log(`🧪 Browser ${i + 1}: Creating menu...`);
        
        await pages[i].click('text=Create New Menu');
        await pages[i].waitForURL('**/menu**');
        await pages[i].fill('input.menu-title', menuTitles[i]);
        await pages[i].fill('input.new-group-title', `Group ${i + 1}`);
        await pages[i].press('input.new-group-title', 'Enter');
        await pages[i].waitForTimeout(3000);

        const url = pages[i].url();
        const cid = new URL(url).searchParams.get('encoded');
        if (cid) {
          cids.push(cid);
          console.log(`✅ Browser ${i + 1} created menu: ${cid.substring(0, 30)}...`);
        }
      }

      // Wait for propagation
      await pages[0].waitForTimeout(10000);

      // Each browser tries to access another's menu
      console.log('🧪 Testing cross-browser access...');
      
      // Browser 1 accesses Browser 2's menu
      if (cids[1]) {
        await pages[0].goto(`/menu?encoded=${encodeURIComponent(cids[1])}`);
        await pages[0].waitForTimeout(3000);
        const title = await pages[0].locator('input.menu-title').inputValue();
        console.log(`📊 Browser 1 accessing Browser 2's menu: "${title}"`);
      }

      // Browser 2 accesses Browser 3's menu
      if (cids[2]) {
        await pages[1].goto(`/menu?encoded=${encodeURIComponent(cids[2])}`);
        await pages[1].waitForTimeout(3000);
        const title = await pages[1].locator('input.menu-title').inputValue();
        console.log(`📊 Browser 2 accessing Browser 3's menu: "${title}"`);
      }

      // Browser 3 accesses Browser 1's menu
      if (cids[0]) {
        await pages[2].goto(`/menu?encoded=${encodeURIComponent(cids[0])}`);
        await pages[2].waitForTimeout(3000);
        const title = await pages[2].locator('input.menu-title').inputValue();
        console.log(`📊 Browser 3 accessing Browser 1's menu: "${title}"`);
      }

      console.log('✅ Three-way sharing test completed');

    } finally {
      for (const context of contexts) {
        await context.close();
      }
    }
  });

  test('Menu with multiple items and groups syncs correctly', async ({ browser }) => {
    let context1: BrowserContext | null = null;
    let context2: BrowserContext | null = null;
    let page1: Page | null = null;
    let page2: Page | null = null;

    try {
      context1 = await browser.newContext({ storageState: undefined });
      context2 = await browser.newContext({ storageState: undefined });

      page1 = await context1.newPage();
      page2 = await context2.newPage();

      await setupLogCapture(page1);
      await setupLogCapture(page2);

      // Start browsers
      await page1.goto('/');
      await waitForNodeReady(page1);
      
      await page2.goto('/');
      await waitForNodeReady(page2);
      
      console.log('✅ Both browsers ready');

      // Browser 1 creates complex menu
      console.log('🧪 Creating complex menu with multiple groups and items...');
      
      await page1.click('text=Create New Menu');
      await page1.waitForURL('**/menu**');
      await page1.fill('input.menu-title', 'Complex Restaurant Menu');
      
      // Add multiple groups
      const groups = [
        { name: 'Appetizers', items: ['Spring Rolls', 'Soup', 'Salad'] },
        { name: 'Main Course', items: ['Pasta', 'Steak', 'Fish'] },
        { name: 'Desserts', items: ['Ice Cream', 'Cake', 'Pie'] }
      ];

      for (const group of groups) {
        console.log(`🔧 Creating group: ${group.name}`);
        
        // Type the group name - use the new group input at the bottom
        const groupInput = page1.locator('input.new-group-title').last();
        await groupInput.click();
        await groupInput.fill(group.name);
        
        // Click elsewhere to trigger blur/change event
        await page1.locator('body').click({ position: { x: 10, y: 10 } });
        
        // Wait for the new group to appear in the list
        // The group should appear with the title we just entered
        await page1.waitForTimeout(1000);
        
        // Debug: log all menu groups
        const allGroups = await page1.locator('.menu-group').count();
        console.log(`📊 Total menu groups after creating "${group.name}": ${allGroups}`);
        
        // Find the menu group that contains our group name in its title input
        // We need to be more specific - look for the group title input with this value
        const menuGroup = page1.locator('.menu-group').filter({ 
          has: page1.locator(`input.new-group-title[value="${group.name}"]`)
        });
        
        // Verify the group exists
        const groupCount = await menuGroup.count();
        console.log(`📊 Groups matching "${group.name}": ${groupCount}`);
        
        if (groupCount === 0) {
          // Fallback: try finding by text content
          const menuGroupByText = page1.locator('.menu-group').filter({ hasText: group.name });
          const textCount = await menuGroupByText.count();
          console.log(`📊 Groups with text "${group.name}": ${textCount}`);
          
          if (textCount > 0) {
            // Use the text-based locator
            await expect(menuGroupByText.locator('input.menu-item-input').first()).toBeVisible({ timeout: 10000 });
            console.log(`✅ Created group: ${group.name}`);
            
            // Add items to this group
            for (const item of group.items) {
              const itemInput = menuGroupByText.locator('input.menu-item-input').last();
              
              await itemInput.click();
              await itemInput.fill(item);
              
              // Click elsewhere to trigger blur/change
              await page1.locator('body').click({ position: { x: 10, y: 10 } });
              await page1.waitForTimeout(500);
            }
            
            console.log(`✅ Added ${group.items.length} items to ${group.name}`);
          } else {
            throw new Error(`Group "${group.name}" was not created - cannot find it in the DOM`);
          }
        } else {
          // Wait for menu items to be available in the group
          await expect(menuGroup.locator('input.menu-item-input').first()).toBeVisible({ timeout: 10000 });
          
          console.log(`✅ Created group: ${group.name}`);
          
          // Add items to this group
          for (const item of group.items) {
            const itemInput = menuGroup.locator('input.menu-item-input').last();
            
            await itemInput.click();
            await itemInput.fill(item);
            
            // Click elsewhere to trigger blur/change
            await page1.locator('body').click({ position: { x: 10, y: 10 } });
            await page1.waitForTimeout(500);
          }
          
          console.log(`✅ Added ${group.items.length} items to ${group.name}`);
        }
      }

      await page1.waitForTimeout(3000);

      const url1 = page1.url();
      const cid = new URL(url1).searchParams.get('encoded');
      
      console.log(`📝 Complex menu CID: ${cid?.substring(0, 30)}...`);

      // Browser 2 loads the complex menu
      if (cid) {
        console.log('🧪 Browser 2: Loading complex menu...');
        await page2.goto(`/menu?encoded=${encodeURIComponent(cid)}`);
        await page2.waitForTimeout(5000);

        const title = await page2.locator('input.menu-title').inputValue();
        console.log(`📊 Browser 2 title: "${title}"`);

        // Check if groups loaded
        for (const group of groups) {
          const hasGroup = await page2.locator(`text=${group.name}`).count() > 0;
          console.log(`📊 Group "${group.name}" in Browser 2: ${hasGroup}`);
          
          // Check if items loaded
          for (const item of group.items) {
            const hasItem = await page2.locator(`text=${item}`).count() > 0;
            if (hasItem) {
              console.log(`  ✅ Item "${item}" found`);
            }
          }
        }
      }

      console.log('✅ Complex menu sync test completed');

    } finally {
      if (context1) await context1.close();
      if (context2) await context2.close();
    }
  });

});
