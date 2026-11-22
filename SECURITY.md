# Security policy

## Scope

This repository publishes build scripts, patch transforms, tests and
documentation. It does not contain or distribute the Claude Desktop
application.

## Reporting

Report vulnerabilities through GitHub's private security advisory flow for this
repository. Do not open a public issue for a suspected credential leak,
signature bypass, policy bypass or downloaded application vulnerability.

Do not include API keys, keychain data, cookies, tokens or user configuration in
a report. Redact account identifiers and local paths when they are not needed.

## Supported baseline

Security review applies to the version in `.upstream-version`. A newer official
Claude Desktop release is unsupported until the patch set, tests and runtime
acceptance are complete.
