# Security Policy

## Reporting a Vulnerability

The EVA Foundation takes security seriously. If you discover a security vulnerability, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

### How to Report

Send vulnerability reports to: **[security contact to be added]**

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Fix & Disclosure**: Coordinated with reporter

### Supported Versions

We provide security updates for:
- Current release (main branch)
- Previous major version (if applicable)

### Security Best Practices

When using EVA Foundation projects:
- Never commit credentials (.env files, API keys, connection strings)
- Use Azure Managed Identity for production deployments
- Follow the principle of least privilege for RBAC
- Enable branch protection on your forks
- Keep dependencies updated (Dependabot alerts)

## Security Features

EVA Foundation projects include:
- Azure Entra ID authentication
- Role-based access control (RBAC)
- Secrets management via Azure Key Vault integration
- API request validation and sanitization
- Audit logging for governance compliance

---

**Last Updated**: March 1, 2026
