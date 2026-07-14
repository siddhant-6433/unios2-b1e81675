import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "npm:@aws-sdk/client-s3";

export type R2UploadInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
};

type R2Config = {
  bucket: string;
  publicBase: string;
  client: S3Client;
};

function r2Config(): R2Config {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  const publicBase = (Deno.env.get("R2_PUBLIC_BASE_URL") || "").replace(/\/+$/, "");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    throw new Error("R2 env not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL)");
  }

  return {
    bucket,
    publicBase,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export function publicR2Url(key: string): string {
  const { publicBase } = r2Config();
  return `${publicBase}/${key.replace(/^\/+/, "")}`;
}

export async function uploadToR2({ key, body, contentType, cacheControl }: R2UploadInput): Promise<{ key: string; url: string }> {
  const cfg = r2Config();
  const normalizedKey = key.replace(/^\/+/, "");
  await cfg.client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: normalizedKey,
    Body: body,
    ContentType: contentType || "application/octet-stream",
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
  }));
  return { key: normalizedKey, url: `${cfg.publicBase}/${normalizedKey}` };
}

export async function deleteFromR2(keys: Array<string | null | undefined>): Promise<number> {
  const uniqueKeys = [...new Set(keys.filter(Boolean).map((key) => String(key).replace(/^\/+/, "")))];
  if (uniqueKeys.length === 0) return 0;

  const cfg = r2Config();
  await Promise.all(uniqueKeys.map((key) =>
    cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
  ));
  return uniqueKeys.length;
}
