FROM denoland/deno:2.1.4

WORKDIR /app
COPY . .

# Cache dependencies
RUN deno cache server.ts

EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "server.ts"]
