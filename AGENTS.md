# Agent instructions

Before changing or running this project, read `README.md` and `AI-DEPLOY.md` completely.

- Use Node.js 22.13+ LTS or Node.js 24 and install with `npm ci`.
- Inspect `git status` before edits; preserve unrelated user files and never use destructive cleanup.
- Run `npm run lint` and `npm test` after implementation changes.
- Keep missing facts as `null`; unknown does not mean false.
- Keep platform evidence, Mock comments, and session comments visibly distinct.
- Indoor locations and new toilets must remain candidates until multi-user verification publishes them.
- Do not let paid placement affect emergency ranking.
- Health observations are entertainment and safety triage, never medical diagnosis.
- Preserve OpenStreetMap attribution and ODbL notices.
- Never commit secrets, cookies, personal locations, or individual health records.
