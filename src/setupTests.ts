// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Polyfill TextEncoder/TextDecoder for jsdom (required by react-router v7)
const util = require('util');
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = util.TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = util.TextDecoder;
}
