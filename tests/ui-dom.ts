import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost:3000',
});
for (const name of [
  'window',
  'self',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLFormElement',
  'HTMLTextAreaElement',
  'HTMLOptionElement',
  'Element',
  'SVGElement',
  'Node',
  'NodeFilter',
  'DocumentFragment',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'FocusEvent',
  'MouseEvent',
  'KeyboardEvent',
  'FormData',
  'getComputedStyle',
  'localStorage',
]) {
  const value = Reflect.get(dom.window, name);
  Object.defineProperty(globalThis, name, {
    value:
      typeof value === 'function' && name === 'getComputedStyle' ? value.bind(dom.window) : value,
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, writable: true });
Object.defineProperty(dom.window, 'matchMedia', {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  }),
  writable: true,
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
dom.window.HTMLElement.prototype.setPointerCapture = () => {};
dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
Object.defineProperty(dom.window, 'PointerEvent', { value: dom.window.MouseEvent });
