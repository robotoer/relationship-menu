# TODO

This document tracks remaining tasks and improvements for the relationship-menu project.

## High Priority

### Code Quality & Cleanup
- [ ] Merge PR #31: Remove debug logs, legacy code, and outdated test files
  - Remove debug console.log statements from production code
  - Remove commented out legacy code
  - Remove outdated .backup e2e test files
  - Fix playwright.config.ts: change 'npm start' to 'yarn start'
  - Fix useEffect dependencies in App.tsx
  - Fix createIpfsStorage() call in index.tsx
  - Fix debounce test timing issues
  - Add reset step for singleton in ipfs.test.ts
  - Rename JSON import in ipfs.ts to avoid shadowing
  - Use optional chaining for localStorage.key access
  - Remove broken documentation links from README

### Dependency Updates
- [ ] Review and merge PR #29: Bump @types/jest from 27.5.2 to 29.5.13
- [ ] Review and merge PR #28: Bump typescript from 4.9.5 to 5.6.2
- [ ] Review and merge PR #27: Bump react-router-dom from 6.23.1 to 6.26.2
- [ ] Review and merge PR #26: Bump webpack from 5.92.0 to 5.94.0
- [ ] Review and merge PR #25: Bump @testing-library/jest-dom from 5.17.0 to 6.5.0
- [ ] Update browserslist database (run: `yarn dlx update-browserslist-db@latest`)

### P2P/IPFS Features
- [ ] Review and merge PR #23: P2P/IPFS-backed menu storage and sharing
  - Network Status UI showing peer info and addresses
  - URL/CID loading capabilities
  - Storage provider readiness, saving state, and error reporting
  - Comprehensive Playwright E2E test suites
  - Multi-user sharing functionality

## Medium Priority

### UI/UX Improvements
- [ ] Review and merge PR #16: Add delete button for menu items
- [ ] Improve mobile responsiveness (currently not optimized)
- [ ] Add loading states for async operations
- [ ] Improve error handling and user feedback
- [ ] Add confirmation dialogs for destructive actions

### Features
- [ ] Implement menu item reordering within groups
- [ ] Add bulk operations (select multiple items, delete multiple items)
- [ ] Add search/filter functionality for menu items
- [ ] Add menu templates/presets for common relationship types
- [ ] Add export/import functionality (JSON, CSV)
- [ ] Add menu versioning/history

### Testing
- [ ] Increase test coverage for core functionality
- [ ] Add integration tests for P2P features
- [ ] Add visual regression tests with Chromatic
- [ ] Add performance tests
- [ ] Test mobile browser compatibility

### Documentation
- [ ] Create user guide with screenshots
- [ ] Create developer setup guide
- [ ] Document P2P/IPFS architecture
- [ ] Document comparison feature usage
- [ ] Add API documentation for key components
- [ ] Create troubleshooting guide

## Low Priority

### Performance
- [ ] Optimize bundle size
- [ ] Implement code splitting for better load times
- [ ] Add service worker for offline functionality
- [ ] Optimize IPFS node initialization
- [ ] Add caching for frequently accessed menus

### Accessibility
- [ ] Complete ARIA labels for all interactive elements
- [ ] Test with screen readers
- [ ] Improve keyboard navigation
- [ ] Add high contrast theme support
- [ ] Test with browser accessibility tools

### CI/CD
- [ ] Set up automatic dependency updates
- [ ] Add automated security scanning
- [ ] Implement automated release process
- [ ] Add staging environment
- [ ] Set up performance monitoring

### Infrastructure
- [ ] Set up error tracking (e.g., Sentry)
- [ ] Add analytics for feature usage
- [ ] Set up automated backups for IPFS data
- [ ] Document deployment process
- [ ] Set up monitoring and alerting

## Future Considerations

### Advanced Features
- [ ] Real-time collaboration on menus
- [ ] Multi-user comparison (3+ people)
- [ ] Menu commenting/annotation system
- [ ] Integration with calendar for scheduling
- [ ] Email notifications for menu updates
- [ ] Mobile app (React Native)

### Community
- [ ] Create contribution guidelines (CONTRIBUTING.md)
- [ ] Set up issue templates
- [ ] Create PR templates
- [ ] Add code of conduct
- [ ] Set up discussion forum

## Completed

✅ Basic menu creation and editing  
✅ Menu comparison functionality  
✅ URL-based menu sharing  
✅ Storybook component documentation  
✅ Basic CI/CD with GitHub Actions  
✅ Chromatic visual testing setup  
✅ TypeScript configuration  
✅ Local storage for menu persistence  

---

**Last Updated:** 2025-10-22

**Note:** This TODO list is maintained as tasks are identified. Priority levels may change based on user feedback and project needs.
