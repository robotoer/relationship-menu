# GitHub Copilot Instructions

This document provides guidance for GitHub Copilot when working with the relationship-menu codebase.

## Project Overview

The Relationship Menu is a React-based web application that helps people create, customize, and compare non-escalator relationship menus. The app supports creating custom relationship preferences, sharing them via URLs, and comparing multiple menus side-by-side.

## Technology Stack

- **Frontend Framework:** React 18.3.1 with TypeScript 4.9.5
- **Routing:** React Router DOM 6.23.1
- **Build Tool:** Create React App (react-scripts 5.0.1)
- **Package Manager:** Yarn 4.3.0 (PnP mode)
- **Component Documentation:** Storybook 8.1.6
- **Testing:** Jest + React Testing Library
- **E2E Testing:** Playwright (in sync branch)
- **P2P Storage:** Helia/IPFS (in sync branch)
- **Styling:** CSS (no framework)

## Code Style and Conventions

### General Principles
1. **Minimal Changes:** Make the smallest possible changes to achieve the goal
2. **Type Safety:** Use TypeScript types consistently throughout the codebase
3. **Functional Components:** Use functional components with hooks, not class components
4. **Immutability:** Prefer immutable data updates using spread operators
5. **Testing:** Write tests for new features and bug fixes

### File Organization
- **Components:** Place in `src/components/` with `.tsx` extension
- **Pages:** Place in `src/pages/` with `.tsx` extension
- **Models:** Place in `src/model/` with `.ts` extension
- **Providers:** Place in `src/providers/` with `.tsx` extension
- **Tests:** Co-locate test files with the files they test using `.test.ts` or `.test.tsx`
- **Storybook:** Co-locate stories with components using `.stories.tsx`

### Naming Conventions
- **Components:** PascalCase (e.g., `MenuPage`, `MenuItem`)
- **Files:** Match component names (e.g., `MenuPage.tsx`, `MenuItem.tsx`)
- **CSS Files:** Match component names (e.g., `MenuPage.css`, `MenuItem.css`)
- **Functions:** camelCase (e.g., `handleChange`, `compareMenus`)
- **Types/Interfaces:** PascalCase (e.g., `RelationshipMenu`, `MenuChange`)
- **Constants:** UPPER_SNAKE_CASE when truly constant

### Component Structure
```typescript
// 1. Imports
import { useState, useEffect } from "react";
import "./ComponentName.css";

// 2. Types
type ComponentProps = {
  prop1: string;
  prop2?: number;
};

// 3. Component
export const ComponentName = ({ prop1, prop2 }: ComponentProps) => {
  // 4. Hooks
  const [state, setState] = useState<string>("");
  
  // 5. Effects
  useEffect(() => {
    // Effect logic
  }, [dependencies]);
  
  // 6. Event handlers
  const handleAction = () => {
    // Handler logic
  };
  
  // 7. Render
  return (
    <div className="component-name">
      {/* JSX */}
    </div>
  );
};
```

### State Management
- Use `useState` for local component state
- Use `useContext` for shared state across components
- The `StorageProvider` context manages document storage
- Avoid prop drilling; use context for deeply nested state

### CSS Guidelines
- Use CSS modules or scoped class names
- Follow BEM-like naming: `.component-name__element--modifier`
- Keep styles co-located with components
- Use semantic color names in variables
- Prefer flexbox and grid for layouts

### Testing Guidelines
- Write unit tests for utility functions and helpers
- Write component tests using React Testing Library
- Test user interactions, not implementation details
- Use meaningful test descriptions
- Mock external dependencies and API calls

## Key Components and Their Responsibilities

### App.tsx
Main application component that handles:
- Routing setup
- Storage provider initialization
- Global state management
- Analytics tracking

### Pages
- **Library:** Lists all saved relationship menus
- **Menu:** Edits a single relationship menu
- **Compare:** Compares multiple relationship menus
- **About:** Information about the app

