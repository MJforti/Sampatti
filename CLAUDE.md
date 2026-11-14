# Sampatti — working rules

- Automate every process end to end. For Supabase (project `osdfyaamgifjrurwewfy`), apply migrations, run SQL, deploy edge functions and verify with the Supabase MCP tools directly instead of handing steps to the user. Only ask the user for things that truly require them (secret values typed into the dashboard, choices only they can make).
- Every schema change goes in a new file in `supabase/migrations/` AND is applied to the live project in the same session; run `npm run db:test` first.
- Money is integer paise; never floats. Permissions are enforced by RLS, never only in the UI.
- Design direction: calm, exact, a little warm; ledger (bahi-khata) world; one ink-green accent; sentence-case labels; dates in a mono left margin on lists.
- Supabase MCP tools are pre-approved (.claude/settings.json); never wait for confirmation on Supabase work.
