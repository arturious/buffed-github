// jsdom 27 ships without its own types. Only the surface these tests use.
declare module "jsdom" {
  export interface TestWindow extends Window {
    MouseEvent: new (type: string, eventInitDict?: MouseEventInit) => MouseEvent;
    KeyboardEvent: new (type: string, eventInitDict?: KeyboardEventInit) => KeyboardEvent;
    WheelEvent: new (type: string, eventInitDict?: WheelEventInit) => WheelEvent;
    scrollTo: (...args: unknown[]) => void;
    close(): void;
  }

  export class VirtualConsole {
    on(event: "jsdomError", listener: (error: Error & { type?: string }) => void): void;
  }

  export class JSDOM {
    constructor(
      html?: string,
      options?: { url?: string; pretendToBeVisual?: boolean; virtualConsole?: VirtualConsole },
    );
    readonly window: TestWindow;
  }
}
