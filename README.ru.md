[English](README.md) | Русский | [中文](README.cn.md)

# Gateway

Самостоятельно размещаемая панель управления инфраструктурой для reverse proxy, Docker-нагрузок, сертификатов, баз данных, логов, мониторинга, статус-страниц и автоматизации.

> Основная разработка ведется в [Wiolett Industries GitLab](https://gitlab.wiolett.net/wiolett/gateway). [GitHub-репозиторий](https://github.com/wiolett-industries/gateway) является публичным зеркалом. Issues и запросы функций можно оставлять на [GitHub](https://github.com/wiolett-industries/gateway/issues).

## Зачем нужен Gateway

Gateway дает небольшим инфраструктурным командам один продукт для ежедневной работы, которая обычно разбросана между nginx-конфигами, shell-скриптами, Docker-хостами, папками с сертификатами, клиентами баз данных, дашбордами и alert-инструментами.

Используйте Gateway, если хотите:

- Управлять несколькими proxy, Docker и monitoring узлами без открытия входящих management-портов на этих узлах.
- Дать операторам сфокусированный UI и API для production-задач без выдачи root shell access.
- Централизовать TLS, внутреннюю PKI, ACME-сертификаты, домены, статус-страницы, уведомления и audit history.
- Управлять Docker-контейнерами, deployments, логами, файлами, консолями, secrets и registry workflows из одного места.
- Предоставить контролируемую автоматизацию через API tokens, OAuth, CI/CD webhooks и MCP clients.

## Самая быстрая установка

Установите Gateway на Linux-сервер с Docker:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash
```

Инсталлятор спросит домен, OIDC provider, SSL mode, resource profile и настройки log rotation. После завершения откройте Gateway, войдите в систему и добавьте первый узел.

Флаги, non-interactive install, custom SSL, OIDC details, updates и node setup описаны в [installation guide](docs/installation.md).

## С чего начать

| Цель | Читать |
|------|--------|
| Понять, чем может управлять Gateway | [Capabilities](docs/capabilities.md) |
| Установить Gateway | [Installation guide](docs/installation.md) |
| Добавить nginx, Docker или monitoring узлы | [Nodes and daemons](docs/nodes.md) |
| Настроить tokens, OAuth, MCP, logging, updates и AI | [Operations guide](docs/operations.md) |
| Понять license tiers и activation | [Licensing](docs/licensing.md) |
| Запустить проект локально или внести вклад | [Development guide](docs/development.md) |
| Посмотреть permission scopes | [SCOPES.md](SCOPES.md) |

## Обзор продукта

<table>
<tr>
<td align="center"><strong>Dashboard</strong></td>
<td align="center"><strong>Nginx Monitoring</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/dashboard.png" width="450" alt="Dashboard"></td>
<td><img src="docs/screenshots/nginx-monitoring.png" width="450" alt="Nginx Monitoring"></td>
</tr>
<tr>
<td align="center"><strong>Proxy Host Config</strong></td>
<td align="center"><strong>Settings</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/proxy-host.png" width="450" alt="Proxy Host Config"></td>
<td><img src="docs/screenshots/settings.png" width="450" alt="Settings"></td>
</tr>
</table>

## Что покрывает Gateway

| Область | Кратко |
|---------|--------|
| Reverse proxy | Multi-node nginx management, proxy hosts, redirects, WebSockets, access lists, health checks, host folders, templates, logs и stats. |
| Docker | Container lifecycle, deployments, rollout/rollback, registries, images, webhooks, logs, console, file browser, secrets, env vars, ports, mounts и cleanup. |
| Certificates | ACME SSL, uploaded certificates, internal root/intermediate CAs, certificate templates, CRLs, exports и proxy binding. |
| Domains | Central domain registry, DNS checks, record validation и usage tracking. |
| Databases | Saved PostgreSQL и Redis connections, encrypted credentials, health history, schema/key browsing, query consoles и write operations. |
| Monitoring | Node CPU, memory, disk, network, service status, daemon runtime details, log streaming и update checks. |
| Logging | Опциональный ClickHouse-backed structured log ingestion со schemas, retention, ingest tokens, rate limits и search. |
| Automation | API tokens, OAuth 2.0 PKCE, remote MCP endpoint, CI/CD webhooks, webhook notifications, status pages и optional AI assistant. |
| Administration | OIDC login, group-based permissions, scoped programmatic access, audit logs, setup state, updates и license controls. |

## Как это работает

Gateway запускается как Docker stack на control-plane сервере. Managed hosts запускают небольшие Go daemons, которые подключаются к Gateway исходящим gRPC с mTLS.

```text
                Gateway server
        +-----------------------------+
        | app + postgres + redis      |
        | optional clickhouse         |
        | gRPC :9443                  |
        +-------------+---------------+
                      |
                outbound mTLS
                      |
        +-------------+-------------------+
        |             |                   |
 nginx-daemon   docker-daemon     monitoring-daemon
 proxy host     container host    metrics-only host
```

Узлам не нужны входящие management-порты. Public traffic ports, например `80` и `443` на nginx nodes, все еще нужны для сервисов, которые вы публикуете.

## Roadmap

Gateway уже ориентирован на production operations, а не на узкий MVP. Текущее направление - сделать его безопаснее, проще в эксплуатации и полезнее для малых и средних infrastructure fleets.

Готовая основа:

- [x] Multi-node nginx reverse proxy management over outbound gRPC with mTLS.
- [x] Docker host management with deployments, webhooks, registries, logs, files, consoles, and secrets.
- [x] Monitoring daemon for host metrics, runtime state, and log streaming.
- [x] Internal PKI, ACME SSL, certificate templates, domain tracking, and expiry alerts.
- [x] PostgreSQL and Redis database explorer with encrypted saved credentials.
- [x] Status pages, notifications, audit logs, RBAC, API tokens, OAuth PKCE, and remote MCP access.
- [x] Optional ClickHouse-backed structured logging and optional AI assistant.
- [x] Gateway and daemon update workflows with checksum-verified daemon binaries.

Планируемая работа:

- [ ] Bastion and SSH management daemon for controlled host access.
- [ ] CLI for scriptable programmatic control from terminals and CI/CD jobs.
- [ ] Settings page and permission scopes UX redesign.
- [ ] Plugin system for extending Gateway with new integrations and operational modules.
- [ ] Per-user AI assistant quotas and richer usage reporting.
- [ ] Local username/password authentication as an OIDC alternative.
- [ ] More guided onboarding for first-time installs and first-node setup.
- [ ] Broader operational documentation and examples for common deployment patterns.

## FAQ

<details>
<summary><strong>Gateway заменяет Kubernetes?</strong></summary>

Нет. Gateway предназначен для прямых инфраструктурных операций: nginx hosts, Docker hosts, certificates, domains, databases, logs, monitoring и automation. Он может использоваться рядом с Kubernetes, но не пытается быть Kubernetes control plane.
</details>

<details>
<summary><strong>Узлам нужны входящие management-порты?</strong></summary>

Нет. Daemons подключаются к Gateway исходящим gRPC с mTLS. Nginx nodes все еще нужны обычные public traffic ports, такие как `80` и `443`, если они обслуживают публичные сайты.
</details>

<details>
<summary><strong>Может ли Gateway управлять существующим nginx host?</strong></summary>

Да. Установите nginx daemon в режиме `integrate`. Gateway сохранит ваш существующий `nginx.conf` и добавит managed includes плюс локальный stats endpoint. См. [nginx node modes](docs/nodes.md#nginx-node-modes).
</details>

<details>
<summary><strong>Может ли Gateway работать без ClickHouse?</strong></summary>

Да. Если `CLICKHOUSE_URL` пустой, structured logging UI и ingest API отключаются. Остальная часть Gateway продолжает работать.
</details>

<details>
<summary><strong>Могут ли API или OAuth tokens раскрывать secrets?</strong></summary>

Только если владелец уже имеет нужные scopes. Sensitive OAuth scopes требуют явного opt-in во время consent, а API/OAuth tokens не могут превышать текущие effective permissions пользователя. См. [SCOPES.md](SCOPES.md).
</details>

<details>
<summary><strong>Что произойдет, если Gateway offline?</strong></summary>

Managed services продолжают работать. Existing nginx configs продолжают обслуживать traffic, Docker containers продолжают работать, а daemons переподключаются, когда Gateway возвращается. Centralized UI/API control недоступен до восстановления приложения.
</details>

<details>
<summary><strong>AI assistant обязателен?</strong></summary>

Нет. Он опционален и отключен по умолчанию. Gateway не отправляет данные AI provider, пока admin не включит assistant и не настроит provider.
</details>

## License

Gateway использует source-available licensing и опциональные product license keys. Текущие license tiers являются информационными в приложении и пока не ограничивают features.

| Tier | Для кого | Key | Текущее поведение |
|------|----------|-----|-------------------|
| ![Community](docs/assets/license/wiolett-gw-community-24.png) Community | Personal use, noncommercial use и permitted source-license use under [LICENSE.md](LICENSE.md). | Не требуется. | Full product access today. |
| ![Homelab](docs/assets/license/wiolett-gw-homelab-24.png) Homelab | Homelab operators и eligible small businesses under $100K revenue and fewer than 10 people. | Free renewable key by request. | Full product access today; planned Homelab-and-up perks include Status Pages, PKI, and Logging. |
| ![Enterprise](docs/assets/license/wiolett-gw-enterprise-24.png) Enterprise | Organizations above the small-business threshold or teams that want a paid commercial license. | $290/year. | Full product access today; planned Enterprise tier remains the paid commercial/support path. |

Homelab keys доступны по запросу через [contact@wiolett.net](mailto:contact@wiolett.net) или [Wiolett Industries on Telegram](https://t.me/WiolettIndustries). См. [Licensing](docs/licensing.md) для license verification, future tier perks и renewal details.

Copyright (c) 2021-2026 [Wiolett Industries](https://wiolett.net)
