# Deployment Guide

## System Requirements

### Minimum Requirements
- 2 CPU cores
- 2GB RAM
- 10GB storage
- Docker and Docker Compose

### Recommended
- Raspberry Pi 4/5 (4GB+ RAM)
- Intel NUC or similar x86_64
- SSD for better performance

## Production Deployment

### 1. Clone and Configure

```bash
git clone https://github.com/MKippen/ZeroProof.git
cd ZeroProof

# Run installer (generates credentials, SSL cert)
./scripts/install.sh
```

`scripts/install.sh` creates the production `.env`, Mosquitto password file, and local certificate. These generated files are intentionally ignored by git and should be backed up securely.

### 2. Configure SSL (Optional but Recommended)

**Self-signed certificate (default):**
```bash
./scripts/generate-ssl.sh your-hostname
```

**Let's Encrypt (recommended for production):**
```bash
# Install certbot
sudo apt install certbot

# Generate certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/server.crt
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/server.key

# Set permissions
sudo chown $USER:$USER nginx/ssl/*

# Restart nginx
docker compose restart nginx
```

### 3. Start Services

```bash
docker compose up -d
```

### 4. Verify Deployment

```bash
# Check all services are running
docker compose ps

# Check logs
docker compose logs -f

# Test API
curl -k https://localhost/health
```

## Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose build
docker compose up -d
```

## Backup & Restore

### Backup

```bash
./scripts/backup.sh ./backups
```

### Restore

```bash
# Restore database
cat backups/backup-file.sql | docker compose exec -T postgres psql -U postgres zeroproof

# Restore config
tar -xzf backups/backup-config.tar.gz
```

## Monitoring

### Health Check

```bash
curl -k https://localhost/health
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f nginx
```

### Resource Usage

```bash
docker stats
```

## Troubleshooting

### Services won't start

```bash
# Check logs
docker compose logs

# Restart all services
docker compose restart

# Nuclear option - rebuild everything
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Database issues

```bash
# Access database
docker compose exec postgres psql -U postgres zeroproof

# Reset database (WARNING: destroys all data)
docker compose down
docker volume rm zeroproof_postgres_data
docker compose up -d
```

### SSL certificate issues

```bash
# Regenerate self-signed certificate
./scripts/generate-ssl.sh

# Restart nginx
docker compose restart nginx
```

## Security Hardening

### Firewall Rules

Only expose necessary ports:
- 443 (HTTPS)
- 1883 (MQTT - if ESP32 devices on different network)

```bash
# UFW example
sudo ufw allow 443/tcp
sudo ufw allow 1883/tcp  # Only if needed
sudo ufw enable
```

### Change Default Password

1. Log in with default credentials (admin / `DEFAULT_ADMIN_PASSWORD` from `.env`)
2. Go to Settings
3. Change password immediately

### Regular Updates

Keep the system updated:

```bash
# Update host OS
sudo apt update && sudo apt upgrade -y

# Update Docker images
docker compose pull
docker compose up -d
```
