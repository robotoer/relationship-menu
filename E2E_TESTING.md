# E2E Testing Guide

This guide explains how to run and interpret the end-to-end (E2E) tests that validate P2P connectivity between multiple browser instances.

## Overview

The E2E tests use Playwright to simulate multiple users on different machines/browsers connecting to each other via the P2P network. These tests verify:

- ✅ Multiple browser instances can start independent IPFS nodes
- ✅ Nodes can discover each other via DHT and bootstrap nodes
- ✅ Direct P2P connections are established
- ✅ Network status updates correctly in real-time
- ✅ Nodes can reconnect after restart

## Prerequisites

Make sure you have installed the test dependencies:

```bash
yarn install
npx playwright install chromium
```

## Running the Tests

### Run all E2E tests

```bash
npx playwright test
```

### Run tests with UI mode (interactive)

```bash
npx playwright test --ui
```

### Run tests in headed mode (see browsers)

```bash
npx playwright test --headed
```

### Run a specific test file

```bash
npx playwright test e2e/p2p-connectivity.spec.ts
```

### Run a specific test

```bash
npx playwright test -g "Two browsers can discover"
```

### Run with debug mode

```bash
npx playwright test --debug
```

## Test Structure

### `e2e/p2p-connectivity.spec.ts`

Main P2P connectivity test suite with the following tests:

1. **Two browsers can discover and connect to each other**
   - Creates two isolated browser contexts
   - Waits for both nodes to start
   - Verifies peer discovery occurs
   - Checks that both show as online
   - Duration: ~90-120 seconds

2. **Three browsers can form a P2P network**
   - Creates three isolated browser contexts
   - Verifies all have unique peer IDs
   - Waits for network to stabilize
   - Checks that all nodes are online
   - Duration: ~90-120 seconds

3. **Network status updates in real-time**
   - Verifies the NetworkStatus component polls correctly
   - Checks that network stats are displayed
   - Duration: ~15-20 seconds

4. **Browser can connect after restart**
   - Simulates closing and reopening a browser
   - Verifies new peer ID is generated
   - Checks that connection still works
   - Duration: ~30-40 seconds

5. **Peer discovery happens within reasonable time**
   - Measures time to node startup and peer discovery
   - Verifies discovery occurs within 90 seconds
   - Duration: ~90-120 seconds

### `e2e/helpers.ts`

Utility functions for E2E tests:

- `setupLogCapture(page)` - Captures console logs related to P2P events
- `waitForNodeReady(page)` - Waits for IPFS node initialization
- `getPeerId(page)` - Extracts peer ID from logs
- `waitForPeerDiscovery(page)` - Waits for peer discovery event
- `getConnectedPeerCount(page)` - Gets number of connected peers from UI
- `isNetworkOnline(page)` - Checks if network status shows online
- `getNetworkStats(page)` - Gets full network statistics
- `clearStorage(page)` - Clears localStorage/sessionStorage

## Understanding Test Results

### Success Indicators

When tests pass, you'll see output like:

```
✅ Browser 1 ready with Peer ID: QmXXXXXX...
✅ Browser 2 ready with Peer ID: QmYYYYYY...
✅ Browsers have unique peer IDs
⏳ Waiting for peer discovery...
✅ Peer discovery occurred
📊 Browser 1 connections: 3
📊 Browser 2 connections: 2
✅ Both browsers show as online
```

### Common Issues

#### 1. Timeout waiting for peer discovery

```
Error: page.waitForFunction: Timeout 90000ms exceeded.
```

**Cause**: No other peers available to connect to, or network connectivity issues.

**Solution**: 
- This is expected if testing in isolation (no bootstrap nodes reachable)
- Check your internet connection
- Try increasing the timeout in the test
- Verify bootstrap nodes are accessible

#### 2. Node fails to start

```
Error: Could not find peer ID
```

**Cause**: IPFS node didn't initialize properly.

**Solution**:
- Check browser console for errors
- Verify all dependencies are installed
- Try clearing browser storage
- Check if dev server is running correctly

#### 3. Browsers not connecting to each other

**Cause**: P2P connections blocked by firewall/network.

