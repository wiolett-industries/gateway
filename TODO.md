# TODO

## Completed

- [x] Globally no padding bottom in scrollable tab sections
- [x] Add ability to pin proxy hosts
- [x] Proxy type selector empty when in raw mode in edit modal
- [x] No explicit typings on nodes in diff app parts
- [x] Remake nodes list
- [x] Missing node-specific scopes in tokens/groups and node-action specific scopes too
- [x] Need to verify AI integration is still intact and add missing tools and prompts and docs for new tools/features
- [x] Create monitoring daemon and integration here in app
- [x] In nodes list on dashboard replace plaintext labels with badges
- [x] On node info page add system stats like public ip, OS info etc...
- [x] Daemon install script should be interactive (enter gateway IP/domain and gRPC port and token, flags allow skip interactive parts but optional)
- [x] When duplicating container navigate to duplicated container
- [x] After container deletion containers list is not invalidated, check same for other docker pages
- [x] Recent activity in container overview not updates automatically within update cycle
- [x] Some files (json at least) not converted back to normal from b64
- [x] Last health bar in health check row is gray when not enough data in bucket need to color in current state color in that case
- [x] Create docker daemon and integration here in app
- [x] Daemon logs no-op

## Open

- [ ] Write manual testcases and do full check on two external servers
- [ ] Create bastion daemon and integration here in app
- [ ] Separate daemon deploy tags from gateway deploy tags (not sure how to)
- [ ] Deduplicate whole frontend
- [ ] Verify all pages have data live update (polling or streaming)
- [ ] Update command palette, AI tools/docs and scopes (after all changes finished)
- [ ] Webhook notifications on events
- [ ] Check that group nesting works only for top level groups
- [ ] Add secrets in containers
- [ ] Show docker section in sidebar only when at least one docker node connected (may be disabled but should exist)
- [ ] Remake image pull modal
- [ ] Change input to combobox in container creation image selector
- [ ] Add ability to pin containers too
- [ ] Add console support to the shared library to be able to open console on node directly (separate scope)
- [ ] Template creation modal is no-op
