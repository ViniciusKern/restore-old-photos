import "@testing-library/jest-dom";

const fetchMock = jest.fn();
Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: fetchMock });
Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: jest.fn(() => "blob:restored-photo") });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: jest.fn() });

// jsdom does not implement pointer capture or PointerEvent.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
  }
}
Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: jest.fn() });

beforeEach(() => {
  fetchMock.mockReset().mockRejectedValue(new Error("Unexpected fetch: mock every network request in frontend tests."));
});
