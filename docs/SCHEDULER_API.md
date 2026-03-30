# Scheduler API (Single Booking API)

Base paths:

- `/scheduler`
- `/api/scheduler`

Auth:

- Cookie auth (`token`) required.

Supported platforms:

- `instagram`
- `facebook`
- `linkedin`

## Core Rule

Use only one booking endpoint:

- `POST /scheduler/posts`

`form-data` payload contains:

- `data` (JSON string with all scheduler fields)
- `files` (optional, repeatable)

Backend behavior:

1. Parse `data` JSON
2. If `files` exist, upload to S3
3. Create `Asset` records
4. Merge uploaded asset ids with optional `assetIds` from data
5. Create scheduled post and targets

## Admin Reason

`adminReason` is an audit note for admin/super-admin actions on behalf of a client.
Use it to record why admin created/edited/rescheduled/marked completed/failed.

## Status Model

DB `status` values:

- `DRAFT`
- `SCHEDULED`
- `PUBLISHING`
- `POSTED`
- `FAILED`

Response `schedulerStatus` values:

- `pending` (`DRAFT` / `SCHEDULED` / `PUBLISHING`)
- `completed` (`POSTED`)
- `failed` (`FAILED`)

Who can set completion/failure:

- only `ADMIN` or `SUPER_ADMIN` via `PATCH /scheduler/posts/:id/publish-status`

---

## 1) Create Scheduled Post (single API)

### `POST /scheduler/posts`

### Content-Type

- `multipart/form-data`

### Form fields

- `data` (Text, required, JSON string)
- `files` (File, optional, repeatable)

### `data` JSON shape

```json
{
  "userId": "optional_client_id_for_admin",
  "caption": "Two tones, one timeless story",
  "hashtags": ["diamond", "bridal"],
  "cta": "Book now",
  "shortDescription": "Campaign item",
  "scheduledAt": "2026-05-17T14:27:00+06:00",
  "socialAccountIds": ["social_1", "social_2"],
  "assetIds": ["optional_existing_asset_id_1"],
  "adminReason": "optional only for admin"
}
```

### Postman example

- Key: `data` (Text)
  Value:

```json
{
  "caption": "Two tones, one timeless story",
  "hashtags": ["diamond", "bridal"],
  "cta": "Book now",
  "shortDescription": "Campaign item",
  "scheduledAt": "2026-05-17T14:27:00+06:00",
  "socialAccountIds": ["social_1", "social_2"],
  "assetIds": []
}
```

- Key: `files` (File) attach 1..N files (optional)

### Success response

```json
{
  "post": {
    "id": "post_id",
    "caption": "Two tones, one timeless story",
    "scheduledAt": "2026-05-17T08:27:00.000Z",
    "status": "SCHEDULED",
    "schedulerStatus": "pending",
    "selectedPlatforms": ["FACEBOOK", "INSTAGRAM"],
    "media": [],
    "assets": [],
    "adminReason": null
  }
}
```

---

## 2) Update / Reschedule Post

### `PATCH /scheduler/posts/:id`

```json
{
  "caption": "Updated caption",
  "scheduledAt": "2026-05-18T16:30:00+06:00",
  "socialAccountIds": ["social_1", "social_3"],
  "assetIds": ["asset_id_3"],
  "adminReason": "Moved after review"
}
```

---

## 3) Mark Publish Result (admin/super-admin only)

### `PATCH /scheduler/posts/:id/publish-status`

Completed:

```json
{
  "status": "completed",
  "adminReason": "Published from admin dashboard"
}
```

Failed:

```json
{
  "status": "failed",
  "failureReason": "Token expired on Instagram",
  "adminReason": "Client needs reconnect"
}
```

Behavior:

- `completed` -> post status `POSTED`, targets `POSTED`, `publishedAt` set
- `failed` -> post status `FAILED`, targets `FAILED`, `errorMessage` set

---

## 4) Delete Scheduled Post

### `DELETE /scheduler/posts/:id`

Response:

```json
{
  "success": true
}
```

Delete behavior:

- remove post, targets, asset links
- delete scheduler-owned S3 files if orphaned

---

## 5) Get Single Post (with meta)

### `GET /scheduler/posts/:id`

Response:

```json
{
  "post": {
    "id": "post_id",
    "status": "SCHEDULED",
    "schedulerStatus": "pending"
  },
  "meta": {
    "count": 1,
    "totalCount": 1,
    "page": 1,
    "pageSize": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

---

## 6) List / Calendar (with pagination)

### `GET /scheduler/posts`

Query params:

- `view=day|week|month|list`
- `date=YYYY-MM-DD`
- `from=ISO_DATETIME`
- `to=ISO_DATETIME`
- `status=draft|scheduled|publishing|posted|failed` (comma-separated)
- `failure=true|false`
- `userId=<clientId>` (admin only)
- `platform=instagram|facebook|linkedin` (comma-separated)
- `page=1` (default 1)
- `pageSize=20` (default 20, max 100)

Examples:

- `/scheduler/posts?view=day&date=2026-05-17&page=1&pageSize=20`
- `/scheduler/posts?view=month&date=2026-05-01`
- `/scheduler/posts?view=list&from=2026-05-01T00:00:00+06:00&to=2026-05-31T23:59:59+06:00&page=2&pageSize=10`
- `/scheduler/posts?failure=true`
- `/scheduler/posts?status=scheduled,failed`
- `/scheduler/posts?platform=instagram,facebook`
- `/scheduler/posts?view=month&date=2026-05-01&userId=client_user_id`

Response:

```json
{
  "items": [
    {
      "id": "post_id",
      "status": "SCHEDULED",
      "schedulerStatus": "pending",
      "assets": ["https://cdn.example.com/user/client/scheduler/file1.jpg"]
    }
  ],
  "filters": {
    "view": "month",
    "page": 1,
    "pageSize": 20
  },
  "meta": {
    "count": 20,
    "totalCount": 83,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## Validation summary

- auth required
- active subscription required for create/update
- scheduled time must be future
- social accounts must belong to client
- selected platform count must fit plan + add-on limit
- media must be valid and `READY`
- supported files: image/video
- users can manage only own posts
- admins can manage on behalf of client
- publish-status update is admin/super-admin only
