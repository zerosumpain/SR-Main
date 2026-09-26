# Strange Ramblings — SR-Main

The SvelteKit application behind [Strange Ramblings](https://strangeramblings.com).
Main owns the site shell, authentication, shared schema, and the application
surfaces that have not moved to an independently released repository.

## Working here

Use an isolated local database and local credentials. The cumulative development
stack and its endpoints are documented in `/home/john/docker/local/README.md`.

```sh
npm ci
npm run dev
npm run validate:change
```

`validate:change` chooses the appropriate checks for a change. See the
[deployment runbook](docs/deployment-runbook.md) for release checks and
`npm run deploy:status` for the revision currently served by the site.

## Documentation and ownership

- [Current documentation](docs/README.md): operational guides, active contracts,
  and the historical archive in the site's owner Drive.
- [Extracted application ownership](docs/extracted-app-ownership.md): schema and
  cross-repository responsibilities.
- [Agent guidance](CLAUDE.md): development constraints and domain conventions.
- [Field Study System](field-study-system/INSTRUCTIONS.md): the page-authoring
  procedure for research projects.

Before changing an extracted feature, consult `docs/module-ownership.json` and
SR-Infra's application registry. Removing Main's old routes does not remove
shared schema obligations. Releases use the existing CI process.
