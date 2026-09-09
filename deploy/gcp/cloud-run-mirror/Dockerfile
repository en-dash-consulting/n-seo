# Serves the exported static mirror (<instance>/site/, rsynced to a bucket).
# The bucket is mounted read-only at /usr/share/nginx/html by the Cloud Run
# --add-volume flag, so this image carries no content of its own.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
