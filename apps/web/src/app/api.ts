import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  AccountProfile, AuthOptions, ConfigurationInput, CreatePersonInput, CreateRequestInput, EditRequestInput, LeaveRequest, LeaveType, ManagedUser,
  NotificationFeed, PasswordInput, PeopleWorkspace, Policy, ProfileInput, RequestAction, RequestDocument, RequestPreview, Role, Team, UpdatePersonInput, User, Workspace,
} from '@leave/contracts';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  me() { return firstValueFrom(this.http.get<User>('/api/auth/me')); }
  authOptions() { return firstValueFrom(this.http.get<AuthOptions>('/api/auth/options')); }
  demoLogin(role: Role) { return firstValueFrom(this.http.post<User>('/api/auth/demo-login', { role })); }
  login(email: string, password: string) { return firstValueFrom(this.http.post<User>('/api/auth/login', { email, password })); }
  logout() { return firstValueFrom(this.http.post<{ message: string }>('/api/auth/logout', {})); }
  workspace(year: number) { return firstValueFrom(this.http.get<Workspace>('/api/workspace', { params: { year } })); }
  preview(input: CreateRequestInput) { return firstValueFrom(this.http.post<RequestPreview>('/api/requests/preview', input)); }
  create(input: CreateRequestInput) { return firstValueFrom(this.http.post<LeaveRequest>('/api/requests', input)); }
  edit(id: string, input: EditRequestInput) { return firstValueFrom(this.http.patch<LeaveRequest>(`/api/requests/${encodeURIComponent(id)}`, input)); }
  previewEdit(id: string, input: EditRequestInput) { return firstValueFrom(this.http.post<RequestPreview>(`/api/requests/${encodeURIComponent(id)}/preview`, input)); }
  transition(id: string, status: RequestAction, note: string, version?: number) {
    return firstValueFrom(this.http.patch<LeaveRequest>(`/api/requests/${encodeURIComponent(id)}/status`, { status, note, ...(version === undefined ? {} : { version }) }));
  }
  configure(input: ConfigurationInput) { return firstValueFrom(this.http.put<Policy>('/api/admin/configuration', input)); }
  addLeaveType(input: Omit<LeaveType, 'id'>) { return firstValueFrom(this.http.post<LeaveType>('/api/admin/leave-types', input)); }
  profile() { return firstValueFrom(this.http.get<AccountProfile>('/api/profile')); }
  updateProfile(input: ProfileInput) { return firstValueFrom(this.http.put<AccountProfile>('/api/profile', input)); }
  changePassword(input: PasswordInput) { return firstValueFrom(this.http.post<User>('/api/profile/password', input)); }
  people() { return firstValueFrom(this.http.get<PeopleWorkspace>('/api/admin/people')); }
  createPerson(input: CreatePersonInput) { return firstValueFrom(this.http.post<ManagedUser>('/api/admin/people', input)); }
  updatePerson(id: string, input: UpdatePersonInput) { return firstValueFrom(this.http.put<ManagedUser>(`/api/admin/people/${encodeURIComponent(id)}`, input)); }
  createTeam(name: string) { return firstValueFrom(this.http.post<Team>('/api/admin/teams', { name })); }
  updateTeam(id: string, name: string) { return firstValueFrom(this.http.put<Team>(`/api/admin/teams/${encodeURIComponent(id)}`, { name })); }
  notifications() { return firstValueFrom(this.http.get<NotificationFeed>('/api/notifications')); }
  readNotification(id: string) { return firstValueFrom(this.http.patch<{ message: string }>(`/api/notifications/${encodeURIComponent(id)}/read`, {})); }
  readNotifications() { return firstValueFrom(this.http.post<{ message: string }>('/api/notifications/read-all', {})); }
  documents(requestId: string) { return firstValueFrom(this.http.get<RequestDocument[]>(this.documentPath(requestId))); }
  uploadDocuments(requestId: string, files: File[]) {
    const body = new FormData();
    for (const file of files) body.append('files', file, file.name);
    return firstValueFrom(this.http.post<RequestDocument[]>(this.documentPath(requestId), body));
  }
  deleteDocument(requestId: string, id: string) { return firstValueFrom(this.http.delete<RequestDocument[]>(`${this.documentPath(requestId)}/${encodeURIComponent(id)}`)); }
  downloadDocument(requestId: string, id: string) {
    return firstValueFrom(this.http.get(`${this.documentPath(requestId)}/${encodeURIComponent(id)}/file`, { responseType: 'blob' }));
  }

  private documentPath(requestId: string) { return `/api/requests/${encodeURIComponent(requestId)}/documents`; }
}
