import { Component, ElementRef, input, output, viewChild, type AfterViewInit, type OnDestroy } from '@angular/core';

@Component({
  selector: 'app-modal',
  template: '<dialog #dialog [attr.aria-label]="label()" (cancel)="cancel($event)"><ng-content /></dialog>',
})
export class Modal implements AfterViewInit, OnDestroy {
  readonly label = input.required<string>();
  readonly busy = input(false);
  readonly dismissed = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  ngAfterViewInit() { this.dialog().nativeElement.showModal(); }
  ngOnDestroy() { this.dialog().nativeElement.close(); }
  cancel(event: Event) {
    event.preventDefault();
    if (!this.busy()) this.dismissed.emit();
  }
}
