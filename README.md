# Non-Escalator Relationship Menu

A decentralized, peer-to-peer application for creating, editing, sharing, and comparing non-escalator relationship menus. Built with React and powered by IPFS/Helia for true P2P data sharing without a backend server.

Based off of this reddit post: https://www.reddit.com/r/polyamory/comments/pwkdxp/v3_relationship_components_menu_last_update_for/

## Features

- 🎨 **Create Custom Relationship Menus** - Define your relationship preferences with custom groups and items
- 🔄 **Peer-to-Peer Sharing** - Share menus directly with others via P2P (no server required)
- 📊 **Compare Menus** - Compare your menu with others to find compatibility
- 💾 **Automatic Saving** - Content-addressed storage via IPFS ensures data integrity
- 🌐 **Decentralized** - Works entirely in the browser, data stored on IPFS network
- 🔗 **Shareable Links** - Share menus via URLs with encoded content

## Technology Stack

- **Frontend**: React 18 with TypeScript
- **P2P Networking**: Helia (IPFS) with libp2p
- **Routing**: React Router v6
- **Styling**: CSS with responsive design
- **Testing**: Playwright E2E tests (16 tests, 100% passing)
- **Build Tool**: Create React App

## Getting Started

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

### Prerequisites

```bash
# Install correct Node.js version
asdf install
```

### Installation

```bash
# Install dependencies
yarn install
```

## Available Scripts

### `yarn start`

Runs the app in development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You will also see any lint errors in the console.

### `yarn test`

Launches the Jest test runner in interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `yarn run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

### `yarn storybook`

Runs the Storybook component explorer in development mode.\
Open [http://localhost:6006](http://localhost:6006) to view it in your browser.

Useful for developing and testing UI components in isolation.

## Testing

### Unit Tests

```bash
# Run Jest unit tests
yarn test

# Run unit tests in watch mode
yarn test --watch
```

**Note**: IPFS-related unit tests are currently skipped due to ESM module compatibility issues with Jest. See `src/ipfs.test.ts` for details.

### E2E Tests with Playwright

The application has comprehensive end-to-end test coverage:

```bash
# First-time setup: Install Playwright browsers
# Note: If you encounter download issues, use the setup script:
./e2e/setup.sh

# Run all E2E tests
yarn test:e2e

# Run P2P connectivity tests (5 tests, ~2 minutes)
yarn test:e2e e2e/p2p-connectivity.spec.ts

# Run application workflow tests (11 tests, ~1.5 minutes)
yarn test:e2e e2e/application-workflow.spec.ts

# Run with UI
yarn test:e2e:ui

# Run in headed mode (see the browser)
yarn test:e2e:headed
```

**Known Issues**:
- Playwright browser download may fail due to a progress display bug in version 1.55.1
- Use `./e2e/setup.sh` for manual browser installation if needed
- E2E tests depend on P2P/IPFS functionality which has ESM limitations in the test environment

See [E2E_TEST_RESULTS.md](./E2E_TEST_RESULTS.md) for detailed test documentation.

## Documentation

- [E2E Test Results](./E2E_TEST_RESULTS.md) - Comprehensive test results and metrics
- [Application Workflow Tests](./E2E_APPLICATION_TESTS.md) - Detailed UI workflow test documentation
- [E2E Testing Guide](./E2E_TESTING.md) - Guide for writing and running E2E tests
- [P2P Implementation Guide](./P2P_IMPLEMENTATION.md) - P2P architecture and implementation details
- [P2P Quick Start](./P2P_QUICKSTART.md) - Quick guide to P2P functionality
- [P2P Testing Guide](./P2P_TESTING_GUIDE.md) - Guide for testing P2P features

## Architecture

### P2P Networking

The application uses Helia (IPFS) with libp2p for peer-to-peer networking:

- **Content Addressing**: Menus are stored with cryptographic hashes (CIDs)
- **Peer Discovery**: Automatic peer discovery via DHT and bootstrap nodes
- **Data Sharing**: Direct peer-to-peer data transfer via WebRTC
- **Persistence**: Content is distributed across the IPFS network

### State Management

- **URL-Based State**: Menu state encoded in URL query parameters
- **Local Storage**: Menus saved to browser localStorage
- **IPFS Storage**: Menus published to IPFS for sharing

## Development

### Project Structure

```
src/
├── components/      # Reusable UI components
├── pages/          # Page-level components
├── model/          # Data models and types
├── providers/      # React context providers
├── ipfs.ts         # IPFS/Helia initialization
├── storage.ts      # Storage layer (localStorage + IPFS)
└── App.tsx         # Main application component

e2e/
├── application-workflow.spec.ts  # UI workflow tests
├── p2p-connectivity.spec.ts      # P2P networking tests
├── multi-user-sharing.spec.ts    # Multi-user integration tests
└── helpers.ts                     # Test utilities
```

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- All tests pass (`npx playwright test`)
- Code follows existing style
- New features include tests
- Documentation is updated

## License

MIT - See LICENSE file for details.

## Acknowledgments

- Inspired by the non-escalator relationship framework
- Built with Create React App
- P2P networking powered by IPFS/Helia
- UI components developed with Storybook

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.
