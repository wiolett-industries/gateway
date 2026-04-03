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

## Open

- [ ] Add docker container templates
- [ ] Write manual testcases and do full check on two external servers
- [ ] Create bastion daemon and integration here in app
- [ ] Separate daemon deploy tags from gateway deploy tags (not sure how to)
- [ ] Deduplicate whole frontend
- [ ] Verify all pages have data live update (polling or streaming)
- [ ] Webhook notifications on events
- [ ] Add console support to the shared library to be able to open console on node directly (separate scope)
- [ ] Make tabs in route for other pages too (not only templates and nginx)

## Up next
- [ ] Remake image pull modal
- [ ] Fix RO design of secrets

## Scopes

### Docker
docker:containers:list[:nodeid] - list docker containers global or for specific node
docker:containers:view[:containerid/nodeid] - view container details global or for specific node
docker:containers:create[:nodeid] - create new container global or for specific node
docker:containers:delete[:nodeid] - delete container global or for specific node
docker:containers:edit[:containerid/nodeid] - modify specifc container/node containers/all containers settings etc..
docker:containers:manage[:containerid/nodeid] - ability to start/stop/kill/recreate etc container
docker:containers:environment[:containerid/nodeid] - ability to modify container env variables
docker:containers:secrets[:containerid/nodeid] - ability to uncensor secrets (decrypt)
docker:containers:files[:containerid/nodeid] - ability to see files/edit etc.. (files tab)
docker:containers:console[:containerid/nodeid] - ability to use console
docker:volumes:list[:nodeid] - list vols
docker:volumes:create[:nodeid] - create vol
docker:volumes:delete[:nodeid] - delete vol
docker:networks:list[:nodeid] - list nets
docker:networks:create[:nodeid] - create nets
docker:networks:delete[:nodeid] - delete networks
docker:images:list[:nodeid] - list images
docker:images:pull[:nodeid] - pull images global or for specific node
docker:images:delete[:nodeid] - delete images global or for specific node
docker:templates:list[:nodeid] - list templates global or for specific node
docker:templates:view[:nodeid] - view template global or for specific node
docker:templates:create[:nodeid] - create new templates global or for specific node
docker:templates:edit[:nodeid] - edit existing template global or for specific node
docker:templates:delete[:nodeid] - delete template global or for specific node
docker:registries:delete[:nodeid] - allow delete registries, if global (no id provided) then allow global registries creation, else only node-specific
docker:registries:create[:nodeid] - create registry, if global (no id provided) then allow global registries creation, else only node-specific
docker:tasks - list tasks, should only show tasks for nodes for which user has at least list access to

* - all registries available to all users to pull from

### Nodes
nodes:list[:docker/bastion/nginx/monitoring]
nodes:details[:id]
nodes:create[:docker/bastion/nginx/monitoring]
nodes:rename[:id]
nodes:delete[:id]
nodes:config:view[:id]
nodes:config:edit[:id]
nodes:logs[:id]

### PKI CA
pki:ca:list:root
pki:ca:list:intermediate[:root ca]
pki:ca:view:root
pki:ca:view:intermediate[:root ca]
pki:ca:create:root
pki:ca:create:intermediate[:root ca]
pki:ca:revoke:root
pki:ca:revoke:intermediate[:root ca]

### PKI certs
pki:cert:list[:ca]
pki:cert:view[:ca]
pki:cert:issue[:ca]
pki:cert:revoke[:ca]
pki:cert:export[:ca]

### PKI cert templates
pki:templates:list
pki:templates:create
pki:templates:edit
pki:templates:delete

### SSL certs
ssl:cert:list
ssl:cert:view[:id]
ssl:cert:issue
ssl:cert:revoke[:id]
ssl:cert:export[:id]

### Proxies
proxy:list
proxy:view[:proxy]
proxy:create[:proxy]
proxy:edit[:proxy]
proxy:delete[:proxy]
proxy:raw:toggle[:proxy]
proxy:raw:read[:proxy]
proxy:raw:write[:proxy]
proxy:advanced[:proxy]

### Access control lists
acl:list
acl:view[:id]
acl:edit[:id]
acl:create
acl:delete[:id]

### Features
feat:ai:use
feat:ai:configure

# Admin
admin:users
admin:groups
admin:audit
admin:system
admin:update
admin:housekeeping
admin:alerts

[:xxx] - optional parameter (restriction to specific resource)
