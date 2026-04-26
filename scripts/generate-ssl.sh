#!/bin/bash

# Generate self-signed SSL certificates for ZeroProof

set -e

SSL_DIR="nginx/ssl"
DAYS=365
HOSTNAME=${1:-"zeroproof"}

echo "Generating SSL certificates..."
echo "  Hostname: $HOSTNAME"
echo "  Valid for: $DAYS days"
echo ""

mkdir -p $SSL_DIR

# Generate private key and certificate
openssl req -x509 \
    -nodes \
    -days $DAYS \
    -newkey rsa:2048 \
    -keyout $SSL_DIR/server.key \
    -out $SSL_DIR/server.crt \
    -subj "/CN=$HOSTNAME/O=ZeroProof/C=US" \
    -addext "subjectAltName=DNS:$HOSTNAME,DNS:localhost,IP:127.0.0.1"

# Set permissions
chmod 600 $SSL_DIR/server.key
chmod 644 $SSL_DIR/server.crt

echo "SSL certificates generated successfully!"
echo ""
echo "Files:"
echo "  Private key: $SSL_DIR/server.key"
echo "  Certificate: $SSL_DIR/server.crt"
echo ""
echo "To use Let's Encrypt for production, see docs/DEPLOYMENT.md"
