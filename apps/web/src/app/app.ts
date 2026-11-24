import { Component, computed, inject, PendingTasks, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { requestDays, type LeaveRequest, type User, type Workspace } from '@leave/contracts';
import { Api } from './api';
import { Login } from './login';
import { Icon } from './icon';
import { BalanceCards } from './balance-cards';
import { Balances } from './balances';
import { Requests } from './requests';
import { RequestForm } from './request-form';
import { TeamCalendar } from './calendar';
import { AdminSettings } from './admin';
import { Account } from './account';
import { People } from './people';
import { TeamInsights } from './team-insights';
import { NotificationCenter } from './notification-center';
import { ProfileAvatar } from './profile-avatar';
import { LeaveAnalytics } from './analytics';
import { dateLabel, errorMessage, peopleOff, type LeaveDateRange, type View } from './ui-model';

@Component({
  imports: [FormsModule, Login, Icon, BalanceCards, Balances, Requests, RequestForm, TeamCalendar, AdminSettings, Account, People, TeamInsights, NotificationCenter, ProfileAvatar, LeaveAnalytics],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly api = inject(Api);
  private readonly pendingTasks = inject(PendingTasks);
  private loadId = 0;
  readonly user = signal<User | null>(null);
  readonly data = signal<Workspace | null>(null);
  readonly starting = signal(true);
  readonly loading = signal(false);
  readonly signingOut = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly view = signal<View>('overview');
  readonly year = signal(new Date().getUTCFullYear());
  readonly years = Array.from({ length: 101 }, (_, index) => 2000 + index);
  readonly requestOpen = signal(false);
  readonly requestDates = signal<LeaveDateRange | null>(null);
  readonly editingRequest = signal<LeaveRequest | null>(null);
  readonly focusedRequestId = signal('');
  readonly notificationRevision = signal(0);
  readonly pending = computed(() => this.data()?.requests.filter((request) => request.status === 'pending').length ?? 0);
  readonly awayToday = computed(() => this.data() ? peopleOff(this.data()!.calendar, this.data()!.today) : 0);
  readonly upcoming = computed(() => this.data()?.holidays.find((holiday) => holiday.date >= this.data()!.today));
  readonly myBalances = computed(() => this.data()?.employees.find((summary) => summary.employee.id === this.user()?.id)?.balances ?? []);
  readonly recent = computed(() => this.data()?.requests.slice(0, 4) ?? []);
  readonly title = computed(() => ({
    overview: 'Overview', requests: this.user()?.role === 'employee' ? 'My requests' : 'Team requests',
    calendar: 'Team calendar', balances: 'Leave balances', settings: 'Workspace settings',
    profile: 'My account', people: 'People & teams', insights: 'Team insights', analytics: 'Monthly analytics',
  })[this.view()]);
  protected readonly dateLabel = dateLabel;
  protected readonly requestDays = requestDays;

  ngOnInit() { this.pendingTasks.run(() => this.restore()); }

  async restore() {
    this.starting.set(true);
    this.error.set('');
    try { this.user.set(await this.api.me()); await this.refresh(); }
    catch (error) {
      if (!(error instanceof HttpErrorResponse && error.status === 401)) this.error.set(errorMessage(error));
    } finally { this.starting.set(false); }
  }

  async signedIn(user: User) {
    this.user.set(user);
    this.view.set('overview');
    await this.refresh();
  }

  async refresh(message = '') {
    const loadId = ++this.loadId;
    this.loading.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const data = await this.api.workspace(this.year());
      if (loadId !== this.loadId) return;
      this.data.set(data);
      this.user.set(data.user);
      if ((this.view() === 'settings' || this.view() === 'people') && data.user.role !== 'admin') this.view.set('overview');
      this.notificationRevision.update((value) => value + 1);
      this.success.set(message);
    } catch (error) {
      if (loadId !== this.loadId) return;
      if (error instanceof HttpErrorResponse && error.status === 401) { this.user.set(null); this.data.set(null); }
      this.error.set(message ? `${message} The view could not refresh: ${errorMessage(error)}` : errorMessage(error));
    } finally { if (loadId === this.loadId) this.loading.set(false); }
  }

  async changeYear(year: number) {
    this.year.set(year);
    this.data.set(null);
    await this.refresh();
  }

  navigate(view: View) { this.view.set(view); this.success.set(''); this.focusedRequestId.set(''); }
  async openNotification(notice: { requestId: string; year: number }) {
    this.focusedRequestId.set(notice.requestId);
    this.view.set('requests');
    await this.changeYear(notice.year);
  }
  openRequest(dates: LeaveDateRange | null = null) { this.editingRequest.set(null); this.requestDates.set(dates); this.requestOpen.set(true); }
  editRequest(request: LeaveRequest) {
    if (request.employeeId !== this.user()?.id || request.status !== 'pending' || !this.data() || request.startDate <= this.data()!.today) {
      this.error.set('Only your future pending requests can be edited.');
      return;
    }
    this.editingRequest.set(request); this.requestDates.set(null); this.requestOpen.set(true);
  }
  closeRequest() { this.requestOpen.set(false); this.requestDates.set(null); this.editingRequest.set(null); }
  async requestSaved() {
    const editing = this.editingRequest() !== null;
    this.closeRequest();
    await this.refresh(editing ? 'Request updated. Your manager has been notified to review the latest version.'
      : 'Request submitted. Your manager can now review it. Add supporting documents from My requests while it is pending.');
  }

  async logout() {
    this.signingOut.set(true);
    try {
      await this.api.logout();
      this.loadId++;
      this.data.set(null);
      this.user.set(null);
      this.error.set('');
      this.success.set('');
      this.closeRequest();
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.signingOut.set(false); this.loading.set(false); }
  }
}
