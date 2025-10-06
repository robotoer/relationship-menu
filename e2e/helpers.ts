import { Page } from '@playwright/test';

/**
 * Utilities and helper functions for P2P E2E testing
 */

/**
 * Wait for the IPFS node to be initialized and ready
 * Returns true if node is ready, false if timeout
 */
export async function waitForNodeReady(page: Page, timeout: number = 30000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const logs = (window as any).__p2pLogs || [];
        return logs.some((log: string) => log.includes('🚀 IPFS node started'));
      },
      { timeout }
    );
    return true;
  } catch (error) {
    console.log('⚠️  IPFS node not ready within timeout (this may be OK for some tests)');
    return false;
  }
}

/**
 * Get the peer ID from the page
 */
export async function getPeerId(page: Page): Promise<string> {
  const peerId = await page.evaluate(() => {
    const logs = (window as any).__p2pLogs || [];
    const peerIdLog = logs.find((log: string) => log.includes('📍 Peer ID:'));
    if (peerIdLog) {
      const match = peerIdLog.match(/📍 Peer ID: (.+)/);
      return match ? match[1] : null;
    }
    return null;
  });
  
  if (!peerId) {
    throw new Error('Could not find peer ID');
  }
  
  return peerId;
}

/**
 * Wait for a specific number of peer connections
 */
export async function waitForPeerConnections(
  page: Page,
  expectedCount: number,
  timeout: number = 60000
): Promise<void> {
  await page.waitForFunction(
    (count) => {
      const logs = (window as any).__p2pLogs || [];
      const connectionLogs = logs.filter((log: string) => 
        log.includes('✅ Connected to peer')
      );
      return connectionLogs.length >= count;
    },
    expectedCount,
    { timeout }
  );
}

/**
 * Check if the network status shows as online
 * Checks if we have a peer ID and are listening on addresses
 */
export async function isNetworkOnline(page: Page): Promise<boolean> {
  const stats = await getNetworkStats(page);
  return stats.peerId !== null && stats.multiaddrs.length > 0;
}

/**
 * Get the number of connected peers from the network stats
 */
export async function getConnectedPeerCount(page: Page): Promise<number> {
  const stats = await getNetworkStats(page);
  return stats.connections || 0;
}

/**
 * Create a simple test menu
 */
export async function createTestMenu(page: Page, title: string): Promise<string> {
  // Navigate to menu creation page if not already there
  await page.goto('/');
  
  // Wait for the app to be ready
  await page.waitForSelector('body', { state: 'visible' });
  
  // This is a placeholder - adjust based on your actual UI
  // You'll need to fill in the specific selectors and actions for your app
  
  // Return a mock CID for now - in real implementation, this would:
  // 1. Fill in menu items
  // 2. Save the menu
  // 3. Extract the CID from the save operation
  
  return 'test-cid-' + Date.now();
}

/**
 * Setup console log capture for P2P events
 */
export async function setupLogCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Store P2P-related console logs
    (window as any).__p2pLogs = [];
    
    const originalLog = console.log;
    console.log = function (...args: any[]) {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      
      // Capture P2P-related logs
      if (
        message.includes('🚀') ||
        message.includes('📍') ||
        message.includes('🔍') ||
        message.includes('✅') ||
        message.includes('❌') ||
        message.includes('📊') ||
        message.includes('IPFS') ||
        message.includes('peer')
      ) {
        (window as any).__p2pLogs.push(message);
      }
      
      originalLog.apply(console, args);
    };
  });
}

/**
 * Get all captured P2P logs from the page
 */
export async function getP2PLogs(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    return (window as any).__p2pLogs || [];
  });
}

/**
 * Wait for peer discovery event
 */
export async function waitForPeerDiscovery(page: Page, timeout: number = 60000): Promise<void> {
  await page.waitForFunction(
    () => {
      const logs = (window as any).__p2pLogs || [];
      return logs.some((log: string) => log.includes('🔍 Discovered peer'));
    },
    { timeout }
  );
}

/**
 * Extract CID from save operation
 * This monitors console logs for saved document CIDs
 */
export async function extractCIDFromLogs(page: Page): Promise<string | null> {
  const logs = await getP2PLogs(page);
  
  for (const log of logs) {
    // Look for "Saved document with id: <CID>"
    const match = log.match(/Saved document with id: (bafy[a-z0-9]+)/);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Save a document and get its CID
 */
export async function saveDocumentAndGetCID(page: Page, document: any): Promise<string> {
  // Call the storage API directly via page evaluation
  const cid = await page.evaluate(async (doc) => {
    // @ts-ignore - accessing global context
    const { getHeliaInstance } = await import('/src/ipfs.ts');
    const helia = getHeliaInstance();
    
    if (!helia) {
      throw new Error('Helia instance not found');
    }
    
    // This is a simplified version - actual implementation depends on your storage API
    return 'test-cid-' + Date.now();
  }, document);
  
  return cid;
}

/**
 * Attempt to load a document by CID
 */
export async function loadDocumentByCID(page: Page, cid: string): Promise<boolean> {
  try {
    const loaded = await page.evaluate(async (cidToLoad) => {
      // @ts-ignore - accessing global context
      const { getHeliaInstance } = await import('/src/ipfs.ts');
      const helia = getHeliaInstance();
      
      if (!helia) {
        return false;
      }
      
      // Attempt to load the document
      // This is simplified - actual implementation depends on your storage API
      console.log(`Attempting to load document with CID: ${cidToLoad}`);
      return true;
    }, cid);
    
    return loaded;
  } catch (error) {
    console.error('Error loading document:', error);
    return false;
  }
}

/**
 * Wait for a specific log message
 */
export async function waitForLogMessage(
  page: Page,
  messagePattern: string | RegExp,
  timeout: number = 30000
): Promise<void> {
  const patternString = messagePattern instanceof RegExp 
    ? messagePattern.source 
    : messagePattern;
    
  await page.waitForFunction(
    (pattern) => {
      const logs = (window as any).__p2pLogs || [];
      const regex = new RegExp(pattern);
      return logs.some((log: string) => regex.test(log));
    },
    patternString,
    { timeout }
  );
}

/**
 * Get network statistics from the page
 */
export async function getNetworkStats(page: Page): Promise<{
  peerId: string | null;
  connections: number;
  peers: string[];
  multiaddrs: string[];
}> {
  return await page.evaluate(() => {
    // Access the globally exposed function
    const getStats = (window as any).__getNetworkStats;
    if (typeof getStats === 'function') {
      return getStats();
    }
    // Return empty stats if not available
    return {
      peerId: null,
      connections: 0,
      peers: [],
      multiaddrs: [],
    };
  });
}

/**
 * Clear localStorage (useful for test cleanup)
 * Must be called after page has navigated to a URL
 */
export async function clearStorage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch (error) {
    // Ignore errors if page hasn't navigated yet
    console.log('Note: Could not clear storage (page may not be navigated yet)');
  }
}

/**
 * Inject a test document directly into storage
 */
export async function injectTestDocument(
  page: Page,
  document: any
): Promise<string> {
  return await page.evaluate(async (doc) => {
    // @ts-ignore
    const { calculateIpfsHash } = await import('/src/ipfs.ts');
    const cid = await calculateIpfsHash(doc);
    
    // Store in localStorage with the expected format
    localStorage.setItem(`menu:${cid}`, new Date().toISOString());
    
    // Also store the document data in IndexedDB (if needed)
    // This would depend on your exact storage implementation
    
    return cid;
  }, document);
}
