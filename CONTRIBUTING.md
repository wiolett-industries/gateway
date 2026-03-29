# Contributing to Gateway

Thank you for your interest in contributing to Gateway!

## Getting Started

1. Fork the repository on [GitHub](https://github.com/wiolett-industries/gateway)
2. Clone your fork and create a new branch
3. Set up the development environment:

```bash
pnpm install
pnpm dev:infra
pnpm db:migrate
pnpm dev:all
```

## Submitting Changes

1. Create an [issue](https://github.com/wiolett-industries/gateway/issues) describing the change you'd like to make
2. Fork the repo and create a feature branch from `main`
3. Make your changes, keeping commits focused and well-described
4. Ensure `pnpm lint` and `pnpm test` pass
5. Submit a pull request against `main`

## Guidelines

- Keep pull requests focused on a single change
- Follow the existing code style and conventions
- Update documentation if your change affects user-facing behavior
- Add tests for new functionality where applicable

## Reporting Bugs

Please use [GitHub Issues](https://github.com/wiolett-industries/gateway/issues) to report bugs. Include:

- Steps to reproduce
- Expected vs actual behavior
- Gateway version and environment details

## Core Maintainers

If you're interested in becoming a core maintainer with direct access to the primary [Wiolett GitLab](https://gitlab.wiolett.net/wiolett/gateway) repository, you can request an account by opening a [GitHub issue](https://github.com/wiolett-industries/gateway/issues) or emailing [contact@wiolett.net](mailto:contact@wiolett.net).

## License

By contributing, you agree that your contributions will be licensed under the [PolyForm Small Business License 1.0.0](LICENSE.md).
