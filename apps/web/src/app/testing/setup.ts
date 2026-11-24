// JSDOM does not implement the dialog top-layer APIs; real dialogs are checked in the browser.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
});
