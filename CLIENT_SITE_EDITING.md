# Client website editing

Signed-in users can open **Site editor** at `account.html?tab=editor` to connect
a client GitHub repository, load a UTF-8 source file, edit its code or HTML title
and description, and commit it to a new branch with a pull request. The default
branch is never written directly. Each submission changes one existing file up
to 200 KB. Framework metadata is edited directly in source; HTML SEO fields
rewrite only the explicit head section (which may normalise head formatting).

## Access protocol

1. The client grants the agency's GitHub account repository write access.
2. For repositories the agency account owns or accesses as an organisation
   member, create an expiring **fine-grained personal access token**, selecting
   only that client repository, with **Contents: read and write** and **Pull
   requests: read and write**. Request organisation approval when applicable.
   GitHub currently does not support fine-grained tokens for outside/repository
   collaborators. For that arrangement use an expiring **classic token** with
   **repo** scope, subject to the client's token policy. Classic tokens cover all
   accessible repositories: use a dedicated agency account to limit that access.
   See [GitHub token limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
3. Sign in to RankHarbour, enter `owner/repository` and the token in Site editor.
   Tokens travel over HTTPS to the authenticated Edge Function and GitHub only.
   They are kept in browser memory, never persisted in storage or the database,
   and cleared when the page reloads, the account changes, signs out or disconnects.
4. Load a source file, edit, enter a change summary and create a pull request.
   Review the GitHub diff and deployment preview, then merge through the client's
   usual GitHub workflow. If the repository changes, reconnect before submitting.
5. At the end of the engagement, revoke the token and remove collaborator access
   in GitHub. Disconnecting RankHarbour clears its session, not the GitHub token.

Hidden files, symlinks, credentials, workflows and generated directories are
excluded. Code is shown as text and never executed in an in-app preview.
Repository write access is verified by GitHub on every operation, independently
of RankHarbour sign-in. No site connection is shared with other accounts.

## Backend deployment and verification

Deploy the authenticated proxy to the linked Supabase project:

```sh
npx supabase functions deploy site-editor
npm run test:site-editor
```

For browser checks, serve the project on localhost port 8765, then run
`node site-editor-ui-check.cjs`. Set `PLAYWRIGHT_MODULE` to your local Playwright
module path if needed. This check mocks Supabase/GitHub responses and does not
change a real client repository.

The function validates the Supabase bearer token with Auth even though gateway
JWT verification is disabled in `supabase/config.toml`. It uses the runtime's
Supabase URL and anon key, and requires no stored GitHub credentials or schema
migration. Never commit a client token. GitHub API references:
[repository contents](https://docs.github.com/en/rest/repos/contents),
[Git database](https://docs.github.com/en/rest/git), and
[pull requests](https://docs.github.com/en/rest/pulls/pulls).
