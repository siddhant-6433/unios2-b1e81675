

## Plan: Fix Passport Photo AI Processing + Storage Upload

### Two bugs identified:

---

### Bug 1: AI response parsing is wrong

The edge function uses `google/gemini-3.1-flash-image-preview` (image generation model). Per the API docs, image generation models return processed images in a **separate `images` array** on the message, NOT inside `content`:

```json
{ "choices": [{ "message": { "content": "text...", "images": [{ "type": "image_url", "image_url": { "url": "data:..." } }] } }] }
```

Current code (line 67-74) looks for images inside `content` array — which is empty/string, so `processedImage` is always `null`. The function returns `{ processedImage: null }`, client falls back to original image, then hits bug #2.

**Fix** in `supabase/functions/process-passport-photo/index.ts`: Parse `data.choices[0].message.images[0].image_url.url` instead of scanning `content`.

### Bug 2: Storage upload fails with RLS error

Console shows: `"new row violates row-level security policy"` on storage upload. The migration created an INSERT policy but storage `upsert: true` requires both INSERT and **UPDATE** policies. First upload might work but subsequent uploads (retake) fail because upsert tries UPDATE.

**Fix**: Add an UPDATE policy for the `application-documents` bucket.

---

### Files Changed

| File | Change |
|---|---|
| `supabase/functions/process-passport-photo/index.ts` | Fix response parsing: extract from `message.images` array |
| Database migration | Add UPDATE policy on `storage.objects` for `application-documents` bucket |

### Detailed Changes

**Edge function** — replace lines 65-74:
```typescript
let processedImage: string | null = null;
const images = data.choices?.[0]?.message?.images;
if (Array.isArray(images) && images.length > 0) {
  processedImage = images[0]?.image_url?.url || null;
}
```

**Migration SQL**:
```sql
CREATE POLICY "Anyone can update application docs"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id = 'application-documents')
WITH CHECK (bucket_id = 'application-documents');
```

