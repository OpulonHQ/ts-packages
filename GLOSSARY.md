# TSPACK

Shared building blocks for Opulon websites: the admin, users, CMS, emails and media that projects used to copy from one another.

## Language

**Package**:
A published `@opulonjs/*` unit of TSPACK that a project depends on by version.
_Avoid_: library, lib, plugin

**Module**:
A unit that plugs into the Admin shell and the composed API, contributing its own data, API, permissions and admin screens; it is either a package or a host module.
_Avoid_: plugin, extension, feature

**Host module**:
A module that a host app writes for its own needs and that plugs in exactly like a package's module.
_Avoid_: custom module, project plugin, local extension

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

**Actor**:
Who performed the action of an Audit event: a staff user, the system (a scheduled job or an incoming webhook), or an anonymous visitor such as a failed sign-in.
_Avoid_: author, editor, by

**Audit timeline**:
The Audit events of one subject, shown on that subject's admin screen.
_Avoid_: history, activity feed

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

**Page**:
A piece of public content that editors create and that is reachable at its own path in each content locale where it is available, built from an ordered list of sections.
_Avoid_: post, screen, route

**System page**:
A page the host app declares by key (such as the homepage) so its code can rely on it; editors change its content but cannot delete it.
_Avoid_: fixed page, static page, core page

**Section**:
One block of a page's content, of a single section type, placed in the page's order.
_Avoid_: block, component, widget

**Section type**:
A kind of section the host app defines, with its fields and its own rendering on the public website.
_Avoid_: block type, template, layout

**Collection**:
A kind of structured content the host app defines (posts, team members, testimonials, categories), whose items editors manage in the admin.
_Avoid_: post type, content type, model

**Item**:
One entry of a collection, optionally reachable at its own public path.
_Avoid_: entry, record, post

**Draft**:
The editable state of a page, item or site setting, never shown to the public; editors see it only through preview.
_Avoid_: working copy, unsaved changes

**Publishing**:
Making the current draft the version the public sees; unpublishing withdraws it from the public.
_Avoid_: activating, going live, deploying

**Revision**:
A recorded snapshot of what was published, by whom and when, which an editor can restore into the draft.
_Avoid_: version, history entry, backup

**Email template**:
A named email a module can send (such as an invitation), with its placeholders and default wording in each locale.
_Avoid_: mail, notification, message type

**Email audience**:
Who an email template is written for: staff (users, in their admin locale) or public (visitors, in a content locale).
_Avoid_: recipient type, channel

**Template override**:
An editor's replacement for an email template's default subject and body in one locale, which can be reset to the default.
_Avoid_: custom template, edited template

**Email component**:
A reusable building block of an email body (such as a button) that follows the host's branding; the emails package ships the defaults and hosts may add their own.
_Avoid_: snippet, partial, widget

**Email log**:
The record of every email the system decided to send, with its delivery outcome.
_Avoid_: mail queue, sent items, outbox
