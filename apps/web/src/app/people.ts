import { Component, computed, inject, output, PendingTasks, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CreatePersonInput, ManagedTeam, ManagedUser, PeopleWorkspace, UpdatePersonInput } from '@leave/contracts';
import { Api } from './api';
import { errorMessage, initials } from './ui-model';
import { Icon } from './icon';
import { Modal } from './modal';

@Component({
  selector: 'app-people',
  imports: [FormsModule, Icon, Modal],
  templateUrl: './people.html',
})
export class People implements OnInit {
  private readonly api = inject(Api);
  private readonly tasks = inject(PendingTasks);
  readonly changed = output<string>();
  readonly data = signal<PeopleWorkspace | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly search = signal('');
  readonly editing = signal<ManagedUser | null>(null);
  readonly editingTeamId = signal<string | null>(null);
  readonly filtered = computed(() => this.data()?.users.filter((user) => `${user.name} ${user.email} ${user.role} ${user.jobTitle}`.toLowerCase().includes(this.search().trim().toLowerCase())) ?? []);
  protected readonly initials = initials;
  newPerson: CreatePersonInput = { name: '', email: '', password: '', role: 'employee', teamId: '', phone: '', jobTitle: '' };
  editDraft: UpdatePersonInput = { name: '', phone: '', jobTitle: '', teamId: null, active: true };
  teamName = '';

  ngOnInit() { this.tasks.run(() => this.load()); }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try { await this.loadData(); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loading.set(false); }
  }

  teamAvailable(team: ManagedTeam, role: 'employee' | 'manager'): boolean {
    return role === 'manager' ? !team.managerId : !!this.data()?.users.some((user) => user.id === team.managerId && user.active);
  }

  pickTeam() { this.newPerson.teamId = this.data()?.teams.find((team) => this.teamAvailable(team, this.newPerson.role))?.id ?? ''; }
  teamNameFor(id: string | null) { return this.data()?.teams.find((team) => team.id === id)?.name ?? 'Administration'; }
  managerHasReports(user: ManagedUser) { return user.role === 'manager' && (this.data()?.teams.find((team) => team.id === user.teamId)?.employeeCount ?? 0) > 0; }

  async createPerson() {
    await this.perform(async () => {
      await this.api.createPerson({ ...this.newPerson });
      this.newPerson = { ...this.newPerson, name: '', email: '', password: '', phone: '', jobTitle: '' };
    }, 'Account created. Share the initial password securely; use account sign-in for this new user.');
  }

  editPerson(user: ManagedUser) {
    this.error.set('');
    this.editing.set(user);
    this.editDraft = { name: user.name, phone: user.phone, jobTitle: user.jobTitle, teamId: user.teamId, active: user.active };
  }

  async updatePerson() {
    const user = this.editing();
    if (!user) { this.error.set('Select an employee to edit.'); return; }
    await this.perform(async () => {
      await this.api.updatePerson(user.id, { ...this.editDraft });
      this.editing.set(null);
    }, 'Account details updated.');
  }

  editTeam(team: ManagedTeam) { this.editingTeamId.set(team.id); this.teamName = team.name; }
  cancelTeamEdit() { this.editingTeamId.set(null); this.teamName = ''; }

  async saveTeam() {
    await this.perform(async () => {
      const id = this.editingTeamId();
      if (id) await this.api.updateTeam(id, this.teamName.trim());
      else await this.api.createTeam(this.teamName.trim());
      this.cancelTeamEdit();
    }, 'Team saved. Create a manager before assigning employees to a new team.');
  }

  private async loadData() {
    this.data.set(await this.api.people());
    if (!this.newPerson.teamId) this.pickTeam();
  }

  private async perform(work: () => Promise<void>, message: string) {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    let saved = false;
    try {
      await work();
      saved = true;
      await this.loadData();
      this.success.set(message);
    } catch (error) {
      this.error.set(saved ? `Changes were saved, but the list could not refresh. ${errorMessage(error)}` : errorMessage(error));
    } finally {
      this.busy.set(false);
      if (saved) this.changed.emit(message);
    }
  }
}
