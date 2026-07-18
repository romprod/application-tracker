# Reference lists

Application Tracker gives every workspace four shared reference lists:

- statuses
- sources
- role types
- document types

A new workspace receives generic defaults. These defaults contain no hosted
service names, organization-specific terms, or deployment details. Workspace
administrators can add, rename, enable, disable, and remove values in Settings
→ Lists. Members can read the same page but cannot change it.

## Status outcomes

A status can be marked as a closed outcome. This property is separate from its
label, so a workspace can rename `Closed` or add outcomes such as `Withdrawn`
without relying on English text to calculate open work. At least one active
closed status must remain.

Every category must retain at least one active value. Disabling a value keeps
it available for historical records while removing it from new-entry choices.
A value can be deleted only when it is not required by these invariants. Once
applications refer to the lists, referenced values also remain protected from
deletion, including after an application is removed from normal views.

## Storage and API

Migration 8 creates strict, workspace-scoped `reference_values` storage and a
workspace-insert trigger that seeds defaults. Labels are unique without regard
to case inside each workspace and category. Repository queries bind all input
values and order results by category and workspace-owned sort order.

Migration 9 connects applications to statuses, sources, and role types. It
backfills prior applications, rejects inactive or wrong-category selections,
and keeps status labels in immutable history events as point-in-time snapshots.
Document types are ready for the document-storage milestone.

Authenticated members can read `GET /api/settings/lists`. The create, update,
and delete routes require an administrator and a matching browser origin. The
responses contain labels and behavior flags only; they do not expose runtime
configuration or identity material.
