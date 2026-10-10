# Managed website access

The signed-in dashboard's **Site access** tab (`account.html?tab=editor`)
explains that RankHarbour will contact the client directly to arrange GitHub
repository access with them or their developer. Clients do not need to enter
tokens, connect repositories or edit code in their account.

RankHarbour handles SEO tags and source updates once access has been arranged.
The message is informational; it does not send an email or create a contact task.

The existing `site-editor` Supabase function and its GitHub workflow tests remain
available for future internal tooling. There is no customer-facing caller for
that function. Its authenticated API creates a branch and pull request rather
than updating the default branch directly.

Run `npm run test:site-editor` to check that retained backend workflow.