### Components
- **Navbar:** Navigation bar with links
- **MenuItem:** Individual menu item with value selection
- **MenuGroup:** Group of related menu items
- **MenuTile:** Visual representation of a menu in the library
- **SharePane:** UI for sharing menus via URL
- **CompareInput:** Input for adding menus to comparison
- **CompareSection:** Section showing comparison results

### Models
- **menu.ts:** Types for RelationshipMenu, RelationshipMenuItem, etc.
- **compare.ts:** Types for menu comparison

### Data Handling
- **data-encoder.ts:** Encodes/decodes menu data for URLs
- **data-comparer.ts:** Compares multiple menus
- **storage.ts:** Abstract storage interface
- **ipfs.ts:** IPFS-based storage implementation (sync branch)

## Important Implementation Details

### Menu Structure
```typescript
type RelationshipMenu = {
  [groupName: string]: RelationshipMenuGroup;
};

type RelationshipMenuGroup = RelationshipMenuItem[];

type RelationshipMenuItem = {
  item: string;
  value?: "must-have" | "like-to-have" | "maybe" | "off-limits";
};
```

### URL Encoding
- Menus are encoded in URLs using compressed base64
- Format: `?encoded={titleEncoded}:{menuEncoded}`
- Use `encodeData()` and `decodeData()` from `data-encoder.ts`

### Storage
- Local storage for menu persistence
- IPFS for P2P sharing (sync branch)
- Use the `Storage` interface for implementations

### State Updates
When updating menus, create new objects:
```typescript
// Good
const newMenu = { ...menu };
newMenu[group] = [...newMenu[group]];

// Bad (mutates state)
menu[group].push(newItem);
```

## Common Tasks

### Adding a New Component
1. Create `ComponentName.tsx` in appropriate directory
2. Create `ComponentName.css` for styles
3. Create `ComponentName.stories.tsx` for Storybook
4. Create `ComponentName.test.tsx` for tests
5. Export from the component file
6. Import and use in parent components

### Adding a New Feature
1. Check TODO.md for related tasks
2. Create a feature branch
3. Implement with tests
4. Update Storybook stories
5. Update documentation if needed
6. Submit a pull request

### Working with IPFS (sync branch)
- Use `createIpfsStorage()` to initialize
- Store documents with `saveDocuments()`
- Retrieve with `getDocuments()`
- Handle async operations properly

## Things to Avoid

❌ **Don't:**
- Mutate state directly
- Use class components
- Add dependencies without checking for vulnerabilities
- Remove working code without understanding it
- Skip writing tests for new features
- Use `any` type unless absolutely necessary
- Add console.log statements in production code
- Use npm (use yarn instead)

✅ **Do:**
- Use functional components with hooks
- Create new objects/arrays when updating state
- Run tests before committing
- Write meaningful commit messages
- Keep functions small and focused
- Use TypeScript types consistently
- Follow existing code patterns
- Check for peer dependency issues

## Building and Testing

### Development
```bash
yarn install        # Install dependencies
yarn start          # Start dev server
yarn storybook      # Start Storybook
```

### Testing
```bash
yarn test           # Run unit tests
yarn test --coverage # Run with coverage
```

### Building
```bash
yarn build          # Production build
```

### E2E Tests (sync branch)
```bash
yarn e2e            # Run Playwright tests
yarn e2e:ui         # Run with UI
yarn e2e:debug      # Run in debug mode
```

## CI/CD

- **GitHub Actions:** Runs on every push
- **Build:** Verifies production build
- **Tests:** Runs unit tests
- **Chromatic:** Visual regression testing
- **CodeQL:** Security scanning

## Resources

- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Storybook Documentation](https://storybook.js.org/docs/react/get-started/introduction)
- [IPFS Documentation](https://docs.ipfs.tech/) (for sync branch)

## Questions?

Refer to:
1. This document for coding guidelines
2. TODO.md for planned work and priorities
3. README.md for project overview and setup
4. Existing code for patterns and examples

---

**Last Updated:** 2025-10-22

**Note:** These instructions guide GitHub Copilot and developers working on this project. Keep them updated as the codebase evolves.
