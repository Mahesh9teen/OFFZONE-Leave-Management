import { Component, computed, input, output, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PERIOD_LABELS, type LeavePeriod, type Workspace } from '@leave/contracts';
import { calendarCells, dateLabel, errorMessage, initials, leaveDayAvailability, peopleOff, summarizeLeaveSelection, type LeaveDateRange } from './ui-model';
import { Icon } from './icon';
import { calendarIcs, downloadFile } from './reports';

@Component({
  selector: 'app-team-calendar',
  imports: [FormsModule, Icon],
  templateUrl: './calendar.html',
})
export class TeamCalendar implements OnInit {
  readonly data = input.required<Workspace>();
  readonly leaveRequested = output<LeaveDateRange>();
  readonly month = signal(0);
  readonly teamId = signal('');
  readonly selectedDate = signal('');
  readonly rangeStart = signal<string | null>(null);
  readonly rangeEnd = signal<string | null>(null);
  readonly selectionNotice = signal('');
  readonly period = signal<LeavePeriod>('full');
  readonly exportError = signal('');
  readonly canSelectLeave = computed(() => this.data().user.role === 'employee' && this.teamId() === this.data().user.teamId);
  readonly selectedRange = computed<LeaveDateRange | null>(() => {
    const start = this.rangeStart();
    if (!start) return null;
    const end = this.rangeEnd() ?? start;
    const range = start <= end ? { startDate: start, endDate: end } : { startDate: end, endDate: start };
    return this.period() === 'full' ? range : { ...range, period: this.period() };
  });
  readonly selectionSummary = computed(() => {
    const range = this.selectedRange();
    return range ? summarizeLeaveSelection(range, this.data(), this.teamId(), this.period()) : { workingDays: 0, error: '' };
  });
  readonly selectionError = computed(() => this.selectionNotice() || this.selectionSummary().error);
  readonly canRequestSelection = computed(() => this.canSelectLeave() && this.selectedRange() !== null && !this.selectionError());
  readonly months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  readonly cells = computed(() => {
    const data = this.data();
    const range = this.selectedRange();
    return calendarCells(data.year, this.month(), data.today, data.holidays, data.calendar, this.teamId()).map((cell) => ({
      ...cell,
      availability: leaveDayAvailability(cell.date, data, this.teamId(), this.period()),
      people: [...new Map(cell.entries.map((entry) => [entry.employeeId, entry])).values()],
      inSelection: range !== null && cell.date >= range.startDate && cell.date <= range.endDate,
    }));
  });
  readonly selected = computed(() => this.cells().find((cell) => cell.date === this.selectedDate())
    ?? this.cells().find((cell) => cell.inMonth && cell.isToday) ?? this.cells().find((cell) => cell.inMonth)!);
  readonly away = computed(() => new Set(this.selected().entries.map((entry) => entry.employeeId)).size);
  readonly morningAway = computed(() => peopleOff(this.selected().entries, this.selected().date, 'am'));
  readonly afternoonAway = computed(() => peopleOff(this.selected().entries, this.selected().date, 'pm'));
  readonly availableSlots = computed(() => Math.max(0, this.data().settings.maxTeamOff
    - (this.period() === 'am' ? this.morningAway() : this.period() === 'pm' ? this.afternoonAway() : Math.max(this.morningAway(), this.afternoonAway()))));
  readonly holidays = computed(() => this.data().holidays.filter((holiday) => holiday.date.startsWith(`${this.data().year}-`)));
  protected readonly dateLabel = dateLabel;
  protected readonly initials = initials;
  protected readonly periodLabels = PERIOD_LABELS;

  ngOnInit() {
    this.month.set(Number(this.data().today.slice(5, 7)) - 1);
    this.teamId.set(this.data().teams[0]?.id ?? '');
  }

  changeMonth(month: number) {
    this.month.set(month);
    this.selectedDate.set('');
    this.selectionNotice.set('');
  }

  selectDate(date: string) {
    this.selectedDate.set(date);
    if (!this.canSelectLeave()) return;
    const availability = leaveDayAvailability(date, this.data(), this.teamId(), this.period());
    if (availability.state !== 'available') {
      this.selectionNotice.set(`${dateLabel(date)}: ${availability.detail}`);
      return;
    }
    this.selectionNotice.set('');
    if (this.period() !== 'full') {
      this.rangeStart.set(date);
      this.rangeEnd.set(date);
    } else if (!this.rangeStart() || this.rangeEnd()) {
      this.rangeStart.set(date);
      this.rangeEnd.set(null);
    } else {
      this.rangeEnd.set(date);
    }
  }

  clearSelection() {
    this.rangeStart.set(null);
    this.rangeEnd.set(null);
    this.selectionNotice.set('');
  }

  changePeriod(period: LeavePeriod) { this.period.set(period); this.clearSelection(); }

  exportCalendar() {
    this.exportError.set('');
    try {
      const content = calendarIcs(this.data().calendar, this.teamId(), this.data().year, this.month(), new Date());
      downloadFile(new Blob([content], { type: 'text/calendar;charset=utf-8' }), `offzone-calendar-${this.data().year}-${String(this.month() + 1).padStart(2, '0')}.ics`);
    } catch (error) { this.exportError.set(errorMessage(error)); }
  }

  requestSelectedDates() {
    const range = this.selectedRange();
    if (!this.canRequestSelection() || !range) {
      this.selectionNotice.set(this.selectionError() || 'Select available working dates in your own employee calendar first.');
      return;
    }
    this.leaveRequested.emit(range);
  }
}
