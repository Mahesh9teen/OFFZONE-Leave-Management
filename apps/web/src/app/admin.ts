import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CARRYOVER_POLICY, REMINDER_POLICY, type ConfigurationInput, type Workspace } from '@leave/contracts';
import { Api } from './api';
import { errorMessage } from './ui-model';
import { Icon } from './icon';

@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule, Icon],
  templateUrl: './admin.html',
})
export class AdminSettings {
  private readonly api = inject(Api);
  readonly data = input.required<Workspace>();
  readonly changed = output<string>();
  readonly reload = output<void>();
  readonly busy = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  protected readonly carryoverPolicy = CARRYOVER_POLICY;
  protected readonly reminderPolicy = REMINDER_POLICY;
  draft: ConfigurationInput | null = null;
  holidayDate = '';
  holidayName = '';
  typeName = '';
  typeAllowance = 10;

  constructor() {
    effect(() => {
      const { settings, leaveTypes, holidays } = this.data();
      this.draft = structuredClone({ settings, leaveTypes, holidays });
      this.dirty.set(false);
    });
  }

  addHoliday() {
    if (!this.draft) return;
    if (this.draft.holidays.some((holiday) => holiday.date === this.holidayDate)) {
      this.error.set('A public holiday already exists on that date.');
      return;
    }
    this.draft.holidays.push({ date: this.holidayDate, name: this.holidayName.trim() });
    this.draft.holidays.sort((a, b) => a.date.localeCompare(b.date));
    this.holidayDate = '';
    this.holidayName = '';
    this.dirty.set(true);
    this.error.set('');
  }

  removeHoliday(date: string) {
    if (!this.draft) return;
    this.draft.holidays = this.draft.holidays.filter((holiday) => holiday.date !== date);
    this.dirty.set(true);
  }

  async save() {
    if (!this.draft) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.configure(structuredClone(this.draft));
      this.dirty.set(false);
      this.changed.emit('Configuration saved. New requests use the updated rules immediately.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async addType() {
    if (this.dirty()) {
      this.error.set('Save your configuration changes before adding a leave type.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.addLeaveType({ name: this.typeName.trim(), yearlyAllowance: this.typeAllowance });
      this.typeName = '';
      this.changed.emit('Leave type added.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
