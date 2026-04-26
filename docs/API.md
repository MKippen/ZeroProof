# API Documentation

Base URL: `/api/v1`

## Authentication

All endpoints except `/auth/login` and `/esp32/firmware` require authentication via session cookie.

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
