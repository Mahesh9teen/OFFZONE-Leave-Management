import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Api } from './api';
import { fixturePeople, fixtureProfile, fixtureWorkspace } from './testing/fixtures';

describe('same-origin API client', () => {
  let api: Api;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('loads demo options and sends only the selected role, never dummy credentials', async () => {
    const options = api.authOptions();
    http.expectOne('/api/auth/options').flush({ demoLoginEnabled: true });
    await expect(options).resolves.toEqual({ demoLoginEnabled: true });
    const signIn = api.demoLogin('manager');
    const post = http.expectOne('/api/auth/demo-login');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ role: 'manager' });
    post.flush(fixtureWorkspace('manager').user);
    await expect(signIn).resolves.toEqual(fixtureWorkspace('manager').user);
  });

  it('uses cookie-authenticated session endpoints without browser token storage', async () => {
    const data = fixtureWorkspace();
    const login = api.login(data.user.email, 'demo-password');
    const signIn = http.expectOne('/api/auth/login');
    expect(signIn.request.body).toEqual({ email: data.user.email, password: 'demo-password' });
    expect(signIn.request.headers.has('Authorization')).toBe(false);
    signIn.flush(data.user);
    await expect(login).resolves.toEqual(data.user);
    const me = api.me();
    http.expectOne('/api/auth/me').flush(data.user);
    await me;
    const logout = api.logout();
    http.expectOne('/api/auth/logout').flush({ message: 'Signed out.' });
    await logout;
  });

  it('keeps the selected year and mutation payloads intact', async () => {
    const data = fixtureWorkspace();
    const load = api.workspace(2027);
    http.expectOne('/api/workspace?year=2027').flush(data);
    await load;
    const input = { leaveTypeId: 'annual', startDate: '2026-01-05', endDate: '2026-01-06', reason: 'Family time' };
    const preview = api.preview(input);
    const previewRequest = http.expectOne('/api/requests/preview');
    expect(previewRequest.request.body).toEqual(input);
    previewRequest.flush({ workingDates: [], daysByYear: {} });
    await preview;
    const create = api.create(input);
    http.expectOne('/api/requests').flush(data.requests[0]);
    await create;
    const decision = api.transition('request-1', 'approved', 'Enjoy');
    const patch = http.expectOne('/api/requests/request-1/status');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ status: 'approved', note: 'Enjoy' });
    patch.flush(data.requests[0]);
    await decision;
    const config = { settings: data.settings, leaveTypes: data.leaveTypes, holidays: data.holidays };
    const save = api.configure(config);
    const put = http.expectOne('/api/admin/configuration');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(config);
    put.flush(config);
    await save;
    const type = api.addLeaveType({ name: 'Special', yearlyAllowance: 5 });
    http.expectOne('/api/admin/leave-types').flush({ id: 'new', name: 'Special', yearlyAllowance: 5 });
    await type;
  });

  it('loads profile data and preserves profile update request bodies', async () => {
    const profile = fixtureProfile();
    const load = api.profile();
    http.expectOne('/api/profile').flush(profile);
    await load;
    const input = { name: 'Updated name', phone: '+1 555 0100', jobTitle: 'Designer' };
    const update = api.updateProfile(input);
    const put = http.expectOne('/api/profile');
    expect(put.request.body).toEqual(input);
    put.flush(profile);
    await update;
  });

  it('sends pending edits, edit previews and decision versions to the guarded endpoints', async () => {
    const input = { leaveTypeId: 'annual', startDate: '2026-01-05', endDate: '2026-01-05', reason: 'Updated plans', period: 'pm' as const, version: 2 };
    const edit = api.edit('request-1', input);
    const update = http.expectOne('/api/requests/request-1');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual(input);
    update.flush(fixtureWorkspace().requests[0]);
    await edit;
    const preview = api.previewEdit('request-1', input);
    const check = http.expectOne('/api/requests/request-1/preview');
    expect(check.request.body).toEqual(input);
    check.flush({ workingDates: ['2026-01-05'], daysByYear: { '2026': 0.5 } });
    await preview;
    const decision = api.transition('request-1', 'approved', '', 3);
    const patch = http.expectOne('/api/requests/request-1/status');
    expect(patch.request.body).toEqual({ status: 'approved', note: '', version: 3 });
    patch.flush(fixtureWorkspace().requests[0]);
    await decision;
  });

  it('wires account management, password renewal, and private notification actions', async () => {
    const profile = fixtureProfile();
    const password = api.changePassword({ currentPassword: 'current-password', newPassword: 'new-password-123' });
    const change = http.expectOne('/api/profile/password');
    expect(change.request.body).toEqual({ currentPassword: 'current-password', newPassword: 'new-password-123' });
    change.flush(profile.user);
    await password;
    const people = api.people();
    http.expectOne('/api/admin/people').flush(fixturePeople());
    await people;
    const input = { name: 'New person', email: 'new@example.test', password: 'initial-password', role: 'employee' as const, teamId: 'team-1', phone: '', jobTitle: '' };
    const create = api.createPerson(input);
    const post = http.expectOne('/api/admin/people');
    expect(post.request.body).toEqual(input);
    post.flush(fixturePeople().users[0]);
    await create;
    const update = api.updatePerson('employee-1', { name: 'New name', phone: '', jobTitle: '', active: true, teamId: 'team-1' });
    const put = http.expectOne('/api/admin/people/employee-1');
    expect(put.request.method).toBe('PUT');
    put.flush(fixturePeople().users[0]);
    await update;
    const team = api.createTeam('Design');
    http.expectOne('/api/admin/teams').flush({ id: 'team-1', name: 'Design' });
    await team;
    const rename = api.updateTeam('team-1', 'Product');
    http.expectOne('/api/admin/teams/team-1').flush({ id: 'team-1', name: 'Product' });
    await rename;
    const notifications = api.notifications();
    http.expectOne('/api/notifications').flush({ items: [], unreadCount: 0 });
    await notifications;
    const read = api.readNotification('notice-1');
    http.expectOne('/api/notifications/notice-1/read').flush({ message: 'Read' });
    await read;
    const readAll = api.readNotifications();
    http.expectOne('/api/notifications/read-all').flush({ message: 'Read' });
    await readAll;
  });

  it('uploads request documents as multipart and downloads file bytes rather than JSON', async () => {
    const list = api.documents('request-1');
    http.expectOne('/api/requests/request-1/documents').flush([]);
    await list;
    const file = new File(['%PDF'], 'sample.pdf', { type: 'application/pdf' });
    const upload = api.uploadDocuments('request-1', [file]);
    const post = http.expectOne('/api/requests/request-1/documents');
    expect(post.request.body.getAll('files')).toHaveLength(1);
    expect(post.request.body.get('files')).toMatchObject({ name: file.name, type: file.type, size: file.size });
    post.flush([]);
    await upload;
    const download = api.downloadDocument('request-1', 'doc-1');
    const get = http.expectOne('/api/requests/request-1/documents/doc-1/file');
    expect(get.request.responseType).toBe('blob');
    const blob = new Blob(['%PDF'], { type: 'application/octet-stream' });
    get.flush(blob);
    await expect(download).resolves.toBe(blob);
    const remove = api.deleteDocument('request-1', 'doc-1');
    const deletion = http.expectOne('/api/requests/request-1/documents/doc-1');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush([]);
    await remove;
  });
});
