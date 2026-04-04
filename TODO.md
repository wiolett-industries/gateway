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
- [x] Add secrets in containers
- [x] Add ability to pin containers too
- [x] Update command palette, AI tools/docs and scopes (after all changes finished)
- [x] Check that group nesting works only for top level groups
- [x] Change input to combobox in container creation image selector
- [x] When stopping/reloading container from list list is not invalidated (status stay same)
- [x] on docker containers list page node badge text width wrong (on all tabs)
- [x] Images/nets/vols should be shown as used even if container with them stopped
- [x] Add console support to the shared library to be able to open console on node directly (separate scope)
- [x] Remake image pull modal
- [x] Working with compose
- [x] Make tabs in route for other pages too (not only templates and nginx)

## Future

- [ ] Configurable shortcuts
- [ ] Add docker container templates

## Open

- [ ] Write manual testcases and do full check on two external servers
- [ ] Create bastion daemon and integration here in app
- [ ] Separate daemon deploy tags from gateway deploy tags (not sure how to)
- [ ] Deduplicate whole frontend
- [ ] Verify all pages have data live update (polling or streaming)
- [ ] Webhook notifications on events

## Up next
- [ ] Fix RO design of secrets
- [ ] Virtualization for infinite scrolling lists
- [ ] Add ability to change image per ct + full portainer update flow w/ API/webhook
