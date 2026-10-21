// Undo / redo by snapshots of the whole document. Cheap enough for layouts of a few thousand pieces.
import { Project } from "./model";

export class History {
  private stack: string[] = [];
  private index = -1;
  constructor(private limit = 200) {}

  reset(p: Project) { this.stack = [JSON.stringify(p)]; this.index = 0; }

  commit(p: Project) {
    const snap = JSON.stringify(p);
    if (this.stack[this.index] === snap) return false;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  /** Replace the current state without making an undo step (proposals that arrived from elsewhere). */
  amend(p: Project) { if (this.index >= 0) this.stack[this.index] = JSON.stringify(p); }

  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
  undo(): Project | null { return this.canUndo() ? JSON.parse(this.stack[--this.index]) : null; }
  redo(): Project | null { return this.canRedo() ? JSON.parse(this.stack[++this.index]) : null; }
  /** The last committed state, for cancelling an uncommitted drag. */
  current(): Project { return JSON.parse(this.stack[this.index]); }
}
