# Scheduler Phase 1 API (Admin + Client)

- `/api/scheduler` (primary)

Admin ticket endpoint:

- `/api/scheduler/failure-tickets`

This phase keeps existing scheduler APIs and adds:

- admin client directory/search
- admin filter by `userEmail` on shared schedule list
- video-session entitlement checks using `Subscription.videoAddonEnabled` and `Subscription.videoSessionHours`
- 90-minute minimum same-day gap for all schedule types
- photo/video media upload support for session create/update using the same endpoints
- failed-post escalation ticket + admin/dev email alerts

No context endpoints were added in this phase.

## Auth and roles

- All scheduler APIs require authenticated user.
- Client role:
  - can create/update/delete/get/list own schedules.
- Admin/Super Admin:
  - can list all schedules
  - can filter specific client schedules (`userId` or `userEmail`)
  - can create/update for clients (`userId` in payload)
  - can update post publish status and session status endpoints.

## Enums used by scheduler

- `ScheduleType`: `POSTING | PHOTO_SESSION | VIDEO_SESSION`
- `PostStatus`: `DRAFT | SCHEDULED | PUBLISHING | POSTED | FAILED`
- `SessionStatus`: `BOOKED | COMPLETED | FAILED | CANCELED`
- platform filter values (query): `instagram | facebook | linkedin`
- calendar views: `day | week | month | list`

## 1) Admin client directory for searching clients by email

`GET /api/scheduler/clients`

Auth:

- `requireAuth + requireAdmin`

Query:

- `page` (number, default `1`)
- `pageSize` (number, default `20`, max `100`)
- `search` (string, optional, partial email, case-insensitive)
- `status` (optional: `ACTIVE | BLOCKED | DELETED`)

Example:

```http
GET /api/scheduler/clients?page=1&pageSize=20&search=gmail.com&status=ACTIVE
```

Response:

