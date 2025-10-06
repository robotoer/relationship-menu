# P2P Connectivity Testing Guide

This guide provides comprehensive instructions for testing the peer-to-peer (P2P) connectivity features of the Relationship Menu application using Helia/IPFS.

## Overview

The application now uses Helia (a modern IPFS implementation) with full P2P capabilities, allowing multiple instances of the application to discover each other, connect, and share relationship menu data directly without a central server.

## Key Technologies

- **Helia**: Modern, modular IPFS implementation for browsers
- **libp2p**: Peer-to-peer networking stack
- **WebRTC**: Browser-to-browser communication
- **WebSockets**: Fallback transport mechanism
- **DHT (Distributed Hash Table)**: Peer and content discovery
- **Bootstrap Nodes**: Initial entry points into the network

## Automated Tests

### Running the Test Suite

```bash
npm test -- src/ipfs.test.ts
```

The test suite validates:
- Node creation with P2P capabilities
- Network statistics reporting
- Content storage and retrieval
- Error handling
- Hash calculation consistency

### Test Coverage

The tests ensure that:
1. Helia nodes are created successfully
2. Each node gets a unique peer ID
3. Network statistics are accurately reported
4. Documents can be saved and retrieved
5. Non-existent documents are handled gracefully

## Manual Testing on a Single Machine

### Option 1: Multiple Browser Windows

1. **Start the application:**
   ```bash
   npm start
   ```

2. **Open in first browser window:**
   - Navigate to `http://localhost:3000`
   - Open DevTools Console (F12)
   - Look for the startup message:
     ```
     🚀 IPFS node started
     📍 Peer ID: 12D3KooW...
     ```
   - Copy the Peer ID

3. **Open in a second browser window:**
   - Use an incognito/private window or different browser
   - Navigate to `http://localhost:3000`
   - Check the Console for peer discovery logs
   - You should see messages like:
     ```
     🔍 Discovered peer: 12D3KooW...
     ✅ Connected to peer: 12D3KooW...
     ```

4. **Test content sharing:**
   - In window 1: Create a relationship menu
   - Click "Share" and copy the CID (Content Identifier)
   - In window 2: Use the "Load from Network" feature
   - Paste the CID
   - The menu should load successfully

### Option 2: Multiple Browser Tabs

Browser tabs share the same origin, so this tests the application's ability to handle multiple instances in the same browser:

1. Open multiple tabs to `http://localhost:3000`
2. Each tab will create its own IPFS node
3. They should discover and connect to each other
4. Test data sharing between tabs

## Multi-Machine Testing

### Prerequisites

- Two or more computers on the same network OR different networks
- Each machine should have Node.js installed
- Firewall settings should allow WebRTC connections
- Modern browsers (Chrome, Firefox, Edge, Safari)

### Setup

#### Machine A (First Computer)

1. **Clone and setup:**
   ```bash
   git clone <repository-url>
   cd relationship-menu
   npm install
   npm start
   ```

2. **Open the application:**
   - Navigate to `http://localhost:3000`
   - Open DevTools Console (F12)

3. **Note the connection info:**
   - Peer ID: `📍 Peer ID: 12D3KooW...`
   - Listening addresses: `🔗 Listening on: [...]`
   - Copy the Peer ID for reference

4. **Monitor the network:**
   - Check the NetworkStatus component in the UI
   - It should show:
     - Status: Online (green dot)
     - Your Peer ID (truncated)
     - Connected Peers: 0 (initially)
     - Listening Addresses (expandable)

#### Machine B (Second Computer)

1. **Clone and setup:**
   ```bash
   git clone <repository-url>
   cd relationship-menu
   npm install
   npm start
   ```

2. **Open the application:**
   - Navigate to `http://localhost:3000`
   - Open DevTools Console (F12)

3. **Wait for peer discovery:**
   - Within 30-60 seconds, you should see:
     ```
     🔍 Discovered peer: <Machine A's Peer ID>
     ✅ Connected to peer: <Machine A's Peer ID>
     📊 Total connections: 1
     ```

4. **Verify connection on Machine A:**
   - Check Machine A's console
   - Should see similar connection messages
   - Both machines should now show "Connected Peers: 1"

### Testing Data Sharing Across Machines

#### Scenario 1: Share from Machine A to Machine B

1. **On Machine A:**
   - Create a new relationship menu
   - Fill in some items (e.g., "Communication", "Boundaries")
   - Click the "Share" button
   - Copy the generated CID (looks like: `bafybeig...`)
   - The CID is also logged in the console

2. **On Machine B:**
   - Open the "Load from Network" or "Import" feature
   - Paste the CID from Machine A
   - Click "Load"
   - The relationship menu should appear
   - This data was transferred directly P2P!

3. **Verification:**
   - Check Machine B's console for:
     ```
     Attempting to fetch document with id bafybeig... from IPFS network
     Retrieved and stored document with id: bafybeig... from network
     ```
   - The NetworkStatus should show the active connection

#### Scenario 2: Offline Persistence Test

1. **On Machine A:**
   - Create and share a menu (get the CID)
   - Keep the application running

2. **On Machine B:**
   - Close the application
   - Wait 30 seconds
   - Restart the application
   - Try to load the CID from Machine A
   - Should reconnect and retrieve the data

#### Scenario 3: Multiple Peers

If you have 3+ machines:

1. **Start the application on all machines**
2. **Each machine should:**
   - Discover all other peers
   - Show the correct connection count
   - Be able to fetch content from any other peer

3. **Test content availability:**
   - Create a menu on Machine A
   - Share the CID
   - Verify it can be loaded on Machines B, C, D, etc.

## Troubleshooting

### Peers Not Connecting

**Problem:** Machines don't discover each other

