# Contributing to EVA Foundation

Thank you for your interest in contributing! EVA Foundation is an open-source AI engineering platform built on evidence-driven software factory principles.

## Getting Started

1. **Fork the repository** and clone your fork locally
2. **Set up your environment**:
   - Python 3.11+ for backend projects
   - Node.js 18+ for frontend/CLI projects
   - PowerShell 7+ for automation scripts
   - VS Code with Copilot recommended
3. **Read the project README** for setup instructions
4. **Check the PLAN.md** for active work items

## Development Workflow

1. **Create a feature branch**: `git checkout -b feat/PROJECT-XX-description`
2. **Follow EVA conventions**:
   - Commit format: `feat(project): description` or `fix(project): description`
   - Tag code with EVA-STORY IDs: `// EVA-STORY: PROJECT-XX-NNN`
   - Write tests for new features (pytest for Python, vitest for TypeScript)
3. **Run quality gates locally**:
   - Python: `pytest tests/ -v`
   - TypeScript: `npm test`
   - Veritas audit: `npm install -g eva-veritas && veritas audit`
4. **Push and create a Pull Request**
5. **Pass CI checks** (pytest, veritas MTI >= 70, validation scripts)

## Code Style

- **Python**: PEP 8, type hints, docstrings
- **TypeScript**: ESLint, React hooks best practices, Fluent UI patterns
- **PowerShell**: Verb-Noun naming, approved verbs only, comment-based help

## Testing Requirements

- **Unit tests**: >= 80% coverage for new code
- **Integration tests**: Cover API endpoints and database operations
- **UI tests**: Vitest + React Testing Library for components

## Documentation

- Update README.md if adding features
- Add inline comments for complex logic
- Update PLAN.md with story progress
- Document breaking changes in PR description

## EVA-Specific Principles

This is **not code vibes** - it is **data-driven AI-enabled Software Engineering**:
- Query the **Data Model API** (37-data-model) for schemas, endpoints, relationships
- Use **EVA-Veritas** for requirements traceability and MTI scoring
- Follow the **DPDCA loop**: Discover -> Plan -> Do -> Check -> Act
- Maintain Evidence Layer provenance (never force push)

## Pull Request Checklist

- [ ] Tests pass locally (`pytest` / `npm test`)
- [ ] No linting errors (`flake8` / `eslint`)
- [ ] Veritas MTI >= 70 (if applicable)
- [ ] README.md updated (if adding features)
- [ ] EVA-STORY tags present in code
- [ ] Commit messages follow convention
- [ ] No secrets committed (.env, API keys)

## Community

- **Be respectful** - follow the Code of Conduct
- **Be patient** - maintainers are volunteers
- **Be helpful** - review others' PRs
- **Ask questions** - in GitHub Discussions or PR comments

## Recognition

Contributors are listed in:
- GitHub Contributors page (automatic)
- ACKNOWLEDGMENTS.md (major contributions)
- EVA Foundation credits (significant architectural work)

---

**Questions?** Open a GitHub Discussion or reach out to maintainers.

**Thank you for contributing to EVA Foundation!**
