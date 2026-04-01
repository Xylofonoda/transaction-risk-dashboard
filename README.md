# Pulse — Transaction Risk Dashboard

A real-time transaction risk management dashboard built for fraud analysts. Supports Czech and Polish locales with full currency formatting, AI-powered risk analysis via OpenAI, and a live review queue workflow.

---

## Features

- **Transaction Table** — paginated table with merchant autocomplete search, status filters (Flagged / Pending / Approved / Declined), and risk level filters (Critical / High / Medium / Low). Fixed-width columns with horizontal scroll on mobile.
- **Checkbox Multi-select** — check individual rows or select all on the current page; an action bar appears to bulk-add selected transactions to the review queue in one click.
- **CSV / XLSX Upload** — drag a file onto the empty table or use the Upload button. A 5-step dialog handles AI column mapping, data preview, sanitization (formula injection strip), and batch insert (50 rows at a time).
- **AI Column Normalization** — the `normalize-csv-headers` Edge Function fuzzy-matches arbitrary column names to the expected schema so uploads work even with inconsistently named files.
- **AI Risk Analysis** — click any transaction to open the detail modal and generate an AI risk summary. OpenAI re-evaluates the risk score and risk factors; transactions scoring below 50 are auto-approved.
- **Bulk AI Analysis** — "Analyze All" runs up to 10 concurrent AI requests with a live `done/total` progress counter. Already-scored transactions are skipped.
- **Needs Review Chip** — unscored pending transactions show a pulsing purple "Needs Human Review" badge in the table.
- **Review Queue** — add transactions via checkboxes or bulk-enqueue all high-risk ones (score ≥ 70). Approve or decline directly from the sidebar; each item links back to the full detail modal.
- **Credit Limit Management** — set or update a user's credit limit with an optional reason, persisted to Supabase.
- **Language Switcher** — toggle between Czech (CZK) and Polish (PLN) instantly. All UI strings, currency formatting, and date formatting update on the fly.
- **Dark / Light Mode** — sun/moon toggle in the navbar, applied via a `dark` class on `<html>`.
- **Toast Notifications** — success and error toasts for every mutating action.
- **Mobile Friendly** — responsive layout, collapsible filter drawer, horizontal table scroll, stacked queue panel on small screens.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| State | Redux Toolkit + RTK Query |
| UI | Tailwind CSS v3 + shadcn/ui + Radix UI |
| Forms | React Hook Form + Zod |
| File Parsing | PapaParse (CSV) + xlsx (XLS/XLSX) + react-dropzone |
| Backend | Supabase (PostgreSQL + REST API + Edge Functions) |
| AI | OpenAI GPT-4o via Supabase Edge Functions |
| i18n | Custom locale context (CS-CZ / PL-PL) |
| Testing | Vitest + Testing Library |

---

## Getting Started

### 1. Clone and install

```bash
npm install
```

### 2. Set up Supabase

Create a project at [supabase.com](https://supabase.com), then run `supabase/schema.sql` in the SQL Editor to create the tables, the `profiles` table, and all RLS policies (including the anon insert policy on `transactions`).

### 3. Environment variables

Create a `.env` file in the root:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-legacy-anon-key>
```

> Use the **legacy anon/public** JWT key from Project Settings → API → Legacy API Keys.

### 4. Seed the database

Run `supabase/seed.sql` in the Supabase SQL Editor to insert 3 profiles, 30 sample transactions, and 3 credit limits.

### 5. Deploy Edge Functions

In **Supabase Dashboard → Edge Functions**, create three functions and paste the corresponding source from `src/`:

| Function name | Purpose |
|---|---|
| `generate-risk-summary` | AI risk scoring via OpenAI GPT-4o |
| `normalize-csv-headers` | Fuzzy-match uploaded column names to schema |
| `resolve-user-emails` | Resolve or auto-create profile IDs for uploaded emails |

Add your OpenAI key as a secret in **Project Settings → Edge Functions**:

```
OPENAI_API_KEY=sk-...
```

### 6. Run the dev server

```bash
npm run dev
```

### 7. Run tests

```bash
npm test            # watch mode
npm run test:coverage
```

---

## Project Structure

```
src/
  app/                  # Redux store + typed hooks
  components/
    FileUpload/         # UploadDialog — 5-step CSV/XLSX import wizard
    CreditLimitForm/    # Credit limit update form
    ReviewQueue/        # Sidebar queue with approve/decline actions
    RiskFactorModal/    # Transaction detail + AI analysis modal
    TransactionCard/    # Single transaction card (used in modal)
    TransactionTable/   # Main paginated table with filters + checkbox selection
    ui/                 # shadcn/ui primitives
  contexts/             # LocaleContext (language, currency, date formatting)
  features/
    reviewQueue/        # Redux slice for in-memory queue
    transactions/       # RTK Query API (8 endpoints)
  hooks/                # use-toast
  i18n/                 # Czech and Polish translation strings
  lib/
    csvSanitizer.ts     # Formula injection strip + field validation
    fileParser.ts       # PapaParse / xlsx unified parser
    supabase.ts         # Supabase client
    utils.ts            # cn() helper
  pages/
    Dashboard.tsx       # Main page — orchestrates all components
  test/
    setup.ts            # Vitest + Testing Library setup
  types/
    transaction.ts      # Transaction type + risk level helpers
supabase/
  schema.sql            # Table definitions + RLS policies
  seed.sql              # Sample profiles, transactions, credit limits
public/
  favicon.svg           # Pulse activity-line icon
  sample-transactions.csv  # Example upload file (intentionally misnamed columns)
```

---

## Database Schema

### `transactions`
| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| amount | numeric | Transaction amount |
| currency | text | `CZK` or `PLN` |
| merchant_name | text | Merchant name |
| status | text | `pending`, `flagged`, `approved`, `declined` |
| risk_score | integer | 0–100, AI-assigned (0 = not yet analyzed) |
| risk_factors | text[] | Array of risk tags |
| user_id | uuid | FK → `profiles.id` |
| created_at | timestamptz | Transaction timestamp |

### `user_credit_limits`
| Column | Type | Description |
|---|---|---|
| user_id | uuid | PK, FK → `profiles.id` |
| credit_limit | numeric | Assigned credit limit |
| reason | text | Optional analyst note |
| updated_at | timestamptz | Last update timestamp |

### `profiles`
| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| email | text | Unique user email |
| created_at | timestamptz | Profile creation timestamp |

