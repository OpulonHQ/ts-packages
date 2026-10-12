# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue.

Include the affected package and version, a description of the issue and steps to reproduce it. We aim to acknowledge reports within three working days and will keep you informed until a fix is released.

## Supported versions

Only the latest published version of the `@opulonjs/*` packages receives security fixes. All packages share one version number.

## Releases

Packages are published from GitHub Actions through npm trusted publishing (OIDC) with provenance; no long-lived npm tokens are stored in this repository. Verify a release with `npm audit signatures`.
