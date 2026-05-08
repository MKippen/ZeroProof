# API Documentation

Base URL: `/api/v1`

## Authentication

All endpoints except `/auth/login` and `/esp32/firmware` require authentication via session cookie.

### CSRF protection

Every mutating request (`POST` / `PUT` / `PATCH` / `DELETE`) on `/api/v1/*` must include an `X-CSRF-Token` header that matches the per-session token. The `/api/v1/esp32/*` device endpoints are exempt (they don't carry a browser session).

Flow:
1. Call `GET /api/v1/auth/csrf` (no auth required) to obtain a token bound to your session cookie.
2. Replay the token as `X-CSRF-Token: <token>` on every mutating request.
3. The token rotates after `POST /auth/login` and `POST /auth/logout` — re-fetch on session change. The frontend client does this automatically.

A request that fails CSRF validation responds with HTTP 403 and `{"success": false, "error": {"code": "CSRF_TOKEN_INVALID", ...}}`.

### POST /auth/login

Login with username and password.

**Request:**
```json
{
  "username": "admin",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "username": "admin"
    },
    "mustChangePassword": true
  }
}
```

### POST /auth/logout

Logout current session.

### GET /auth/csrf

Returns the per-session CSRF token. No auth required — the token is bound to the session cookie. Replay as `X-CSRF-Token` on every mutating request.

**Response:**
```json
{
  "success": true,
  "data": { "csrfToken": "..." }
}
```

### GET /auth/me

Get current user info.

### POST /auth/change-password

Change password.

**Request:**
```json
{
  "currentPassword": "oldpass",
  "newPassword": "newpass123"
}
```

---

## Dashboard

### GET /dashboard

Get dashboard statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "securityScore": 75,
    "vulnerabilities": {
      "total": 10,
      "critical": 1,
      "high": 2,
      "medium": 3,
      "low": 4,
      "info": 0
    },
    "devices": {
      "online": 2,
      "offline": 0,
      "testing": 0,
      "total": 2
    },
    "lastTestRun": "2024-01-15T10:30:00Z",
    "recentVulnerabilities": [...],
    "recentTests": [...]
  }
}
```

---

## Configuration

### POST /config/import

Import UniFi configuration file.

**Request:** `multipart/form-data`
- `config`: JSON file

**Response:**
```json
{
  "success": true,
  "data": {
    "config": {
      "id": "cuid123",
      "siteName": "My Site",
      "controllerVersion": "7.5.187",
      "importedAt": "2024-01-15T10:00:00Z"
    },
    "analysis": {
      "vulnerabilitiesFound": 5,
      "criticalCount": 1,
      "highCount": 2,
      "mediumCount": 2,
      "lowCount": 0
    }
  }
}
```

### GET /config/current

Get active configuration.

### GET /config/history

Get configuration history.

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

### POST /config/:id/activate

Set configuration as active.

---

## Devices

### GET /devices

List all devices.

**Response:**
```json
{
  "success": true,
  "data": {
    "devices": [
      {
        "id": "device-id",
        "deviceId": "zeroproof-AABBCCDD",
        "name": "Living Room",
        "macAddress": "AA:BB:CC:DD:EE:FF",
        "ipAddress": "192.168.1.50",
        "firmwareVersion": "1.0.0",
        "status": "ONLINE",
        "lastSeen": "2024-01-15T10:30:00Z",
        "configuredNetworks": ["HomeWiFi"],
        "testRunCount": 5
      }
    ]
  }
}
```

### GET /devices/:id

Get device details.

### POST /devices/:id/wifi

Configure WiFi credentials.

**Request:**
```json
{
  "ssid": "NetworkName",
  "password": "NetworkPassword"
}
```

### POST /devices/:id/reboot

Reboot device.

### DELETE /devices/:id

Remove device.

---

## Tests

### POST /tests/start

Start a new test.

**Request:**
```json
{
  "deviceId": "device-id",
  "testType": "port_scan",
  "options": {
    "portRange": "1-1024"
  }
}
```

**Test Types:**
- `port_scan` - Scan for open ports
- `vlan_isolation` - Test VLAN segmentation
- `service_discovery` - Discover network services
- `full_audit` - Run all tests

### GET /tests

List test runs.

**Query Parameters:**
- `status`: Filter by status (QUEUED, RUNNING, COMPLETED, FAILED)
- `deviceId`: Filter by device
- `page`, `limit`: Pagination

### GET /tests/:id

Get test details.

### GET /tests/:id/results

Get test results.

### POST /tests/:id/cancel

Cancel running test.

---

## Vulnerabilities

### GET /vulnerabilities

List vulnerabilities.

**Query Parameters:**
- `severity`: CRITICAL, HIGH, MEDIUM, LOW, INFO
- `status`: OPEN, ACKNOWLEDGED, FIXED, FALSE_POSITIVE
- `type`: Vulnerability type
- `page`, `limit`: Pagination

### GET /vulnerabilities/:id

Get vulnerability details.

### PATCH /vulnerabilities/:id

Update vulnerability status.

**Request:**
```json
{
  "status": "ACKNOWLEDGED",
  "notes": "Working on fix"
}
```

### POST /vulnerabilities/:id/retest

Request retest of vulnerability.

---

## Detections

Output of the live detection engine — event-driven findings produced by evaluating UniFi flow / threat events and DNS query logs against threat-intel and behavioral rules. Distinct from `/vulnerabilities` (which captures config-time issues from snapshot analyzers).

### GET /detections/analytics

Summary stats for the dashboard / `/detections` page.

**Query Parameters:**
- `hours`: look-back window, 1–168 (default 24)

**Response:**
```json
{
  "success": true,
  "data": {
    "windowHours": 24,
    "since": "2026-05-06T00:00:00.000Z",
    "total": 12, "open": 9, "resolved": 2, "dismissed": 1,
    "bySeverity": [{ "severity": "HIGH", "count": 5 }],
    "byDetector": [{ "detectorId": "ioc_match", "count": 7 }],
    "topAffected": [{ "resource": "iot-cam", "count": 4, "maxSeverity": "CRITICAL" }]
  }
}
```

### GET /detections

List detections, severity-first.

**Query Parameters:**
- `hours`: look-back window, 1–168 (default 24)
- `status`: `OPEN`, `RESOLVED`, `DISMISSED`
- `detectorId`: filter to a single detector (e.g. `ioc_match`)
- `severityAtLeast`: `INFO` / `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` — returns rows at-or-above this tier
- `limit`: 1–500 (default 100)

### GET /detections/:id

Single detection with full evidence and metadata payload.

### POST /detections/:id/resolve

Mark a finding as fixed. Requires CSRF.

### POST /detections/:id/dismiss

Mark a finding as intentional / accepted-risk. Requires CSRF.

### POST /detections/:id/reopen

Move a finding back to `OPEN`. Requires CSRF.

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": "Additional details (optional)"
  }
}
```

**Common Error Codes:**
- `UNAUTHORIZED` - Not logged in
- `CSRF_TOKEN_INVALID` - Missing or wrong `X-CSRF-Token` on a mutating request
- `VALIDATION_ERROR` - Invalid request data
- `NOT_FOUND` - Resource not found
- `DEVICE_OFFLINE` - Device not connected
- `TEST_IN_PROGRESS` - Test already running

---

## WebSocket

Connect to `/ws` for real-time updates.

**Events:**
```json
// Device status change
{"type": "device_status", "deviceId": "...", "status": "ONLINE"}

// Test progress
{"type": "test_progress", "testId": "...", "progress": 50, "currentStep": "Scanning..."}

// Test completed
{"type": "test_completed", "testId": "...", "success": true}

// New vulnerability
{"type": "vulnerability_detected", "vulnerability": {...}}
```
