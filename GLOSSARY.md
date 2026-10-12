# TSPACK

Shared building blocks for Opulon websites: the admin, users, CMS, emails and media that projects used to copy from one another.

## Language

**Package**:
A published `@opulonjs/*` unit of TSPACK that a project depends on by version.
_Avoid_: library, lib, plugin

**Module**:
A package that plugs into the Admin shell and the composed API, contributing its own data, API, permissions and admin screens.
_Avoid_: plugin, extension, feature

**Host app**:
The project's own application (SLM, ICF, ...) that installs packages, mounts their API, serves the admin and renders the public website.
_Avoid_: consumer app, client app, site

**Admin shell**:
The admin application (layout, theme, navigation, sign-in) into which modules plug their screens.
_Avoid_: dashboard, backoffice, admin panel

**Core**:
The minimal package every module depends on: shared domain primitives and the Audit log.
_Avoid_: common, shared, utils

**Copy-in**:
UI code a project copies into its own source to own and change, instead of depending on it by version.
_Avoid_: fork, eject, vendoring

**Audit event**:
A recorded fact that an actor performed an action on a subject, kept in the Audit log.
_Avoid_: activity, history entry, log line

**Pilot**:
The first host app built on TSPACK (SLM), whose needs decide the v1 scope.
_Avoid_: test project, guinea pig

**UI kit**:
The shared set of admin components and tokens that the Admin shell and every module's admin screens build on.
_Avoid_: design system, component library, admin kit

**Permission**:
A named right a module declares (such as editing CMS pages) and that roles grant to users.
_Avoid_: ability, capability, scope

**Admin locale**:
A language the admin itself is shown in, chosen per user.
_Avoid_: UI language, interface locale

**Content locale**:
A language the host app's public content is published in, chosen per host app.
_Avoid_: site language, translation

**User**:
A person who signs into the Admin shell (staff). Customers of the host app are not users.
_Avoid_: account, member, admin user, customer

**Role**:
A named set of permissions, edited in the admin, that is assigned to users; a user may hold several.
_Avoid_: group, profile

**Super admin**:
The built-in role that holds every permission, including ones modules add later; it cannot be edited or removed from its last holder.
_Avoid_: root, owner

**Invitation**:
The only way to become a user: an emailed link through which the invitee sets a password.
_Avoid_: sign-up, registration

**Deactivation**:
Blocking a user from signing in while keeping them on record; it can be reversed.
_Avoid_: deletion, ban, soft delete
