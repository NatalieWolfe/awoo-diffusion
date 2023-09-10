export class QueueProcessor<T> {
  private readonly queue: T[] = [];
  private actionPromise?: Promise<void> = null;
  private processed = 0;

  constructor(private readonly action: (val: T) => Promise<void>) {}

  get size() { return this.queue.length; }
  get processedCount() { return this.processed; }

  push(val: T) {
    this.queue.push(val);
    if (!this.actionPromise) {
      this.actionPromise = this._execute()
        .then(() => { this.actionPromise = null; });
    }
  }

  async flush(): Promise<number> {
    if (this.actionPromise) await this.actionPromise;
    return this.processed;
  }

  private async _execute() {
    do {
      const val = this.queue.shift();
      await this.action(val);
      ++this.processed;
    } while (this.queue.length > 0);
  }
}
