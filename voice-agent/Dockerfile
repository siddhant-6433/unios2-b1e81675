FROM denoland/deno:2.1.4

WORKDIR /app
COPY . .

# --no-lock: deno.lock was regenerated at lockfile version 5 (commit cba89789,
# 2026-07-24) by a newer local Deno, but this image pins 2.1.4, which only reads
# up to version 4 — "Unsupported lockfile version '5'". That made the service
# un-deployable for three weeks.
#
# Skipping the lockfile rather than bumping the base image keeps the runtime
# identical to the revision already serving live calls; this is a real-time
# telephony path and a Deno upgrade deserves its own change. Dependencies are
# still pinned by explicit version in the import specifiers.
#
# Proper fix: bump to a Deno that reads lockfile v5 (2.4+) and drop --no-lock,
# with a test call to verify.
RUN deno cache --no-lock server.ts

EXPOSE 8000

CMD ["deno", "run", "--no-lock", "--allow-net", "--allow-env", "--allow-read", "server.ts"]
