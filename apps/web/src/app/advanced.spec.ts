import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { Api } from './api';
import { Account } from './account';
import { People } from './people';
import { NotificationCenter } from './notification-center';
import { RequestDocuments } from './request-documents';
import { fixturePeople, fixtureProfile, fixtureRequest, fixtureWorkspace } from './testing/fixtures';

describe('OFFZONE advanced screens', () => {
  const api = {
    profile: vi.fn(), updateProfile: vi.fn(), changePassword: vi.fn(),
    people: vi.fn(), createPerson: vi.fn(), updatePerson: vi.fn(), createTeam: vi.fn(), updateTeam: vi.fn(),
    notifications: vi.fn(), readNotification: vi.fn(), readNotifications: vi.fn(),
    documents: vi.fn(), uploadDocuments: vi.fn(), deleteDocument: vi.fn(), downloadDocument: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    api.profile.mockResolvedValue(fixtureProfile());
    api.people.mockResolvedValue(fixturePeople());
    api.notifications.mockResolvedValue({ items: [], unreadCount: 0 });
    api.documents.mockResolvedValue([]);
    TestBed.configureTestingModule({ imports: [Account, People, NotificationCenter, RequestDocuments], providers: [{ provide: Api, useValue: api }] });
  });

  async function mount<T>(component: Type<T>, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(component);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return fixture;
  }

  it('saves editable profile fields while showing protected account identity read-only', async () => {
    const fixture = await mount(Account);
    const component = fixture.componentInstance;
    component.draft = { name: 'Alex Updated', phone: '+1 555 0100', jobTitle: 'Designer' };
    api.updateProfile.mockResolvedValue({ ...fixtureProfile(), ...component.draft, user: { ...fixtureProfile().user, name: component.draft.name } });
    const changed = vi.fn();
    component.changed.subscribe(changed);
    await component.save();
    await fixture.whenStable();
    expect(api.updateProfile).toHaveBeenCalledWith(component.draft);
    expect(changed).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('employee1@example.test');
    expect(fixture.nativeElement.querySelector('input[name="email"]')).toBeNull();
  });

  it('keeps profile details and password settings without photo-management controls', async () => {
    const fixture = await mount(Account);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('input[type="file"]')).toBeNull();
    expect(element.textContent).not.toContain('Profile photo');
    expect(element.querySelector('input[name="profileName"]')).not.toBeNull();
    expect(element.querySelector('[data-form="password"]')).not.toBeNull();
  });

  it('disables password changes in demo sessions and surfaces save errors', async () => {
    api.profile.mockResolvedValue({ ...fixtureProfile(), demoSession: true });
    const fixture = await mount(Account);
    expect(fixture.nativeElement.querySelector('[data-form="password"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('account credentials');
    api.updateProfile.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Could not save profile' } }));
    await fixture.componentInstance.save();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Could not save profile');
  });

  it('validates password confirmation and clears credentials after a successful change', async () => {
    const fixture = await mount(Account);
    const component = fixture.componentInstance;
    component.password = { currentPassword: 'old-password', newPassword: 'new-password-123', confirmation: 'different' };
    await component.changePassword();
    expect(api.changePassword).not.toHaveBeenCalled();
    component.password.confirmation = component.password.newPassword;
    api.changePassword.mockResolvedValue(fixtureProfile().user);
    await component.changePassword();
    expect(api.changePassword).toHaveBeenCalledWith({ currentPassword: 'old-password', newPassword: 'new-password-123' });
    expect(component.password.currentPassword).toBe('');
  });

  it('shows profile-load failures', async () => {
    const fixture = await mount(Account);
    api.profile.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Profile unavailable' } }));
    await fixture.componentInstance.load();
    expect(fixture.componentInstance.error()).toContain('Profile unavailable');
  });

  it('creates people and teams without exposing admin role creation', async () => {
    const fixture = await mount(People);
    const component = fixture.componentInstance;
    component.newPerson = { name: 'New Employee', email: 'new@example.test', role: 'employee', teamId: 'team-1', password: 'initial-password-123', phone: '', jobTitle: '' };
    api.createPerson.mockResolvedValue(fixturePeople().users[0]);
    await component.createPerson();
    expect(api.createPerson).toHaveBeenCalledWith(expect.objectContaining({ role: 'employee', email: 'new@example.test' }));
    expect(component.newPerson.password).toBe('');
    component.teamName = 'New team';
    api.createTeam.mockResolvedValue({ id: 'new-team', name: 'New team' });
    await component.saveTeam();
    expect(api.createTeam).toHaveBeenCalledWith('New team');
    expect(fixture.nativeElement.querySelector('select[name="newRole"] option[value="admin"]')).toBeNull();
  });

  it('edits people with history-protected teams and reports administrative conflicts', async () => {
    const fixture = await mount(People);
    const component = fixture.componentInstance;
    component.editPerson(fixturePeople().users[0]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('select[name="editTeam"]').disabled).toBe(true);
    api.updatePerson.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: 'Resolve pending leave first' } }));
    await component.updatePerson();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Resolve pending leave first');
  });

  it('saves an account edit and renames a team, and keeps a saved result explicit if reloading fails', async () => {
    const fixture = await mount(People);
    const component = fixture.componentInstance;
    component.editPerson(fixturePeople().users[0]);
    component.editDraft.jobTitle = 'Designer';
    api.updatePerson.mockResolvedValue(fixturePeople().users[0]);
    await component.updatePerson();
    expect(component.editing()).toBeNull();
    expect(api.updatePerson).toHaveBeenCalledWith('employee-1', expect.objectContaining({ jobTitle: 'Designer', teamId: 'team-1' }));
    component.editTeam(fixturePeople().teams[0]);
    component.teamName = 'Renamed team';
    api.updateTeam.mockResolvedValue({ id: 'team-1', name: component.teamName });
    api.people.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Directory unavailable' } }));
    await component.saveTeam();
    expect(api.updateTeam).toHaveBeenCalledWith('team-1', 'Renamed team');
    expect(component.error()).toContain('Changes were saved');
    expect(component.editingTeamId()).toBeNull();
  });

  it('shows private notifications and marks them read before opening their request', async () => {
    const notice = { id: 'notice-1', title: 'Leave approved', message: 'Your leave was approved.', requestId: 'request-1', requestYear: 2026, createdAt: '2026-01-01T10:00:00Z', readAt: null };
    api.notifications.mockResolvedValue({ items: [notice], unreadCount: 1 });
    const fixture = await mount(NotificationCenter);
    const component = fixture.componentInstance;
    const open = vi.fn();
    component.requestOpened.subscribe(open);
    await component.open();
    api.readNotification.mockResolvedValue({});
    await component.visit(notice);
    expect(api.readNotification).toHaveBeenCalledWith('notice-1');
    expect(open).toHaveBeenCalledWith({ requestId: 'request-1', year: 2026 });
  });

  it('shows notification loading failures instead of an empty-success state', async () => {
    api.notifications.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Notifications unavailable' } }));
    const fixture = await mount(NotificationCenter);
    await fixture.componentInstance.open();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Notifications unavailable');
  });

  it('marks all notifications read and surfaces failed read operations', async () => {
    const fixture = await mount(NotificationCenter);
    api.readNotifications.mockResolvedValue({});
    await fixture.componentInstance.readAll();
    expect(api.readNotifications).toHaveBeenCalledOnce();
    api.readNotifications.mockRejectedValue(new HttpErrorResponse({ status: 503, error: { message: 'Could not mark notifications' } }));
    await fixture.componentInstance.readAll();
    expect(fixture.componentInstance.error()).toContain('Could not mark notifications');
  });

  it('uploads supporting documents for the owner of a pending request and allows deletion', async () => {
    const fixture = await mount(RequestDocuments, { request: fixtureRequest(), user: fixtureWorkspace().user });
    const component = fixture.componentInstance;
    const document = { id: 'doc-1', requestId: 'request-1', filename: 'medical-demo.pdf', mimeType: 'application/pdf', size: 100, createdAt: '2026-01-01T10:00:00Z' };
    const file = new File(['%PDF'], document.filename, { type: 'application/pdf' });
    component.files.set([file]);
    api.uploadDocuments.mockResolvedValue([document]);
    await component.upload();
    await fixture.whenStable();
    expect(api.uploadDocuments).toHaveBeenCalledWith('request-1', [file]);
    expect(fixture.nativeElement.textContent).toContain(document.filename);
    api.deleteDocument.mockResolvedValue([]);
    await component.remove(document);
    expect(api.deleteDocument).toHaveBeenCalledWith('request-1', 'doc-1');
  });

  it('keeps approved-request documents read-only and displays access failures', async () => {
    const fixture = await mount(RequestDocuments, { request: fixtureRequest({ status: 'approved' }), user: fixtureWorkspace().user });
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    api.documents.mockRejectedValue(new HttpErrorResponse({ status: 403, error: { message: 'Access denied' } }));
    await fixture.componentInstance.load();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Access denied');
  });

  it('validates document selection and preserves retryable upload errors', async () => {
    const fixture = await mount(RequestDocuments, { request: fixtureRequest(), user: fixtureWorkspace().user });
    const component = fixture.componentInstance;
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['script'], 'file.html', { type: 'text/html' })] });
    input.dispatchEvent(new Event('change'));
    expect(component.files()).toHaveLength(0);
    expect(component.error()).toContain('PDF, JPEG, or PNG');
    const pdf = new File(['%PDF'], 'sample.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { configurable: true, value: [pdf] });
    input.dispatchEvent(new Event('change'));
    api.uploadDocuments.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { message: 'Request already decided' } }));
    await component.upload();
    expect(component.files()).toEqual([pdf]);
    expect(component.error()).toContain('already decided');
  });
});
