import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Api } from './api';
import { fixturePeople, fixtureProfile, fixtureWorkspace } from './testing/fixtures';

describe('application shell', () => {
  function setup(role: 'employee' | 'manager' | 'admin' = 'employee') {
    const data = fixtureWorkspace(role);
    const api = {
      me: vi.fn().mockResolvedValue(data.user),
      workspace: vi.fn().mockResolvedValue(data),
      logout: vi.fn().mockResolvedValue(undefined),
      authOptions: vi.fn().mockResolvedValue({ demoLoginEnabled: false }),
      notifications: vi.fn().mockResolvedValue({ items: [], unreadCount: 0 }),
      profile: vi.fn().mockResolvedValue(fixtureProfile(role)),
      people: vi.fn().mockResolvedValue(fixturePeople()),
    };
    TestBed.configureTestingModule({ imports: [App], providers: [{ provide: Api, useValue: api }] });
    return { api, data };
  }

  it('restores a session and displays employee balances without admin navigation', async () => {
    setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Alex');
    expect(element.textContent).toContain('13');
    expect(element.querySelector('[data-view="settings"]')).toBeNull();
    expect(element.querySelector('[data-view="requests"]')?.textContent).toContain('My requests');
  });

  it('shows sign-in for an unauthenticated visitor', async () => {
    const { api } = setup();
    api.me.mockRejectedValue(new HttpErrorResponse({ status: 401 }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('opens pending edits with existing dates and keeps a later new request blank', async () => {
    setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('[data-view="requests"]')!.click();
    await fixture.whenStable();
    const edit = Array.from(element.querySelectorAll<HTMLButtonElement>('.row-actions button')).find((button) => button.textContent?.trim() === 'Edit');
    expect(edit).toBeDefined();
    edit!.click();
    await fixture.whenStable();
    expect(element.querySelector('dialog')?.textContent).toContain('Edit leave request');
    expect(element.querySelector<HTMLInputElement>('input[name="startDate"]')?.value).toBe('2026-01-05');
    element.querySelector<HTMLButtonElement>('[aria-label="Close request form"]')!.click();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('.page-heading button')!.click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('input[name="startDate"]')?.value).toBe('');
    expect(fixture.componentInstance.editingRequest()).toBeNull();
  });

  it('navigates through admin views and changes the selected year', async () => {
    const { api } = setup('admin');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    for (const view of ['requests', 'calendar', 'balances', 'settings', 'profile', 'insights', 'people', 'analytics']) {
      element.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)!.click();
      await fixture.whenStable();
      expect(element.querySelector(`[data-view="${view}"]`)?.getAttribute('aria-current')).toBe('page');
    }
    await fixture.componentInstance.changeYear(2027);
    expect(api.workspace).toHaveBeenLastCalledWith(2027);
  });

  it('reports refresh failures without pretending the workspace loaded', async () => {
    const { api } = setup('manager');
    api.workspace.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Database unavailable' } }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Database unavailable');
    expect(fixture.nativeElement.textContent).toContain('Try again');
  });

  it('signs out and returns to the sign-in form', async () => {
    const { api } = setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-action="logout"]').click();
    await fixture.whenStable();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('starts a new session and refreshes after a successfully submitted request', async () => {
    const { api, data } = setup();
    api.me.mockRejectedValue(new HttpErrorResponse({ status: 401 }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await fixture.componentInstance.signedIn(data.user);
    fixture.componentInstance.requestOpen.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog')).not.toBeNull();
    await fixture.componentInstance.requestSaved();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Request submitted.');
  });

  it.each([
    { dates: ['2026-01-07'], endDate: '2026-01-07' },
    { dates: ['2026-01-07', '2026-01-09'], endDate: '2026-01-09' },
  ])('prefills the leave form from calendar selection through $endDate and keeps ordinary requests blank', async ({ dates, endDate }) => {
    setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.navigate('calendar');
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    for (const date of dates) {
      element.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!.click();
      await fixture.whenStable();
    }
    element.querySelector<HTMLButtonElement>('[data-action="request-selected-dates"]')!.click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('input[name="startDate"]')?.value).toBe('2026-01-07');
    expect(element.querySelector<HTMLInputElement>('input[name="endDate"]')?.value).toBe(endDate);
    element.querySelector<HTMLButtonElement>('[aria-label="Close request form"]')!.click();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('.page-heading button')!.click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('input[name="startDate"]')?.value).toBe('');
    expect(element.querySelector<HTMLInputElement>('input[name="endDate"]')?.value).toBe('');
  });

  it('shows connection and logout errors, and clears an expired session', async () => {
    const { api } = setup();
    api.me.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Cannot reach the server');
    await fixture.componentInstance.signedIn(fixtureWorkspace().user);
    api.logout.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Service unavailable' } }));
    await fixture.componentInstance.logout();
    expect(fixture.componentInstance.user()).not.toBeNull();
    expect(fixture.componentInstance.error()).toBe('Service unavailable');
    api.workspace.mockRejectedValue(new HttpErrorResponse({ status: 401, error: { message: 'Session expired' } }));
    await fixture.componentInstance.refresh();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[type="password"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Session expired');
  });

  it('does not replace a newer workspace with a late response from an older refresh', async () => {
    const { api, data } = setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    let resolveOld!: (value: typeof data) => void;
    api.workspace.mockImplementationOnce(() => new Promise<typeof data>((resolve) => { resolveOld = resolve; }));
    const older = fixture.componentInstance.refresh();
    const updated = { ...data, today: '2026-01-02' };
    api.workspace.mockResolvedValueOnce(updated);
    await fixture.componentInstance.refresh();
    resolveOld(data);
    await older;
    expect(fixture.componentInstance.data()?.today).toBe('2026-01-02');
  });

  it('removes admin navigation if the server returns a changed role', async () => {
    const { api } = setup('admin');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.navigate('settings');
    api.workspace.mockResolvedValue(fixtureWorkspace());
    await fixture.componentInstance.refresh();
    await fixture.whenStable();
    expect(fixture.componentInstance.view()).toBe('overview');
    expect(fixture.nativeElement.querySelector('[data-view="settings"]')).toBeNull();
  });

  it('opens the correct year and request when following a notification', async () => {
    const { api } = setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await fixture.componentInstance.openNotification({ requestId: 'request-1', year: 2025 });
    await fixture.whenStable();
    expect(api.workspace).toHaveBeenLastCalledWith(2025);
    expect(fixture.nativeElement.querySelector('input[id="request-search"]').value).toBe('request-1');
  });
});
