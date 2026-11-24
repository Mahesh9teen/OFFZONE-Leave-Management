import { Component, computed, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PERIOD_LABELS, type Workspace } from '@leave/contracts';
import { dateLabel, initials, peopleOff } from './ui-model';
import { Icon } from './icon';

export function teamOutlook(data: Workspace, teamId: string) {
  const team = data.teams.find((item) => item.id === teamId);
  if (!team) throw new Error('Select an existing team to view availability.');
  const anchor = data.today.startsWith(`${data.year}-`) ? data.today : `${data.year}-01-01`;
  const entries = data.calendar.filter((entry) => entry.teamId === teamId && (entry.status === 'pending' || entry.status === 'approved'));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${anchor}T00:00:00.000Z`);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    const approved = new Set(entries.filter((entry) => entry.status === 'approved' && entry.workingDates.includes(date)).map((entry) => entry.employeeId));
    const pending = new Set(entries.filter((entry) => entry.status === 'pending' && entry.workingDates.includes(date) && !approved.has(entry.employeeId)).map((entry) => entry.employeeId));
    const off = approved.size + pending.size;
    const morning = peopleOff(entries, date, 'am');
    const afternoon = peopleOff(entries, date, 'pm');
    const peak = Math.max(morning, afternoon);
    const holiday = data.holidays.find((item) => item.date === date);
    return { date, approved: approved.size, pending: pending.size, off, morning, afternoon, slots: Math.max(0, data.settings.maxTeamOff - peak),
      overCapacity: peak > data.settings.maxTeamOff, nonWorking: day.getUTCDay() === 0 || day.getUTCDay() === 6 || !!holiday,
      holiday: holiday?.name, percent: Math.min(100, peak / data.settings.maxTeamOff * 100) };
  }).filter((day) => day.date.startsWith(`${data.year}-`));
  const upcoming = entries.flatMap((entry) => {
    const nextDate = entry.workingDates.find((date) => date >= anchor && date.startsWith(`${data.year}-`));
    return nextDate ? [{ ...entry, nextDate }] : [];
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.employeeName.localeCompare(b.employeeName)).slice(0, 10);
  const first = days[0];
  const summary = `${team.name} has ${first.off} ${first.off === 1 ? 'person' : 'people'} with reserved leave on ${dateLabel(anchor)}. ${first.nonWorking ? 'This is a weekend or public holiday.' : first.overCapacity ? 'Existing reservations exceed the current team limit.' : `${first.slots} more ${first.slots === 1 ? 'person can' : 'people can'} be off within the team limit, subject to individual balances.`}`;
  return { days, upcoming, summary };
}

@Component({
  selector: 'app-team-insights',
  imports: [FormsModule, Icon],
  template: `
    <section class="card section-header"><div><h2>Team availability</h2><p class="muted small">A plain-language outlook based on current approved and pending leave.</p></div><label>Team<select [ngModel]="teamId()" (ngModelChange)="teamId.set($event)">@for (team of data().teams; track team.id) { <option [value]="team.id">{{ team.name }}</option> }</select></label></section>
    @if (outlook(); as view) {
      <div class="availability-summary"><app-icon name="people" /><p>{{ view.summary }}</p></div>
      <div class="insights-grid">
        <section class="card settings-card"><h2>The next seven days</h2><p class="muted small section-copy">Within {{ data().year }}. Pending requests already reserve capacity.</p>
          <div class="outlook-days">@for (day of view.days; track day.date) { <div class="outlook-day" [class.negative]="day.overCapacity"><div><strong>{{ dateLabel(day.date) }}</strong><small>{{ day.nonWorking ? (day.holiday || 'Weekend') : day.slots + ' full-day slots available' }}</small></div><div class="outlook-chart"><span [style.width.%]="day.percent"></span></div><span>{{ day.morning }} AM / {{ day.afternoon }} PM<small>Limit {{ data().settings.maxTeamOff }} per period</small></span></div> }</div>
        </section>
        <section class="card settings-card"><h2>Upcoming leave</h2><p class="muted small section-copy">Next reserved working dates, including ongoing requests.</p>
          @for (entry of view.upcoming; track entry.id) { <div class="upcoming-entry"><span class="avatar small">{{ initials(entry.employeeName) }}</span><div><strong>{{ entry.employeeName }}</strong><small>{{ entry.leaveTypeName }} &middot; {{ dateLabel(entry.nextDate) }} &middot; {{ periodLabels[entry.period || 'full'] }}</small></div><span class="status" [class]="entry.status">{{ entry.status }}</span></div> } @empty { <div class="empty-state"><app-icon name="calendar" /><p>No upcoming leave in this year.</p></div> }
        </section>
      </div>
    }`,
})
export class TeamInsights implements OnInit {
  readonly data = input.required<Workspace>();
  readonly teamId = signal('');
  readonly outlook = computed(() => this.teamId() ? teamOutlook(this.data(), this.teamId()) : null);
  protected readonly dateLabel = dateLabel;
  protected readonly initials = initials;
  protected readonly periodLabels = PERIOD_LABELS;
  ngOnInit() { this.teamId.set(this.data().teams[0]?.id ?? ''); }
}
