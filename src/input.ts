export type InputMethod = "keyboard" | "gamepad";

export interface InputFrame {
  moveX: number;
  moveY: number;
  run: boolean;
  stalk: boolean;
  actionPressed: boolean;
  meowPressed: boolean;
  pouncePressed: boolean;
  pausePressed: boolean;
  debugPressed: boolean;
  method: InputMethod;
}

interface ButtonState {
  action: boolean;
  meow: boolean;
  pounce: boolean;
  pause: boolean;
}

const DEAD_ZONE = 0.18;

export function applyDeadZone(value: number, deadZone = DEAD_ZONE): number {
  if (Math.abs(value) <= deadZone) return 0;
  return Math.sign(value) * (Math.abs(value) - deadZone) / (1 - deadZone);
}

export class InputController {
  private readonly keys = new Set<string>();
  private actionQueued = false;
  private meowQueued = false;
  private pounceQueued = false;
  private pauseQueued = false;
  private debugQueued = false;
  private method: InputMethod = "keyboard";
  private previousButtons: ButtonState = { action: false, meow: false, pounce: false, pause: false };

  constructor(private readonly onMethodChanged?: (method: InputMethod) => void) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
    window.addEventListener("gamepadconnected", () => this.setMethod("gamepad"));
  }

  read(): InputFrame {
    const pad = navigator.getGamepads?.().find((candidate) => candidate?.connected) ?? null;
    const padX = applyDeadZone(pad?.axes[0] ?? 0);
    const padY = -applyDeadZone(pad?.axes[1] ?? 0);
    const buttons: ButtonState = {
      action: pad?.buttons[0]?.pressed ?? false,
      pounce: pad?.buttons[1]?.pressed ?? false,
      meow: pad?.buttons[2]?.pressed ?? false,
      pause: pad?.buttons[9]?.pressed ?? false,
    };
    if (Math.abs(padX) + Math.abs(padY) > 0.05 || Object.values(buttons).some(Boolean)) this.setMethod("gamepad");

    const keyboardX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight"))
      - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const keyboardY = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"))
      - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const usingPad = this.method === "gamepad" && pad !== null;

    const frame: InputFrame = {
      moveX: usingPad ? padX : keyboardX,
      moveY: usingPad ? padY : keyboardY,
      run: usingPad ? (pad?.buttons[5]?.pressed ?? false) : this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      stalk: usingPad ? (pad?.buttons[4]?.pressed ?? false) : this.keys.has("ControlLeft") || this.keys.has("ControlRight"),
      actionPressed: this.actionQueued || (buttons.action && !this.previousButtons.action),
      meowPressed: this.meowQueued || (buttons.meow && !this.previousButtons.meow),
      pouncePressed: this.pounceQueued || (buttons.pounce && !this.previousButtons.pounce),
      pausePressed: this.pauseQueued || (buttons.pause && !this.previousButtons.pause),
      debugPressed: this.debugQueued,
      method: this.method,
    };
    this.actionQueued = false;
    this.meowQueued = false;
    this.pounceQueued = false;
    this.pauseQueued = false;
    this.debugQueued = false;
    this.previousButtons = buttons;
    return frame;
  }

  clear = (): void => {
    this.keys.clear();
    this.previousButtons = { action: false, meow: false, pounce: false, pause: false };
  };

  private setMethod(method: InputMethod): void {
    if (method === this.method) return;
    this.method = method;
    this.onMethodChanged?.(method);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    this.setMethod("keyboard");
    if (!event.repeat) {
      if (event.code === "KeyE") this.actionQueued = true;
      if (event.code === "KeyQ") this.meowQueued = true;
      if (event.code === "Space") this.pounceQueued = true;
      if (event.code === "Escape") this.pauseQueued = true;
      if (event.code === "Backquote") this.debugQueued = true;
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}
