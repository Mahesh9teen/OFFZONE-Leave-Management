import { Component, computed, inject, input, output, PendingTasks, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AuthOptions, Role, User } from '@leave/contracts';
import { Api } from './api';
import { errorMessage } from './ui-model';
import { Icon } from './icon';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Icon],
  template: `
    <main class="login-layout">
      <section class="login-story">
        <a class="brand" href="/" aria-label="OFFZONE home"><img class="brand-mark" src="favicon.svg" alt=""><span>OFFZONE<small>LEAVE MANAGEMENT</small></span></a>
        <div class="story-content">
          <span class="eyebrow light">GOOD WORK STARTS WITH A LITTLE SPACE</span>
          <h1>Time for work.<br>Room for life.</h1>
          <p>Thoughtful time off, clear balances, and a team that stays in sync. A brighter way to manage leave.</p>
          <div class="story-calendar" aria-hidden="true">
            <div class="story-calendar-title"><span>A well-balanced week</span><span class="tiny-dot"></span></div>
            <div class="story-week">@for (day of ['M', 'T', 'W', 'T', 'F']; track $index) { <span [class.rest-day]="$index > 2">{{ day }}<b>{{ 12 + $index }}</b></span> }</div>
            <div class="story-caption"><span class="avatar small">AR</span><span>A little time to recharge.</span><app-icon name="check" /></div>
          </div>
        </div>
        <p class="story-footer">Clear policies. Fair approvals. Better balance.</p>
      </section>
      <section class="login-main">
        <div class="login-card">
          <span class="eyebrow">YOUR WORKSPACE, IN BALANCE</span>
          <h2>Welcome back.</h2><p class="muted">Sign in to make space for what matters.</p>
          @if (error() || notice()) { <div class="alert error" role="alert">{{ error() || notice() }}</div> }
          @if (loadingOptions()) { <p class="small muted" role="status">Checking sign-in options...</p> }
          @if (!loadingOptions() && !options()) { <button type="button" class="button secondary" data-action="retry-options" (click)="loadOptions()">Retry sign-in options</button> }
          <form #loginForm="ngForm" (ngSubmit)="submit()">
            <fieldset [disabled]="busy() || !options()">
              @if (demoMode()) {
                <div class="demo-selector" role="group" aria-label="Choose a demo portal">
                  <span class="eyebrow">CHOOSE YOUR DEMO PORTAL</span>
                  <div class="demo-roles">
                    @for (role of portalRoles; track role) {
                      <button type="button" [attr.data-portal]="role" [attr.aria-pressed]="selectedRole() === role" (click)="selectedRole.set(role)">{{ portals[role].label }} portal</button>
                    }
                  </div>
                </div>
              }
              <div class="login-field">
                <label for="login-email">Email address</label>
                <input id="login-email" name="email" type="email" [(ngModel)]="email" required email maxlength="254" [autocomplete]="demoMode() ? 'off' : 'username'" [placeholder]="demoMode() ? 'anyone@example.test' : 'you@example.test'" [attr.aria-describedby]="demoMode() ? 'demo-email-hint' : null">
                @if (demoMode()) { <p id="demo-email-hint" class="demo-credential-hint" aria-live="polite">Demo email: <code>{{ selectedPortal().email }}</code></p> }
              </div>
              <div class="login-field">
                <label for="login-password">Password</label>
                <input id="login-password" name="password" type="password" [(ngModel)]="password" required maxlength="256" [autocomplete]="demoMode() ? 'off' : 'current-password'" [placeholder]="demoMode() ? 'Any demo password' : 'Your password'" [attr.aria-describedby]="demoMode() ? 'demo-password-hint' : null">
                @if (demoMode()) { <p id="demo-password-hint" class="demo-credential-hint" aria-live="polite">Demo password: <code>{{ selectedPortal().examplePassword }}</code></p> }
              </div>
              <p class="small muted">Your session stays active for up to 8 hours.</p>
              <button type="submit" class="button primary wide" [disabled]="loginForm.invalid || busy() || !options()">{{ busy() ? 'Signing in...' : 'Sign in to your workspace' }}<app-icon name="right" /></button>
            </fieldset>
            @if (demoMode()) {
              <aside class="demo-note" aria-label="Important demo sign-in note">
                <strong>Important note:</strong>
                <p>This is a demo page. Choose Employee, Manager, or Admin, then use any demo email address and any password to explore that portal.</p>
                <p>The examples above work only in demo mode, not account sign-in. Dummy details are not sent or saved. Actions affect shared demo data, including admin settings.</p>
              </aside>
            }
          </form>
          @if (options()?.demoLoginEnabled) {
            <button type="button" class="text-button login-mode-switch" data-action="switch-login" [disabled]="busy()" (click)="switchMode()">{{ demoMode() ? 'Use account credentials instead' : 'Back to demo sign-in' }}</button>
          }
          @if (options() && !demoMode()) {
            <div class="demo-access"><span class="eyebrow">SEEDED DEMO ACCOUNTS</span><p class="small muted">Choose a role to fill the email. Account sign-in requires the generated SEED_PASSWORD from your local .env file.</p>
              <div class="demo-roles">@for (role of portalRoles; track role) { <button type="button" [disabled]="busy()" (click)="email = portals[role].email">{{ portals[role].label }}</button> }</div>
              <p class="small muted">Also available: employee2-8 and manager2 at example.test.</p>
            </div>
          }
        </div>
        <p class="login-footer">Built for people. Backed by clear rules.</p>
      </section>
    </main>`,
})
export class Login implements OnInit {
  private readonly api = inject(Api);
  private readonly pendingTasks = inject(PendingTasks);
  readonly signedIn = output<User>();
  readonly notice = input('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly options = signal<AuthOptions | null>(null);
  readonly loadingOptions = signal(true);
  readonly accountLogin = signal(false);
  readonly selectedRole = signal<Role>('employee');
  readonly demoMode = computed(() => this.options()?.demoLoginEnabled === true && !this.accountLogin());
  readonly portalRoles: Role[] = ['employee', 'manager', 'admin'];
  readonly portals: Record<Role, { label: string; email: string; examplePassword: string }> = {
    employee: { label: 'Employee', email: 'employee1@example.test', examplePassword: 'Employee@123' },
    manager: { label: 'Manager', email: 'manager1@example.test', examplePassword: 'Manager@123' },
    admin: { label: 'Admin', email: 'admin@example.test', examplePassword: 'Admin@123' },
  };
  readonly selectedPortal = computed(() => this.portals[this.selectedRole()]);
  email = '';
  password = '';

  ngOnInit() { this.loadOptions(); }

  loadOptions() {
    this.pendingTasks.run(async () => {
      this.loadingOptions.set(true);
      this.options.set(null);
      this.error.set('');
      try { this.options.set(await this.api.authOptions()); }
      catch (error) { this.error.set(errorMessage(error)); }
      finally { this.loadingOptions.set(false); }
    });
  }

  switchMode() {
    this.accountLogin.update((value) => !value);
    this.email = '';
    this.password = '';
    this.error.set('');
  }

  async submit() {
    if (!this.options()) {
      this.error.set('Sign-in options are unavailable. Please retry before signing in.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const user = this.demoMode()
        ? await this.api.demoLogin(this.selectedRole())
        : await this.api.login(this.email.trim(), this.password);
      this.signedIn.emit(user);
    }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
