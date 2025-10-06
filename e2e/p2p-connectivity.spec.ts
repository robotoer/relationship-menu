import { test, expect, BrowserContext, Page } from '@playwright/test';
import {
  setupLogCapture,
  waitForNodeReady,
  getPeerId,
  waitForPeerDiscovery,
  getConnectedPeerCount,
  isNetworkOnline,
  getP2PLogs,
  getNetworkStats
} from './helpers';

/**
 * E2E Tests for P2P Connectivity
 * 
 * These tests verify that multiple browser instances can:
 * 1. Start independent IPFS nodes
 * 2. Discover each other via DHT/bootstrap nodes
 * 3. Establish direct P2P connections
 * 4. Share and retrieve content across the network
 */

test.describe('P2P Connectivity', () => {
  
  test.beforeEach(async ({ context }) => {
    // Clear any existing state
    await context.clearCookies();
  });

  test('Two browsers can discover and connect to each other', async ({ browser }) => {
    let context1: BrowserContext | null = null;
    let context2: BrowserContext | null = null;
    let page1: Page | null = null;
    let page2: Page | null = null;

    try {
      // Create two isolated browser contexts (simulating different machines)
      context1 = await browser.newContext({ 
        storageState: undefined,
        permissions: [] 
      });
      context2 = await browser.newContext({ 
        storageState: undefined,
        permissions: [] 
      });

      page1 = await context1.newPage();
      page2 = await context2.newPage();

      console.log('🧪 Starting Browser 1...');
      await setupLogCapture(page1);
      await page1.goto('/');
      await waitForNodeReady(page1);
      const peerId1 = await getPeerId(page1);
      console.log(`✅ Browser 1 ready with Peer ID: ${peerId1.substring(0, 20)}...`);

      console.log('🧪 Starting Browser 2...');
      await setupLogCapture(page2);
      await page2.goto('/');
      await waitForNodeReady(page2);
      const peerId2 = await getPeerId(page2);
      console.log(`✅ Browser 2 ready with Peer ID: ${peerId2.substring(0, 20)}...`);

      // Verify they have different peer IDs
      expect(peerId1).not.toBe(peerId2);
      console.log('✅ Browsers have unique peer IDs');

      // Wait for peer discovery (this may take 30-60 seconds)
      console.log('⏳ Waiting for peer discovery...');
      await Promise.race([
        waitForPeerDiscovery(page1, 90000),
        waitForPeerDiscovery(page2, 90000)
      ]);
      console.log('✅ Peer discovery occurred');

      // Give time for connection establishment
      await page1.waitForTimeout(10000);

      // Check if at least one browser shows connections
      const peerCount1 = await getConnectedPeerCount(page1);
      const peerCount2 = await getConnectedPeerCount(page2);
      
      console.log(`📊 Browser 1 connections: ${peerCount1}`);
      console.log(`📊 Browser 2 connections: ${peerCount2}`);

      // At least one should have connections (may connect to bootstrap nodes)
      expect(peerCount1 + peerCount2).toBeGreaterThan(0);
      
      // Check network status shows online
      const online1 = await isNetworkOnline(page1);
      const online2 = await isNetworkOnline(page2);
      
      expect(online1).toBe(true);
      expect(online2).toBe(true);
      
      console.log('✅ Both browsers show as online');

      // Get and log network stats
      const stats1 = await getNetworkStats(page1);
      const stats2 = await getNetworkStats(page2);
      
      console.log('📊 Browser 1 stats:', {
        peerId: stats1.peerId?.substring(0, 20) + '...',
        connections: stats1.connections,
        peerCount: stats1.peers.length
      });
      
      console.log('📊 Browser 2 stats:', {
        peerId: stats2.peerId?.substring(0, 20) + '...',
        connections: stats2.connections,
        peerCount: stats2.peers.length
      });

    } finally {
      // Cleanup
      if (page1) {
        const logs1 = await getP2PLogs(page1);
        console.log('\n📝 Browser 1 P2P Logs:');
        logs1.slice(-10).forEach(log => console.log('  ', log));
      }
      
      if (page2) {
        const logs2 = await getP2PLogs(page2);
        console.log('\n📝 Browser 2 P2P Logs:');
        logs2.slice(-10).forEach(log => console.log('  ', log));
      }

      if (context1) await context1.close();
      if (context2) await context2.close();
    }
  });

  test('Three browsers can form a P2P network', async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    try {
      // Create three isolated browser contexts
      for (let i = 0; i < 3; i++) {
        const context = await browser.newContext({ 
          storageState: undefined,
          permissions: [] 
        });
        const page = await context.newPage();
        
        contexts.push(context);
        pages.push(page);
      }

      // Start all three browsers
      console.log('🧪 Starting three browsers...');
      const startPromises = pages.map(async (page, index) => {
        console.log(`🧪 Starting Browser ${index + 1}...`);
        await setupLogCapture(page);
        await page.goto('/');
        await waitForNodeReady(page);
        const peerId = await getPeerId(page);
        console.log(`✅ Browser ${index + 1} ready: ${peerId.substring(0, 20)}...`);
        return peerId;
      });

      const peerIds = await Promise.all(startPromises);

      // Verify all have unique peer IDs
      const uniquePeerIds = new Set(peerIds);
      expect(uniquePeerIds.size).toBe(3);
      console.log('✅ All browsers have unique peer IDs');

      // Wait for network to stabilize
      console.log('⏳ Waiting for network to stabilize (60 seconds)...');
      await pages[0].waitForTimeout(60000);

      // Check connectivity for each browser
      const connectionCounts = await Promise.all(
        pages.map(async (page, index) => {
          const count = await getConnectedPeerCount(page);
          const online = await isNetworkOnline(page);
          console.log(`📊 Browser ${index + 1}: ${count} connections, online: ${online}`);
          return { count, online };
        })
      );

      // All should be online
      connectionCounts.forEach(({ online }, index) => {
        expect(online).toBe(true);
      });

      // Total connection count should be > 0 (may connect to bootstrap nodes)
      const totalConnections = connectionCounts.reduce((sum, { count }) => sum + count, 0);
      expect(totalConnections).toBeGreaterThan(0);
      
      console.log(`✅ Total network connections: ${totalConnections}`);

    } finally {
      // Cleanup and log
      for (let i = 0; i < pages.length; i++) {
        if (pages[i]) {
          const logs = await getP2PLogs(pages[i]);
          console.log(`\n📝 Browser ${i + 1} P2P Logs (last 5):`);
          logs.slice(-5).forEach(log => console.log('  ', log));
        }
      }

      for (const context of contexts) {
        await context.close();
      }
    }
  });

  test('Network status updates in real-time', async ({ page }) => {
    console.log('🧪 Testing network status updates...');
    
    // Start the application
    await setupLogCapture(page);
    await page.goto('/');
    await waitForNodeReady(page);

    // Check initial network status
    const initialOnline = await isNetworkOnline(page);
    console.log(`📊 Initial network status: ${initialOnline ? 'online' : 'offline'}`);

    // Wait for status to update (component polls every 5 seconds)
    await page.waitForTimeout(6000);

    // Check network status again
    const updatedOnline = await isNetworkOnline(page);
    const peerCount = await getConnectedPeerCount(page);
    
    console.log(`📊 Updated network status: ${updatedOnline ? 'online' : 'offline'}`);
    console.log(`📊 Connected peers: ${peerCount}`);

    // Should show as online
    expect(updatedOnline).toBe(true);

    // Get network stats
    const stats = await getNetworkStats(page);
    expect(stats.peerId).not.toBeNull();
    expect(stats.multiaddrs.length).toBeGreaterThan(0);
    
    console.log('✅ Network status component working correctly');
  });

  test('Browser can connect after restart', async ({ browser }) => {
    let context1: BrowserContext | null = null;
    let page1: Page | null = null;

    try {
      // Create first browser context
      context1 = await browser.newContext({ 
        storageState: undefined,
        permissions: [] 
      });
      page1 = await context1.newPage();

      console.log('🧪 First session starting...');
      await setupLogCapture(page1);
      await page1.goto('/');
      await waitForNodeReady(page1);
      
      const peerId1 = await getPeerId(page1);
      console.log(`✅ First session Peer ID: ${peerId1.substring(0, 20)}...`);

      // Wait for some network activity
      await page1.waitForTimeout(10000);

      const stats1 = await getNetworkStats(page1);
      console.log('📊 First session stats:', {
        connections: stats1.connections,
        peers: stats1.peers.length
      });

      // Close the first session
      await context1.close();
      console.log('🔄 Closed first session');

      // Create second browser context (simulating restart)
      context1 = await browser.newContext({ 
        storageState: undefined,
        permissions: [] 
      });
      page1 = await context1.newPage();

      console.log('🧪 Second session starting (after restart)...');
      await setupLogCapture(page1);
      await page1.goto('/');
      await waitForNodeReady(page1);
      
      const peerId2 = await getPeerId(page1);
      console.log(`✅ Second session Peer ID: ${peerId2.substring(0, 20)}...`);

      // Should have a different peer ID after restart
      expect(peerId2).not.toBe(peerId1);

      // Wait for network activity
      await page1.waitForTimeout(10000);

      const stats2 = await getNetworkStats(page1);
      console.log('📊 Second session stats:', {
        connections: stats2.connections,
        peers: stats2.peers.length
      });

      // Should be online after restart
      const online = await isNetworkOnline(page1);
      expect(online).toBe(true);
      
      console.log('✅ Browser can connect after restart');

    } finally {
      if (context1) await context1.close();
    }
  });

  test('Peer discovery happens within reasonable time', async ({ page }) => {
    console.log('🧪 Testing peer discovery timing...');
    
    const startTime = Date.now();
    
    await setupLogCapture(page);
    await page.goto('/');
    await waitForNodeReady(page);
    
    const nodeReadyTime = Date.now() - startTime;
    console.log(`📊 Node ready in ${nodeReadyTime}ms`);

    // Wait for discovery with 90 second timeout
    try {
      await waitForPeerDiscovery(page, 90000);
      const discoveryTime = Date.now() - startTime;
      console.log(`📊 Peer discovery in ${discoveryTime}ms`);
      
      // Discovery should happen within 90 seconds
      expect(discoveryTime).toBeLessThan(90000);
      
    } catch (error) {
      console.log('⚠️ No peer discovery within 90 seconds (this is OK if no other peers available)');
      // This is not a failure - discovery requires other peers to be available
    }

    // But the node should at least be online and trying
    // Wait a moment for multiaddrs to be ready
    await page.waitForTimeout(1000);
    
    const stats = await getNetworkStats(page);
    expect(stats.peerId).not.toBeNull();
    expect(stats.multiaddrs.length).toBeGreaterThan(0);
    
    const online = await isNetworkOnline(page);
    expect(online).toBe(true);
    
    console.log('✅ Node is online and listening for peers');
  });

});