**Solutions:**
1. **Check network connectivity:**
   - Ensure machines can reach each other
   - Try pinging between machines

2. **Check firewall:**
   ```bash
   # On Linux/Mac, temporarily disable firewall for testing
   sudo ufw disable  # Ubuntu
   sudo systemctl stop firewalld  # CentOS/RHEL
   ```

3. **Check browser console:**
   - Look for WebRTC errors
   - Check for CORS issues
   - Verify no console errors during startup

4. **Verify bootstrap nodes:**
   - The console should show attempts to connect to bootstrap nodes
   - If bootstrap nodes are unreachable, peers may not discover each other

5. **Try different browsers:**
   - Some browsers have stricter WebRTC policies
   - Chrome and Firefox generally work best

### Content Not Loading

**Problem:** CID is shared but content doesn't load on other machine

**Solutions:**
1. **Verify the CID:**
   - Ensure the complete CID was copied
   - CIDs are long strings starting with "bafy..."

2. **Check connection:**
   - Ensure peers are still connected
   - Look for "Connected Peers: N" where N > 0

3. **Check console logs:**
   - Should show "Attempting to fetch document..."
   - Any errors will be logged

4. **Verify source peer is online:**
   - The machine that created the content must still be running
   - Content is stored in the browser's IndexedDB

### Performance Issues

**Problem:** Slow peer discovery or content transfer

**Solutions:**
1. **Network latency:**
   - Check network speed between machines
   - Try machines on the same local network first

2. **Browser resources:**
   - Close unnecessary tabs
   - Restart browser if it's been running long

3. **Content size:**
   - Large relationship menus may take longer
   - Check browser's IndexedDB storage limits

## Monitoring and Debugging

### Browser DevTools

**Console Logs:**
- `🚀` - Node started successfully
- `🔍` - Peer discovered
- `✅` - Peer connected
- `❌` - Peer disconnected
- `📊` - Connection statistics

**Network Tab:**
- Monitor WebRTC connections
- Check for failed requests

**Application Tab:**
- IndexedDB: Check stored CIDs and data
- Local Storage: Verify menu metadata

### NetworkStatus Component

The UI component shows real-time network information:
- **Online/Offline**: Green dot = connected to network
- **Peer ID**: Your node's unique identifier
- **Connected Peers**: Number of active connections
- **Peer List**: Shows up to 5 connected peer IDs
- **Listening Addresses**: All network addresses your node listens on

### Debug Mode

Enable verbose logging:
```javascript
// Add to browser console
localStorage.setItem('debug', 'helia:*,libp2p:*');
// Reload the page
```

## Network Topologies

### Same Network (LAN)
- Fastest connection
- Direct peer-to-peer via WebRTC
- No NAT traversal needed
- **Expected connection time:** 5-15 seconds

### Different Networks (WAN)
- Uses STUN/TURN servers for NAT traversal
- May use relay nodes
- Slightly slower but still works
- **Expected connection time:** 15-30 seconds

### Behind Corporate Firewalls
- May require WebSocket fallback
- Some corporate networks block WebRTC
- Test with mobile hotspot if blocked
- **Expected connection time:** 30-60 seconds (if works)

## Expected Behavior

### Successful Connection

When everything works correctly, you should see:

1. **Console Output:**
   ```
   🚀 IPFS node started
   📍 Peer ID: 12D3KooWAbcDef123...
   🔗 Listening on: [
     /ip4/127.0.0.1/tcp/...
     /webrtc/...
   ]
   🔍 Discovered peer: 12D3KooW...
   ✅ Connected to peer: 12D3KooW...
   📊 Total connections: 1
   ```

2. **UI Indicators:**
   - Green "Online" status
   - Peer count increases
   - Peer list populates
   - Listening addresses shown

3. **Data Transfer:**
   - CIDs can be shared
   - Content loads from other peers
   - No errors in console

## Performance Metrics

### Expected Timings

- **Node startup:** 2-5 seconds
- **Peer discovery (LAN):** 5-15 seconds
- **Peer discovery (WAN):** 15-30 seconds
- **Content retrieval (small):** < 1 second
- **Content retrieval (large):** 1-5 seconds

### Resource Usage

- **Memory:** ~50-100 MB per node
- **Storage:** IndexedDB (limited by browser)
- **Network:** Minimal when idle, burst during transfers

## Advanced Testing

### Stress Testing

Test with multiple peers:
```bash
# Terminal 1
PORT=3000 npm start

# Terminal 2
PORT=3001 npm start

# Terminal 3
PORT=3002 npm start

# etc.
```

Open each in a separate browser window.

### Network Simulation

Test under poor network conditions:
1. Use browser DevTools
2. Open Network tab
3. Set throttling (e.g., "Slow 3G")
4. Test peer discovery and content sharing

### Content Persistence

1. Create content on Machine A
2. Close Machine A
3. Wait 5 minutes
4. Try to load content on Machine B
   - Should fail (peer offline)
5. Restart Machine A
6. Retry on Machine B
   - Should succeed

## Security Considerations

- All connections use encrypted transports (Noise protocol)
- Peer IDs are cryptographically verifiable
- Content is addressed by cryptographic hash (CID)
- No central authority can modify content
- Public bootstrap nodes see your IP address

## Next Steps

After successful testing:
1. Deploy to production environments
2. Consider setting up dedicated bootstrap nodes
3. Implement content pinning services
4. Add peer reputation system
5. Implement content moderation tools

## Support

If you encounter issues not covered in this guide:
1. Check the browser console for specific errors
2. Review the test suite output
3. Check GitHub issues
4. Enable debug logging for detailed information

## Conclusion

This P2P setup enables true decentralized sharing of relationship menus. Users can share content directly without relying on central servers, providing better privacy, resilience, and user control.