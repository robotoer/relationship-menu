# Non-Escalator Relationship Menu

A React-based web application for creating, customizing, and comparing non-escalator relationship menus. This tool helps people define and communicate their relationship preferences in a clear, structured way.

**Live Demo:** [https://relationship-menu.vercel.app](https://relationship-menu.vercel.app)

## Overview

This app enables:
- ✨ Creating custom relationship menus with your preferences
- 🔗 Sharing menus via URLs (no account required)
- 📊 Comparing multiple relationship menus side-by-side
- 💾 Storing menus in browser local storage
- 🎨 Visual comparison with color-coded preferences

**Inspired by:** [Reddit post on relationship components menu](https://www.reddit.com/r/polyamory/comments/pwkdxp/v3_relationship_components_menu_last_update_for/)

## Features

### Menu Creation
- Add custom menu items grouped by category
- Set preferences for each item: must-have, like-to-have, maybe, or off-limits
- Create unlimited groups and items
- Edit titles and descriptions

### Sharing
- Share menus via URL (encoded in query parameters)
- No registration or backend required
- Recipients can view and create their own versions

### Comparison
- Compare multiple menus side-by-side
- Color-coded visualization shows where preferences align
- Easy to identify compatibility and differences

### Storage
- Local browser storage for menu persistence
- Import/export via URLs
- P2P/IPFS storage (in development on `sync` branch)

## Technology Stack

- **Frontend:** React 18.3.1 with TypeScript 4.9.5
- **Routing:** React Router DOM 6.23.1
- **Build Tool:** Create React App 5.0.1
- **Package Manager:** Yarn 4.3.0
- **Component Docs:** Storybook 8.1.6
- **Testing:** Jest + React Testing Library
- **CI/CD:** GitHub Actions + Chromatic
- **Hosting:** Vercel

## Getting Started

### Prerequisites

- Node.js 20.x or 22.x (see `.tool-versions` or `.nvmrc`)
- Yarn 4.3.0 (managed via corepack)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/robotoer/relationship-menu.git
   cd relationship-menu
   ```

2. **Install Node.js** (if using asdf)
   ```bash
   asdf install
   ```
   
   Or if using nvm:
   ```bash
   nvm install
   nvm use
   ```

3. **Install dependencies**
   ```bash
   yarn install
   ```

### Development

#### Run the development server
```bash
yarn start
```
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload when you make edits. You'll see lint errors in the console.

#### Run Storybook
```bash
yarn storybook
```
Open [http://localhost:6006](http://localhost:6006) to view component documentation.

#### Run tests
```bash
yarn test
```
Launches the test runner in interactive watch mode.

For coverage:
```bash
yarn test --coverage
```

### Building

#### Create production build
```bash
yarn build
```
Builds the app for production to the `build` folder. The build is minified and optimized.

#### Serve production build locally
```bash
yarn dlx serve -s build
```

## Project Structure

```
relationship-menu/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable UI components
│   ├── pages/           # Page-level components
│   ├── model/           # TypeScript types and models
│   ├── providers/       # React context providers
│   ├── data-encoder.ts  # URL encoding/decoding utilities
│   ├── data-comparer.ts # Menu comparison logic
│   ├── storage.ts       # Storage interface
│   └── App.tsx          # Main application component
├── .storybook/          # Storybook configuration
├── TODO.md              # Task tracking and roadmap
├── copilot-instructions.md # Coding guidelines
└── README.md            # This file
```

## Documentation

- **[TODO.md](TODO.md)** - Project roadmap and remaining tasks
- **[copilot-instructions.md](copilot-instructions.md)** - Coding guidelines and best practices
- **[Storybook](http://localhost:6006)** - Component documentation (run `yarn storybook`)

## Contributing

Contributions are welcome! Please:

1. Check [TODO.md](TODO.md) for planned work
2. Read [copilot-instructions.md](copilot-instructions.md) for coding guidelines
3. Create a feature branch
4. Write tests for new features
5. Submit a pull request

## Development Tips

### Yarn 4.3.0 (PnP Mode)
This project uses Yarn with Plug'n'Play (PnP) mode. If you encounter module resolution issues:
- Make sure you're using Yarn 4.3.0 (check with `yarn --version`)
- Run `yarn install` to ensure all dependencies are properly linked
- Use `yarn dlx` instead of `npx` for one-off command execution

### IDE Setup
For better TypeScript support with Yarn PnP:
- VSCode: Install the Yarn PnP extension
- Other editors: Run `yarn sdks` to generate SDK files

### Common Commands
```bash
yarn start              # Start development server
yarn test               # Run tests
yarn build              # Create production build
yarn storybook          # Start component documentation
yarn install --immutable # Install deps without modifications
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- Inspired by the non-escalator relationship menu concept from the polyamory community
- Built with [Create React App](https://create-react-app.dev/)
- Component documentation powered by [Storybook](https://storybook.js.org/)

## Support

- **Issues:** [GitHub Issues](https://github.com/robotoer/relationship-menu/issues)
- **Discussions:** [GitHub Discussions](https://github.com/robotoer/relationship-menu/discussions)

---

**Note:** This app is designed for desktop browsers and is not currently optimized for mobile devices.
