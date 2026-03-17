#!/bin/bash
# E2E Test Setup Helper
# This script helps set up the environment for running E2E tests

set -e

echo "🔧 Setting up E2E test environment..."

# Step 1: Ensure Playwright browsers are installed
echo "📦 Checking Playwright browsers..."
if [ ! -d "/home/runner/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux" ]; then
    echo "❌ Chromium browser not found. Installing..."
    
    # Manual installation due to Playwright download progress bug
    echo "📥 Downloading Chromium manually..."
    wget -q -O /tmp/chromium.zip https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/chromium/1193/chromium-linux.zip
    
    echo "📂 Extracting Chromium..."
    mkdir -p /home/runner/.cache/ms-playwright/chromium_headless_shell-1193
    cd /home/runner/.cache/ms-playwright/chromium_headless_shell-1193
    unzip -q /tmp/chromium.zip
    
    echo "🔗 Creating headless_shell symlink..."
    cd chrome-linux
    ln -sf chrome headless_shell
    
    echo "✅ Chromium browser installed successfully"
else
    echo "✅ Chromium browser already installed"
fi

# Step 2: Kill any existing dev servers
echo "🧹 Cleaning up existing dev servers..."
pkill -f "react-scripts start" 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 2

echo "✨ E2E test environment ready!"
echo ""
echo "ℹ️  Note: E2E tests require P2P/IPFS functionality which may have limitations"
echo "ℹ️  due to ESM module compatibility issues with the current test setup."
echo ""
echo "To run tests:"
echo "  yarn test:e2e                    # Run all tests"
echo "  yarn test:e2e:headed             # Run with visible browser"
echo "  yarn test:e2e:ui                 # Run with Playwright UI"
