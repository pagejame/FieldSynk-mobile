# FieldSynk Mobile

The FieldSynk field app — Expo (SDK 56) + React Native, sharing the FieldSynk
Supabase backend. Built to mirror the proven `struksure-mobile` scaffold.

**What's in this first cut (the core loop):**
- Sign in with the same email/password as fieldsynk.org (Supabase Auth).
- **Jobs** tab — every job for your company (row-level-security scoped).
- **Log today** — the mobile Unified Daily Report for a job+date: each crew member
  gets hours (ST/OT/DT) *or* is marked out with a reason; plus work performed and
  (if the company's Materials module is on) materials used. One **Save**.
- **Idempotent by design** — it loads the day's existing rows and edits them in
  place (`lib/daily-report.ts`, the same logic as the web app), so re-saving never
  doubles payroll. A worker with a desktop hours-split is shown read-only ("edit on
  fieldsynk.org") so the phone never clobbers it.

## Setup (James)

```bash
cd "C:/Projects/fieldsynk-mobile"
npm install
cp .env.example .env          # then paste the real anon key (see below)
npx expo start                # scan the QR with Expo Go, or run a dev build
```

**The Supabase anon key:** copy it from the Supabase dashboard →
FieldSynk project → Project Settings → API → Project API keys → `anon` (publishable).
Paste it into `.env` (`EXPO_PUBLIC_SUPABASE_ANON_KEY=...`) **and** into `eas.json`
(all three build profiles) replacing `REPLACE_WITH_FIELDSYNK_PUBLISHABLE_KEY`. It's a
public client key — RLS protects the data — so it's safe to commit in eas.json.

## Ship it (James — needs your accounts)

```bash
npm i -g eas-cli
eas login
eas init                      # creates the EAS project + fills extra.eas.projectId
eas build -p ios --profile production
eas build -p android --profile production
eas submit -p ios            # App Store Connect (Apple Developer account)
eas submit -p android        # Play Console (Google Play account)
```

You'll need the Apple Developer + Google Play accounts and app records. Bundle ids
are `com.fieldsynk.mobile` (both platforms) — change in `app.json` if you prefer.

## Not built yet (follow-ups)
- App icon + splash art (currently Expo defaults — drop real art in `assets/` and
  point `app.json` at it).
- Offline queue (log with no signal, sync later), push notifications, biometric lock
  — all present in `struksure-mobile` and portable here when wanted.
- Scan-a-form capture on device (the web already has AI extraction).

## Status
**Device-unverified.** The code mirrors the proven `struksure-mobile` patterns but
has not been run on a simulator/device from this build — run `npm install` then
`npx expo start` and it should boot. Report anything that doesn't and it gets fixed.
