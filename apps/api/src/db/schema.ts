export const initialSchema = `
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
  team_id uuid REFERENCES teams(id),
  CHECK ((role = 'admin' AND team_id IS NULL) OR (role <> 'admin' AND team_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_manager_per_team ON users(team_id) WHERE role = 'manager';
CREATE INDEX users_team ON users(team_id);

CREATE TABLE leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  yearly_allowance integer NOT NULL CHECK (yearly_allowance BETWEEN 0 AND 366)
);
CREATE UNIQUE INDEX leave_types_name ON leave_types(lower(name));

CREATE TABLE settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  min_notice_days integer NOT NULL CHECK (min_notice_days BETWEEN 0 AND 365),
  max_team_off integer NOT NULL CHECK (max_team_off BETWEEN 1 AND 100),
  version integer NOT NULL DEFAULT 1
);
INSERT INTO settings (min_notice_days, max_team_off) VALUES (2, 2);

CREATE TABLE holidays (
  date date PRIMARY KEY,
  name varchar(100) NOT NULL
);

CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id),
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date AND end_date - start_date < 366),
  working_dates date[] NOT NULL CHECK (cardinality(working_dates) > 0),
  reason varchar(1000) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decision_note varchar(500) NOT NULL DEFAULT ''
);
CREATE INDEX requests_employee ON leave_requests(employee_id, start_date, end_date);
CREATE INDEX requests_active ON leave_requests(employee_id) WHERE status IN ('pending', 'approved');
`;

export const offzoneSchema = `
ALTER TABLE users
  ADD COLUMN phone varchar(32) NOT NULL DEFAULT '',
  ADD COLUMN job_title varchar(100) NOT NULL DEFAULT '',
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  ADD COLUMN photo bytea CHECK (octet_length(photo) <= 524288),
  ADD COLUMN photo_version integer NOT NULL DEFAULT 0 CHECK (photo_version >= 0);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  title varchar(100) NOT NULL,
  message varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications(recipient_id) WHERE read_at IS NULL;

CREATE TABLE request_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  filename varchar(120) NOT NULL,
  mime_type varchar(80) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_request ON request_documents(request_id, created_at);
`;

export const leaveFeaturesSchema = `
ALTER TABLE users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE leave_types
  ADD COLUMN carryover_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE leave_types SET carryover_enabled = true WHERE lower(name) = 'annual';

ALTER TABLE leave_requests
  ADD COLUMN period text NOT NULL DEFAULT 'full' CHECK (period IN ('full', 'am', 'pm')),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN carryover_by_year jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(carryover_by_year) = 'object'),
  ADD COLUMN last_reminded_at timestamptz,
  ADD CONSTRAINT half_day_single_date CHECK (period = 'full' OR start_date = end_date);
UPDATE leave_requests SET updated_at = COALESCE(decided_at, created_at);

CREATE TABLE carryover_grants (
  employee_id uuid NOT NULL REFERENCES users(id),
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  year integer NOT NULL CHECK (year BETWEEN 2027 AND 2100),
  half_units integer NOT NULL CHECK (half_units BETWEEN 0 AND 10),
  expires_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, leave_type_id, year)
);

ALTER TABLE notifications
  ADD COLUMN event_key text,
  ADD COLUMN event_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX notifications_event ON notifications(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  sent_at timestamptz,
  error_code varchar(100) NOT NULL DEFAULT ''
);
CREATE INDEX email_outbox_due ON email_outbox(next_attempt_at) WHERE status IN ('pending', 'sending');
UPDATE settings SET version = version + 1;
`;
