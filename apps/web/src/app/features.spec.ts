import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import type { Workspace } from '@leave/contracts';
import { Api } from './api';
import { Login } from './login';
import { RequestForm } from './request-form';
import { Requests } from './requests';
import { TeamCalendar } from './calendar';
import { AdminSettings } from './admin';
import { Balances } from './balances';
import { fixtureRequest, fixtureWorkspace } from './testing/fixtures';

describe('role-based workspace features', () => {
  const api = {
    login: vi.fn(), preview: vi.fn(), previewEdit: vi.fn(), create: vi.fn(), edit: vi.fn(), transition: vi.fn(),
    configure: vi.fn(), addLeaveType: vi.fn(),
    authOptions: vi.fn(), demoLogin: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    api.authOptions.mockResolvedValue({ demoLoginEnabled: false });
    TestBed.configureTestingModule({
      imports: [Login, RequestForm, Requests, TeamCalendar, AdminSettings, Balances],
      providers: [{ provide: Api, useValue: api }],
    });
  });

  async function mount<T>(component: Type<T>, data?: Workspace) {
    const fixture = TestBed.createComponent(component);
    if (data) fixture.componentRef.setInput('data', data);
    await fixture.whenStable();
    return fixture;
  }

  it('prefills pending edits, previews the edited version and preserves conflict errors', async () => {
    const fixture = TestBed.createComponent(RequestForm);
    const existing = fixtureRequest({ version: 2, period: 'am', endDate: '2026-01-05', workingDates: ['2026-01-05'] });
    fixture.componentRef.setInput('data', fixtureWorkspace());
    fixture.componentRef.setInput('existingRequest', existing);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    expect(component.draft).toMatchObject({ startDate: existing.startDate, endDate: existing.endDate, period: 'am' });
    component.draft.period = 'pm';
    api.previewEdit.mockResolvedValue({ workingDates: ['2026-01-05'], daysByYear: { '2026': 0.5 } });
    await component.check();
    expect(api.previewEdit).toHaveBeenCalledWith(existing.id, expect.objectContaining({ period: 'pm', version: 2 }));
    expect(component.previewDays()).toBe(0.5);
    api.edit.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: 'Request changed. Refresh before editing.' } }));
    await component.submit();
    expect(component.error()).toContain('Request changed');
    expect(api.create).not.toHaveBeenCalled();
    expect(existing.period).toBe('am');
  });

  it('synchronizes half-day end dates through the form and submits a half-day payload', async () => {
    const fixture = await mount(RequestForm, fixtureWorkspace());
    const element: HTMLElement = fixture.nativeElement;
    const start = element.querySelector<HTMLInputElement>('input[name="startDate"]')!;
    const end = element.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    const period = element.querySelector<HTMLSelectElement>('select[name="period"]')!;
    const reason = element.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
    start.value = '2026-01-05';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    period.value = 'am';
    period.dispatchEvent(new Event('change'));
    reason.value = 'A short break';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(end.value).toBe(start.value);
    expect(end.readOnly).toBe(true);
    api.preview.mockResolvedValue({ workingDates: [start.value], daysByYear: { '2026': 0.5 } });
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Check availability')!.click();
    await fixture.whenStable();
    expect(element.querySelector('.preview-box')?.textContent).toContain('0.5 working days');
    api.create.mockResolvedValue(fixtureRequest({ period: 'am', endDate: start.value }));
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ startDate: start.value, endDate: start.value, period: 'am' }));
    period.value = 'full';
    period.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(end.readOnly).toBe(false);
    expect(fixture.componentInstance.preview()).toBeNull();
  });

  it('selects exactly one half-day and permits an unreserved opposite period', async () => {
    const data = fixtureWorkspace();
    data.requests = [fixtureRequest({ period: 'am', endDate: '2026-01-05', workingDates: ['2026-01-05'] })];
    data.calendar = [...data.requests];
    const fixture = await mount(TeamCalendar, data);
    const component = fixture.componentInstance;
    component.changePeriod('pm');
    component.selectDate('2026-01-05');
    expect(component.selectionSummary()).toEqual({ workingDays: 0.5, error: '' });
    const selected = vi.fn();
    component.leaveRequested.subscribe(selected);
    component.requestSelectedDates();
    expect(selected).toHaveBeenCalledWith({ startDate: '2026-01-05', endDate: '2026-01-05', period: 'pm' });
    component.changePeriod('am');
    component.selectDate('2026-01-05');
    expect(component.canRequestSelection()).toBe(false);
  });

  it('retains password-based account login when open demo access is disabled', async () => {
    const fixture = await mount(Login);
    const component = fixture.componentInstance;
    const signedIn = vi.fn();
    component.signedIn.subscribe(signedIn);
    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.demo-roles button');
    buttons[1].click();
    await fixture.whenStable();
    component.password = 'demo-test-password';
    api.login.mockResolvedValue(fixtureWorkspace('manager').user);
    await component.submit();
    expect(api.login).toHaveBeenCalledWith('manager1@example.test', 'demo-test-password');
    expect(signedIn).toHaveBeenCalledOnce();
    api.login.mockRejectedValue(new HttpErrorResponse({ status: 401, error: { message: 'Email or password is incorrect.' } }));
    await component.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('incorrect');
    expect(component.busy()).toBe(false);
    expect(api.demoLogin).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.demo-note')).toBeNull();
    expect(fixture.nativeElement.querySelector('.demo-credential-hint')).toBeNull();
  });

  it('updates demo credential hints below each input without overwriting typed values', async () => {
    api.authOptions.mockResolvedValue({ demoLoginEnabled: true });
    const fixture = await mount(Login);
    const element: HTMLElement = fixture.nativeElement;
    const emailInput = element.querySelector<HTMLInputElement>('input[name="email"]')!;
    const passwordInput = element.querySelector<HTMLInputElement>('input[name="password"]')!;
    for (const [field, value] of [[emailInput, 'my-demo@example.test'], [passwordInput, 'my-demo-password']] as const) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    for (const [role, email, password] of [
      ['employee', 'employee1@example.test', 'Employee@123'],
      ['manager', 'manager1@example.test', 'Manager@123'],
      ['admin', 'admin@example.test', 'Admin@123'],
    ]) {
      element.querySelector<HTMLButtonElement>(`[data-portal="${role}"]`)!.click();
      await fixture.whenStable();
      for (const [input, hintId, example] of [
        [emailInput, 'demo-email-hint', email],
        [passwordInput, 'demo-password-hint', password],
      ] as const) {
        const hint = element.querySelector<HTMLElement>(`#${hintId}`);
        expect(hint).not.toBeNull();
        expect(input.nextElementSibling).toBe(hint);
        expect(input.getAttribute('aria-describedby')).toBe(hintId);
        expect(hint?.querySelector('code')?.textContent).toBe(example);
      }
      expect(emailInput.value).toBe('my-demo@example.test');
      expect(passwordInput.value).toBe('my-demo-password');
    }
  });

  it.each(['employee', 'manager', 'admin'] as const)('uses arbitrary dummy inputs to open the selected %s demo portal', async (role) => {
    api.authOptions.mockResolvedValue({ demoLoginEnabled: true });
    api.demoLogin.mockResolvedValue(fixtureWorkspace(role).user);
    const fixture = await mount(Login);
    const component = fixture.componentInstance;
    const signedIn = vi.fn();
    component.signedIn.subscribe(signedIn);
    const element: HTMLElement = fixture.nativeElement;
    const portal = element.querySelector<HTMLButtonElement>(`[data-portal="${role}"]`)!;
    portal.click();
    for (const [name, value] of [['email', 'any-person@example.test'], ['password', 'any-password']]) {
      const field = element.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await fixture.whenStable();
    expect(portal.getAttribute('aria-pressed')).toBe('true');
    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(false);
    button.click();
    await fixture.whenStable();
    expect(api.demoLogin).toHaveBeenCalledWith(role);
    expect(api.login).not.toHaveBeenCalled();
    expect(signedIn).toHaveBeenCalledWith(fixtureWorkspace(role).user);
    const note = element.querySelector('.demo-note')!;
    expect(note.textContent).toContain('Important note:');
    expect(note.textContent).toContain('any demo email address and any password');
    expect(button.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('allows switching back to verified account credentials even when demo mode is available', async () => {
    api.authOptions.mockResolvedValue({ demoLoginEnabled: true });
    const fixture = await mount(Login);
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('[data-action="switch-login"]')!.click();
    await fixture.whenStable();
    fixture.componentInstance.email = 'employee5@example.test';
    fixture.componentInstance.password = 'actual-account-password';
    api.login.mockResolvedValue(fixtureWorkspace().user);
    await fixture.componentInstance.submit();
    expect(api.login).toHaveBeenCalledWith('employee5@example.test', 'actual-account-password');
    expect(api.demoLogin).not.toHaveBeenCalled();
    expect(element.querySelector('.demo-note')).toBeNull();
    expect(element.querySelector('.demo-credential-hint')).toBeNull();
    expect(element.querySelector('input[name="password"]')?.getAttribute('aria-describedby')).toBeNull();
  });

  it('reports unavailable sign-in options and supports retry rather than silently changing login behavior', async () => {
    api.authOptions.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    const fixture = await mount(Login);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Cannot reach the server');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    api.authOptions.mockResolvedValue({ demoLoginEnabled: true });
    element.querySelector<HTMLButtonElement>('[data-action="retry-options"]')!.click();
    await fixture.whenStable();
    expect(element.querySelector('[data-portal="admin"]')).not.toBeNull();
  });

  it('surfaces demo sign-in failures without emitting a successful session', async () => {
    api.authOptions.mockResolvedValue({ demoLoginEnabled: true });
    api.demoLogin.mockRejectedValue(new HttpErrorResponse({ status: 403, error: { message: 'Demo sign-in is disabled.' } }));
    const fixture = await mount(Login);
    const signedIn = vi.fn();
    fixture.componentInstance.signedIn.subscribe(signedIn);
    fixture.componentInstance.email = 'any@example.test';
    fixture.componentInstance.password = 'anything';
    await fixture.componentInstance.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Demo sign-in is disabled');
    expect(signedIn).not.toHaveBeenCalled();
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('previews server-calculated dates, invalidates a stale preview, and submits a request', async () => {
    const fixture = await mount(RequestForm, fixtureWorkspace());
    const component = fixture.componentInstance;
    component.draft = { leaveTypeId: 'annual', startDate: '2026-01-05', endDate: '2026-01-06', reason: 'Family time' };
    const saved = vi.fn();
    component.saved.subscribe(saved);
    api.preview.mockResolvedValue({ workingDates: ['2026-01-05', '2026-01-06'], daysByYear: { '2026': 2 } });
    await component.check();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('2 working days');
    expect(component.minimumDate()).toBe('2026-01-03');
    component.invalidate();
    expect(component.preview()).toBeNull();
    api.create.mockResolvedValue(fixtureRequest());
    await component.submit();
    expect(saved).toHaveBeenCalledOnce();
    expect(api.create).toHaveBeenCalledWith(component.draft);
  });

  it('keeps form data and reports failed previews and submissions', async () => {
    const fixture = await mount(RequestForm, fixtureWorkspace());
    const component = fixture.componentInstance;
    component.draft.reason = 'Family time';
    const failure = new HttpErrorResponse({ status: 409, error: { message: 'Team coverage limit reached.' } });
    api.preview.mockRejectedValue(failure);
    api.create.mockRejectedValue(failure);
    await component.check();
    expect(component.error()).toContain('Team coverage');
    await component.submit();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Team coverage limit reached.');
    expect(component.draft.reason).toBe('Family time');
    expect(component.busy()).toBe(false);
  });

  it('dismisses the native request dialog on Escape but not during a save', async () => {
    const fixture = await mount(RequestForm, fixtureWorkspace());
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');
    fixture.componentInstance.busy.set(true);
    await fixture.whenStable();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(closed).not.toHaveBeenCalled();
    fixture.componentInstance.busy.set(false);
    await fixture.whenStable();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(closed).toHaveBeenCalledOnce();
  });

  it.each(['employee', 'manager', 'admin'] as const)('shows only appropriate %s request actions', async (role) => {
    const fixture = await mount(Requests, fixtureWorkspace(role));
    const text: string = fixture.nativeElement.querySelector('.row-actions').textContent;
    expect(text.includes('Approve')).toBe(role === 'manager');
    expect(fixture.nativeElement.querySelector('.row-actions')?.textContent.includes('Cancel')).toBe(role === 'employee');
    fixture.componentInstance.search.set('no-such-request');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No matching requests');
  });

  it('confirms manager decisions and sends their optional note', async () => {
    const data = fixtureWorkspace('manager');
    const fixture = await mount(Requests, data);
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.changed.subscribe(changed);
    component.begin(data.requests[0], 'approved');
    await fixture.whenStable();
    component.note = ' Enjoy your break ';
    api.transition.mockResolvedValue(fixtureRequest({ status: 'approved' }));
    await component.confirm();
    await fixture.whenStable();
    expect(api.transition).toHaveBeenCalledWith('request-1', 'approved', 'Enjoy your break', 1);
    expect(changed).toHaveBeenCalledWith(expect.stringContaining('approved'));
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
  });

  it('keeps a failed decision open with its error, without emitting success', async () => {
    const data = fixtureWorkspace();
    const fixture = await mount(Requests, data);
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.changed.subscribe(changed);
    component.begin(data.requests[0], 'cancelled');
    api.transition.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: 'Request already cancelled.' } }));
    await component.confirm();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Request already cancelled.');
    expect(changed).not.toHaveBeenCalled();
    expect(component.busy()).toBe(false);
  });

  it('shows selected-day coverage and navigates to another calendar month', async () => {
    const fixture = await mount(TeamCalendar, fixtureWorkspace());
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('[aria-label^="5 Jan 2026, 1 people away"]')!.click();
    await fixture.whenStable();
    expect(element.querySelector('.day-detail')?.textContent).toContain('Alex Rivera');
    expect(fixture.componentInstance.availableSlots()).toBe(1);
    element.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click();
    await fixture.whenStable();
    expect(element.textContent).toContain('February 2026');
    expect(element.querySelector('.day-detail')?.textContent).toContain('No team members');
  });

  it('warns when reservations exceed a newly lowered coverage limit', async () => {
    const data = fixtureWorkspace();
    data.settings.maxTeamOff = 1;
    data.calendar.push(fixtureRequest({ id: 'second', employeeId: 'employee-2', employeeName: 'Sam Taylor' }));
    const fixture = await mount(TeamCalendar, data);
    fixture.componentInstance.selectedDate.set('2026-01-05');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Above the current limit');
    expect(fixture.componentInstance.availableSlots()).toBe(0);
  });

  it.each([
    { clicks: ['2026-01-07'], startDate: '2026-01-07', endDate: '2026-01-07', days: 1 },
    { clicks: ['2026-01-07', '2026-01-09'], startDate: '2026-01-07', endDate: '2026-01-09', days: 3 },
    { clicks: ['2026-01-12', '2026-01-09'], startDate: '2026-01-09', endDate: '2026-01-12', days: 2 },
  ])('requests selected dates from $startDate to $endDate', async ({ clicks, startDate, endDate, days }) => {
    const fixture = await mount(TeamCalendar, fixtureWorkspace());
    const requested = vi.fn();
    fixture.componentInstance.leaveRequested.subscribe(requested);
    const element: HTMLElement = fixture.nativeElement;
    for (const date of clicks) {
      element.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!.click();
      await fixture.whenStable();
    }
    expect(element.querySelector('.calendar-selection')?.textContent).toContain(`${days} working`);
    const submit = element.querySelector<HTMLButtonElement>('[data-action="request-selected-dates"]')!;
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(requested).toHaveBeenCalledWith({ startDate, endDate });
    expect(api.create).not.toHaveBeenCalled();
    element.querySelector<HTMLButtonElement>('[data-action="clear-dates"]')!.click();
    await fixture.whenStable();
    expect(submit.disabled).toBe(true);
    expect(element.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('retains a selection across months and starts a fresh range on the third tap', async () => {
    const fixture = await mount(TeamCalendar, fixtureWorkspace());
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('[data-date="2026-01-30"]')!.click();
    fixture.componentInstance.changeMonth(1);
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('[data-date="2026-02-02"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedRange()).toEqual({ startDate: '2026-01-30', endDate: '2026-02-02' });
    expect(element.querySelector('.calendar-selection')?.textContent).toContain('2 working');
    element.querySelector<HTMLButtonElement>('[data-date="2026-02-04"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedRange()).toEqual({ startDate: '2026-02-04', endDate: '2026-02-04' });
  });

  it('explains unavailable tapped dates while keeping their coverage details inspectable', async () => {
    const fixture = await mount(TeamCalendar, fixtureWorkspace());
    const element: HTMLElement = fixture.nativeElement;
    const requested = vi.fn();
    fixture.componentInstance.leaveRequested.subscribe(requested);
    for (const date of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05']) {
      element.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!.click();
      await fixture.whenStable();
      expect(element.querySelector('[data-action="request-selected-dates"]')?.hasAttribute('disabled')).toBe(true);
      expect(element.querySelector('.calendar-selection-error')?.textContent?.trim().length).toBeGreaterThan(0);
    }
    expect(element.querySelector('.day-detail')?.textContent).toContain('Alex Rivera');
    fixture.componentInstance.requestSelectedDates();
    expect(requested).not.toHaveBeenCalled();
  });

  it('checks every day inside a range and re-evaluates capacity after a refresh', async () => {
    const data = fixtureWorkspace();
    data.calendar.push(...['employee-2', 'employee-3'].map((employeeId) =>
      fixtureRequest({ id: employeeId, employeeId, workingDates: ['2026-01-08'] })));
    const fixture = await mount(TeamCalendar, data);
    const element: HTMLElement = fixture.nativeElement;
    for (const date of ['2026-01-07', '2026-01-09']) {
      element.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!.click();
      await fixture.whenStable();
    }
    const button = element.querySelector<HTMLButtonElement>('[data-action="request-selected-dates"]')!;
    expect(button.disabled).toBe(true);
    expect(element.querySelector('.calendar-selection-error')?.textContent).toContain('8 Jan 2026');
    fixture.componentRef.setInput('data', { ...data, settings: { ...data.settings, maxTeamOff: 3 } });
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
  });

  it.each(['manager', 'admin'] as const)('keeps the %s calendar read-only for requesting leave', async (role) => {
    const fixture = await mount(TeamCalendar, fixtureWorkspace(role));
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('[data-action="request-selected-dates"]')).toBeNull();
    element.querySelector<HTMLButtonElement>('[data-date="2026-01-07"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedRange()).toBeNull();
    expect(element.querySelector('.day-detail')?.textContent).toContain('7 Jan 2026');
  });

  it('lets managers inspect a particular employee balance', async () => {
    const data = fixtureWorkspace('manager');
    const second = structuredClone(data.employees[0]);
    second.employee = { ...second.employee, id: 'employee-2', name: 'Sam Taylor' };
    second.balances[0].remaining = -2;
    data.employees.push(second);
    const fixture = await mount(Balances, data);
    fixture.componentInstance.employeeId.set('employee-2');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.balance-person').textContent).toContain('Sam Taylor');
    expect(fixture.nativeElement.textContent).toContain('Allowance was reduced');
  });

  it('edits holidays locally, rejects duplicates, and saves an independent configuration copy', async () => {
    const data = fixtureWorkspace('admin');
    const fixture = await mount(AdminSettings, data);
    const component = fixture.componentInstance;
    component.holidayDate = '2026-02-02';
    component.holidayName = 'Team holiday';
    component.addHoliday();
    expect(data.holidays).toHaveLength(1);
    expect(component.draft?.holidays).toHaveLength(2);
    component.holidayDate = '2026-02-02';
    component.holidayName = 'Duplicate';
    component.addHoliday();
    expect(component.error()).toContain('already exists');
    component.removeHoliday('2026-01-01');
    component.draft!.settings.minNoticeDays = 5;
    api.configure.mockResolvedValue(component.draft);
    const changed = vi.fn();
    component.changed.subscribe(changed);
    await component.save();
    expect(api.configure).toHaveBeenCalledWith(expect.objectContaining({ holidays: [{ date: '2026-02-02', name: 'Team holiday' }] }));
    expect(data.settings.minNoticeDays).toBe(2);
    expect(changed).toHaveBeenCalledWith(expect.stringContaining('Configuration saved'));
    expect(component.dirty()).toBe(false);
  });

  it('preserves unsaved settings on a version conflict', async () => {
    const fixture = await mount(AdminSettings, fixtureWorkspace('admin'));
    const component = fixture.componentInstance;
    component.draft!.settings.minNoticeDays = 7;
    component.dirty.set(true);
    api.configure.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: 'Configuration changed. Refresh before saving.' } }));
    await component.save();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Refresh before saving.');
    expect(component.draft!.settings.minNoticeDays).toBe(7);
    expect(component.dirty()).toBe(true);
  });

  it('requires saving edits before creating a type and surfaces duplicate-name failures', async () => {
    const fixture = await mount(AdminSettings, fixtureWorkspace('admin'));
    const component = fixture.componentInstance;
    component.typeName = 'Special';
    component.dirty.set(true);
    await component.addType();
    expect(api.addLeaveType).not.toHaveBeenCalled();
    expect(component.error()).toContain('Save your configuration');
    component.dirty.set(false);
    api.addLeaveType.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: 'That name already exists.' } }));
    await component.addType();
    expect(component.error()).toContain('already exists');
    api.addLeaveType.mockResolvedValue({ id: 'special', name: 'Special', yearlyAllowance: 10 });
    const changed = vi.fn();
    component.changed.subscribe(changed);
    await component.addType();
    expect(changed).toHaveBeenCalledWith('Leave type added.');
    expect(component.typeName).toBe('');
  });
});