```json
{
  "items": [
    {
      "id": "clx_client_1",
      "email": "client@example.com",
      "name": "Client Name",
      "status": "ACTIVE",
      "createdAt": "2026-04-28T10:00:00.000Z",
      "connectedPlatformCount": 2,
      "nextScheduledAt": "2026-05-17T08:00:00.000Z",
      "activePlanCode": "FMP-20"
    }
  ],
  "meta": {
    "count": 1,
    "totalCount": 14,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

## 2) Create posting schedule (single API: data + files)

`POST /api/scheduler/posts`

Content type:

- `multipart/form-data`

Form fields:

- `data` (required, JSON string)
- `files` (optional, repeatable)

`data` JSON shape:

```json
{
  "userId": "optional_client_user_id_for_admin",
  "caption": "Campaign post caption",
  "hashtags": ["diamond", "bridal"],
  "cta": "Book now",
  "shortDescription": "Short context",
  "scheduledAt": "2026-05-17T14:27:00+06:00",
  "socialAccountIds": ["social_acc_1", "social_acc_2"],
  "adminReason": "optional admin note"
}
```

Notes:

- files are uploaded to S3 by backend
- created assets are linked to post automatically
- post enforces media rule: max 1 video per post
- if no `socialAccountIds` provided, backend uses client connected accounts
- 90-minute gap rule is enforced

## 3) Update posting schedule

`PATCH /api/scheduler/posts/:id`

Body (JSON):

```json
{
  "caption": "Updated caption",
  "hashtags": ["diamond", "ring"],
  "cta": "Shop now",
  "shortDescription": "Updated summary",
  "scheduledAt": "2026-05-18T16:30:00+06:00",
  "socialAccountIds": ["social_acc_1"],
  "adminReason": "Client requested move"
}
```

## 4) Delete schedule item (post or session)

`DELETE /api/scheduler/posts/:id`

Behavior:

- deletes scheduler record
- unlinks assets
- removes orphan scheduler assets from S3 when no longer referenced

## 5) Get single schedule item

`GET /api/scheduler/posts/:id`

Response includes:

- post/session core data
- selected platforms and targets
- media array (image/video asset metadata)
- user summary
- scheduler status (`pending | completed | failed`)

## 6) Shared schedule list/calendar (client + admin)

`GET /api/scheduler/posts`

Query params:

- `view=day|week|month|list`
- `date=YYYY-MM-DD`
- `from=<ISO_DATETIME>`
- `to=<ISO_DATETIME>`
- `status=scheduled,failed` (comma-separated allowed)
- `scheduleType=posting,photo_session,video_session`
- `sessionStatus=booked,completed,failed,canceled`
- `failure=true|false`
- `platform=instagram,facebook,linkedin`
- `userId=<clientId>` (admin only)
- `userEmail=<client@email>` (admin only, resolves internally to userId)
- `page=1`
- `pageSize=20`

Behavior:

- client gets only own schedules
- admin without `userId/userEmail` gets all schedules
- admin with `userEmail` gets one client schedule view

Example (admin Client X by email):

```http
GET /api/scheduler/posts?view=month&date=2026-05-01&userEmail=client@example.com&page=1&pageSize=20
```

Response:

```json
{
  "items": [
    {
      "id": "post_1",
      "scheduleType": "POSTING",
      "caption": "Post text",
      "scheduledAt": "2026-05-17T08:27:00.000Z",
      "status": "SCHEDULED",
      "schedulerStatus": "pending",
      "session": null,
      "selectedPlatforms": ["INSTAGRAM"],
      "media": [
        {
          "id": "asset_1",
          "storageKey": "scheduler/u1/file.jpg",
          "url": "https://cdn.example.com/scheduler/u1/file.jpg",
          "mimeType": "image/jpeg",
          "mediaType": "IMAGE"
        }
      ],
      "user": {
        "id": "u1",
        "email": "client@example.com",
        "name": "Client Name",
        "status": "ACTIVE"
      },
      "createdAt": "2026-04-30T10:00:00.000Z",
      "updatedAt": "2026-04-30T10:00:00.000Z"
    }
  ],
  "filters": {
    "view": "month",
    "date": "2026-05-01T00:00:00.000Z",
    "from": "2026-05-01T00:00:00.000Z",
    "to": "2026-05-31T23:59:59.999Z",
    "status": [],
    "scheduleType": [],
    "sessionStatus": [],
    "failure": false,
    "userId": "u1",
    "userEmail": "client@example.com",
    "platform": [],
    "page": 1,
    "pageSize": 20
  },
  "meta": {
    "count": 1,
    "totalCount": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

## 7) Create session schedule (photo/video)

`POST /api/scheduler/sessions`

Supports both:

- JSON body
- multipart/form-data with `data` + `files`

### 7.1 JSON mode

```json
{
  "userId": "optional_client_user_id_for_admin",
  "scheduleType": "PHOTO_SESSION",
  "scheduledAt": "2026-05-20T11:00:00+06:00",
  "sessionTitle": "May photoshoot",
  "sessionNotes": "Need white background product shots",
  "sessionDurationMinutes": 60,
  "uploadedAssetIds": ["existing_asset_1"],
  "adminReason": "optional admin note for session"
}
```

### 7.2 Multipart mode (recommended for media upload)

- `data`: JSON string with the same fields as above
- `files`: optional repeatable images/videos

Behavior:

- for `PHOTO_SESSION`, multiple images/videos can be attached
- files upload to S3, backend creates `Asset`, auto-links to session
- default behavior appends incoming media
- 90-minute rule is enforced

VIDEO session entitlement checks:

- `videoAddonEnabled` must be true
- `requiredHours = ceil(sessionDurationMinutes / 60)`
- `videoSessionHours >= requiredHours`

## 8) Update session schedule

`PATCH /api/scheduler/sessions/:id`

Supports JSON or multipart, same as create.

Body fields:

- `scheduledAt`
- `sessionTitle`
- `sessionNotes`
- `sessionDurationMinutes`
- `uploadedAssetIds` (optional existing assets)
- `replaceMedia` (optional boolean)
- `adminReason`

Media behavior:

- default append (`replaceMedia=false`)
- replace mode (`replaceMedia=true`): old session media is replaced; orphaned scheduler assets are cleaned up

## 9) Update session status (admin only)

`PATCH /api/scheduler/sessions/:id/status`

Auth:

- admin/super-admin only

Body:

```json
{
  "status": "completed",
  "sessionFailureReason": null,
  "adminReason": "Session done"
}
```

Allowed status:

- `completed`
- `failed`
- `canceled`

Rules:

- if `failed`, `sessionFailureReason` is required
- for `VIDEO_SESSION` completion, hours are deducted once:
  - `deductHours = ceil(sessionDurationMinutes / 60)`
  - deduct from `Subscription.videoSessionHours`

## 10) Update publish status for posting schedules (admin only)

`PATCH /api/scheduler/posts/:id/publish-status`

Body:

```json
{
  "status": "failed",
  "failureReason": "Platform token expired",
  "adminReason": "Needs reconnect"
}
```

On failed publish:

- creates failure ticket event (OPEN)
- emails admin + dev recipients

## 11) Failure tickets (admin)

`GET /api/scheduler/failure-tickets`

Query:

- `page` (default `1`)
- `pageSize` (default `20`, max `100`)
- `userId` (optional)
- `userEmail` (optional)

Example:

```http
GET /api/scheduler/failure-tickets?page=1&pageSize=20&userEmail=client@example.com
```

Response:

```json
{
  "items": [
    {
      "id": "event_1",
      "postId": "post_1",
      "userId": "u1",
      "userEmail": "client@example.com",
      "platform": ["INSTAGRAM", "FACEBOOK"],
      "failureReason": "Token expired",
      "status": "OPEN",
      "timestamp": "2026-04-30T12:30:00.000Z",
      "createdAt": "2026-04-30T12:30:00.000Z"
    }
  ],
  "meta": {
    "count": 1,
    "totalCount": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

## Error matrix

Common:

- `401` Unauthorized
- `403` Forbidden
- `404` Not found
- `400` Validation error

Scheduler-specific codes:

- `VIDEO_SESSION_NOT_INCLUDED` (403)
- `VIDEO_SESSION_HOURS_EXCEEDED` (403)
- `SCHEDULE_90_MIN_CONFLICT` (400)

Example:

```json
{
  "error": "Video session is not included in your current plan. Please add Video Session add-on.",
  "code": "VIDEO_SESSION_NOT_INCLUDED"
}
```

## Frontend integration flow

### Client flow

1. Load calendar: `GET /api/scheduler/posts?view=month&date=YYYY-MM-DD`
2. Create post: `POST /api/scheduler/posts` (`data` + optional `files`)
3. Create photo session: `POST /api/scheduler/sessions` (multipart recommended for media)
4. Create video session: same endpoint, handle `VIDEO_SESSION_*` errors in UI
5. Edit item: `PATCH /api/scheduler/posts/:id` or `PATCH /api/scheduler/sessions/:id`
6. Delete item: `DELETE /api/scheduler/posts/:id`

### Admin flow (Client X handling)

1. Find client: `GET /api/scheduler/clients?search=client@email.com`
2. Open client schedule:
   - `GET /api/scheduler/posts?userEmail=client@email.com&view=month&date=YYYY-MM-DD`
   - or `userId`
3. Create/edit on behalf using `userId` in payload.
4. Update publish/session status with admin endpoints.
5. Monitor failures: `GET /api/scheduler/failure-tickets`

## Notification + email behavior in Phase 1

Lifecycle events trigger:

- in-app notification for client
- in-app notification for admin users
- lifecycle email to client
- lifecycle email to admin address (`SCHEDULER_ADMIN_EMAIL`)

Failed posting additionally triggers:

- failure ticket open event
- alert email to admin (`SCHEDULER_ADMIN_EMAIL`)
- alert email to dev (`SCHEDULER_DEV_EMAIL`, if configured)
