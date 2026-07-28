export interface InputFrame {
  moveX: number;
  moveY: number;
  run: boolean;
  actionPressed: boolean;
  meowPressed: boolean;
  pouncePressed: boolean;
}

export class InputController {
  private readonly keys = new Set<string>();
  private touchX = 0;
  private touchY = 0;
  private actionQueued = false;
  private meowQueued = false;
  private pounceQueued = false;
  private joystickPointer: number | null = null;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);

    const joystick = document.querySelector<HTMLElement>("#joystick");
    const knob = document.querySelector<HTMLElement>("#joystick-knob");
    if (joystick && knob) {
      joystick.addEventListener("pointerdown", (event) => {
        this.joystickPointer = event.pointerId;
        joystick.setPointerCapture(event.pointerId);
        this.updateJoystick(event, joystick, knob);
      });
      joystick.addEventListener("pointermove", (event) => {
        if (event.pointerId === this.joystickPointer) this.updateJoystick(event, joystick, knob);
      });
      const release = (event: PointerEvent) => {
        if (event.pointerId !== this.joystickPointer) return;
        this.joystickPointer = null;
        this.touchX = 0;
        this.touchY = 0;
        knob.style.transform = "translate(-50%, -50%)";
      };
      joystick.addEventListener("pointerup", release);
      joystick.addEventListener("pointercancel", release);
    }

    this.bindButton("#btn-action", () => { this.actionQueued = true; });
    this.bindButton("#btn-meow", () => { this.meowQueued = true; });
    this.bindButton("#btn-pounce", () => { this.pounceQueued = true; });
  }

  read(): InputFrame {
    const keyboardX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight"))
      - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const keyboardY = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"))
      - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));

    const moveX = Math.abs(this.touchX) > Math.abs(keyboardX) ? this.touchX : keyboardX;
    const moveY = Math.abs(this.touchY) > Math.abs(keyboardY) ? this.touchY : keyboardY;
    const actionPressed = this.actionQueued;
    const meowPressed = this.meowQueued;
    const pouncePressed = this.pounceQueued;

    this.actionQueued = false;
    this.meowQueued = false;
    this.pounceQueued = false;

    return {
      moveX,
      moveY,
      run: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || Math.hypot(this.touchX, this.touchY) > 0.82,
      actionPressed,
      meowPressed,
      pouncePressed,
    };
  }

  private bindButton(selector: string, callback: () => void): void {
    const button = document.querySelector<HTMLButtonElement>(selector);
    button?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      callback();
    });
  }

  private updateJoystick(event: PointerEvent, base: HTMLElement, knob: HTMLElement): void {
    const rect = base.getBoundingClientRect();
    const radius = rect.width * 0.34;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    const scale = length > radius ? radius / length : 1;
    const x = dx * scale;
    const y = dy * scale;
    this.touchX = x / radius;
    this.touchY = -y / radius;
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) {
      if (event.code === "KeyE") this.actionQueued = true;
      if (event.code === "KeyQ") this.meowQueued = true;
      if (event.code === "Space") this.pounceQueued = true;
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private clear = (): void => {
    this.keys.clear();
    this.touchX = 0;
    this.touchY = 0;
  };
}