**Solution**:
- Browser-to-browser connections require WebRTC
- Check browser console for WebRTC errors
- Verify no browser extensions are blocking WebRTC
- Check if running behind corporate proxy/firewall

## Test Configuration

The tests are configured in `playwright.config.ts`:

```typescript
{
  timeout: 120000,           // 2 minutes per test
  fullyParallel: false,     // Run tests sequentially
  retries: 0,               // No retries for P2P tests
  workers: 1,               // Single worker for sequential execution
}
```

### Browser Launch Options

WebRTC-specific flags are enabled:

```typescript
{
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-web-security'
  ]
}
```

## Debugging Failed Tests

### View test traces

After a test failure, view the trace:

```bash
npx playwright show-trace test-results/...../trace.zip
```

### Run with verbose logging

```bash
DEBUG=pw:api npx playwright test
```

### Inspect browser console

The tests capture P2P-related console logs. Check the test output for:

```
📝 Browser 1 P2P Logs:
  🚀 IPFS node started
  📍 Peer ID: QmXXXXXX...
  🔍 Discovered peer: QmYYYYYY...
  ✅ Connected to peer: QmYYYYYY...
```

### Take manual screenshots

Add this to the test:

```typescript
await page.screenshot({ path: 'screenshot.png', fullPage: true });
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: yarn install
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Performance Expectations

P2P connections take time to establish. Expected durations:

- **Node startup**: 2-5 seconds
- **Peer discovery**: 15-60 seconds
- **Connection establishment**: 5-30 seconds
- **Total time for 2 nodes to connect**: 30-90 seconds

These times depend on:
- Network conditions
- Bootstrap node availability
- Number of DHT nodes online
- WebRTC NAT traversal complexity

## Best Practices

1. **Run tests sequentially** - P2P tests can interfere with each other if run in parallel
2. **Use adequate timeouts** - 90-120 seconds is reasonable for P2P operations
3. **Don't retry failed tests** - P2P timing is variable, retries can be misleading
4. **Check logs on failure** - Console logs contain valuable P2P event information
5. **Test in isolation first** - Run a single test to verify setup before running full suite

## Advanced Testing

### Testing with Docker Compose

For true multi-machine simulation, you can use Docker Compose:

```yaml
# docker-compose.yml
version: '3.8'
services:
  browser1:
    image: mcr.microsoft.com/playwright:v1.55.1
    command: npx playwright test --project=chromium
    volumes:
      - .:/app
    working_dir: /app
    
  browser2:
    image: mcr.microsoft.com/playwright:v1.55.1
    command: npx playwright test --project=chromium
    volumes:
      - .:/app
    working_dir: /app
```

Run with:

```bash
docker-compose up
```

### Testing with Real Browsers

To test with real browsers on different machines:

1. Start the app on multiple machines:
   ```bash
   npm start
   ```

2. Open browsers and navigate to the app
3. Monitor the NetworkStatus component
4. Verify connections in browser console

## Reporting

### HTML Report

View the HTML report after tests run:

```bash
npx playwright show-report
```

### JSON Report

The JSON report is saved to `test-results/results.json` and contains:

- Test execution times
- Pass/fail status
- Error messages
- Console logs

## Troubleshooting

### Tests hang indefinitely

- Check if dev server is running (`npm start`)
- Verify port 3000 is not in use by another process
- Check Playwright browser installation: `npx playwright install --with-deps`

### WebRTC errors in console

- Ensure browser launch options include WebRTC flags (already configured)
- Check if browser extensions are interfering
- Try with different Chromium flags

### Connection timeouts

- Increase timeout in test: `waitForPeerDiscovery(page, 120000)`
- Check internet connection
- Verify bootstrap nodes are reachable

## Next Steps

After running the E2E tests:

1. Review the test output and logs
2. Check the HTML report for detailed results
3. Fix any failures before deploying
4. Consider adding more tests for specific features
5. Integrate tests into your CI/CD pipeline

## Support

For issues or questions:

1. Check the main [P2P_TESTING_GUIDE.md](./P2P_TESTING_GUIDE.md)
2. Review [P2P_IMPLEMENTATION.md](./P2P_IMPLEMENTATION.md) for technical details
3. Check browser console for P2P-specific logs
4. File an issue with test output and logs
