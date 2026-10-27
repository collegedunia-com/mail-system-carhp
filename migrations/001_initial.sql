CREATE TABLE IF NOT EXISTS gmail_accounts (
  id CHAR(36) BINARY PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  status ENUM('connected','disconnected','paused') NOT NULL DEFAULT 'connected',
  history_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY gmail_account_email(email),
  CONSTRAINT account_lowercase CHECK (BINARY email = BINARY LOWER(email))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS outreach (
  id CHAR(36) BINARY PRIMARY KEY,
  spreadsheet_id VARCHAR(128) NOT NULL,
  sheet_name VARCHAR(100) NOT NULL,
  sheet_row_id VARCHAR(128) NOT NULL,
  account_id CHAR(36) BINARY NOT NULL,
  to_email VARCHAR(320) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  merge_data JSON NOT NULL,
  template_snapshot JSON NOT NULL,
  attachment_refs JSON NOT NULL,
  status ENUM('draft','ready','sending','waiting','paused','replied','bounced','suppressed','no_response','needs_review') NOT NULL,
  thread_id VARCHAR(128) NULL,
  initial_sent_at DATETIME(3) NULL,
  last_reply_at DATETIME(3) NULL,
  followup_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_followup_at DATETIME(3) NULL,
  error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY outreach_sheet_row(spreadsheet_id,sheet_name,sheet_row_id),
  UNIQUE KEY outreach_thread(account_id,thread_id),
  KEY outreach_due(account_id,status,next_followup_at),
  CONSTRAINT outreach_account FOREIGN KEY(account_id) REFERENCES gmail_accounts(id),
  CONSTRAINT outreach_step_range CHECK (followup_count BETWEEN 0 AND 3),
  CONSTRAINT recipient_lowercase CHECK (BINARY to_email = BINARY LOWER(to_email))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS email_messages (
  id CHAR(36) BINARY PRIMARY KEY,
  outreach_id CHAR(36) BINARY NULL,
  account_id CHAR(36) BINARY NOT NULL,
  direction ENUM('out','in') NOT NULL,
  step INT UNSIGNED NULL,
  subject TEXT NOT NULL,
  body_text LONGTEXT NOT NULL,
  gmail_message_id VARCHAR(128) NULL,
  rfc_message_id VARCHAR(512) NULL,
  send_state ENUM('prepared','sending','accepted','failed','uncertain','received') NOT NULL,
  classification VARCHAR(32) NULL,
  accepted_at DATETIME(3) NULL,
  reconcile_checks INT UNSIGNED NOT NULL DEFAULT 0,
  last_reconciled_at DATETIME(3) NULL,
  retry_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY one_outbound_step(outreach_id,step),
  UNIQUE KEY gmail_message_identity(account_id,gmail_message_id),
  KEY email_account_time(account_id,accepted_at),
  CONSTRAINT message_outreach FOREIGN KEY(outreach_id) REFERENCES outreach(id),
  CONSTRAINT message_account FOREIGN KEY(account_id) REFERENCES gmail_accounts(id),
  CONSTRAINT message_step_range CHECK (step IS NULL OR step BETWEEN 0 AND 3),
  CONSTRAINT message_direction_step CHECK ((direction='out' AND step IS NOT NULL) OR (direction='in' AND step IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS send_attempts (
  id CHAR(36) BINARY PRIMARY KEY,
  message_id CHAR(36) BINARY NOT NULL,
  status ENUM('sending','accepted','failed','uncertain') NOT NULL,
  http_status INT NULL,
  error TEXT NULL,
  attempted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY attempt_time(attempted_at),
  CONSTRAINT attempt_message FOREIGN KEY(message_id) REFERENCES email_messages(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS suppressed_recipients (
  email VARCHAR(320) PRIMARY KEY,
  reason VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT suppressed_lowercase CHECK (BINARY email = BINARY LOWER(email))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
