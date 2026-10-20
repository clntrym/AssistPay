#!/bin/sh
set -e

# Default to port 80 if PORT environment variable is not set by hosting provider
PORT="${PORT:-80}"

echo "Configuring Apache to listen on port ${PORT}..."
sed -i "s/Listen 80/Listen ${PORT}/" /etc/apache2/ports.conf
sed -i "s/<VirtualHost \*:80>/<VirtualHost \*:${PORT}>/" /etc/apache2/sites-available/*.conf

if [ "$#" -eq 0 ]; then
    exec apache2-foreground
else
    exec "$@"
fi

