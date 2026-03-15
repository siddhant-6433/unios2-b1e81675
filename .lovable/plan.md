

## Plan: Fix Webcam Display, Capture, and AI Photo Processing

### Three distinct bugs identified:

---

### 1. Webcam White Screen (video not showing)

**Root cause**: `startWebcam` calls `getUserMedia` and tries to set `videoRef.current.srcObject`, but the `<video>` element only renders when `showWebcam` is true. Since `setShowWebcam(true)` is called *after* the stream assignment (line 92), `videoRef.current` is null at line 88, so the stream never gets attached.

**Fix**: Set `showWebcam(true)` first, then use a `useEffect` to assign the stream to the video element once it renders. Store the stream in `streamRef` immediately, and in a `useEffect` watching `showWebcam`, assign `streamRef.current` to `videoRef.current.srcObject`.

### 2. Capture Button Does Nothing

**Root cause**: Since the video stream was never attached (bug #1), `videoRef.current.videoWidth` and `videoHeight` are 0. The canvas gets 0x0 dimensions, producing an empty/blank data URL. Additionally `capturePhoto` calls `stopWebcam()` which sets `showWebcam = false`, hiding the video — but the real issue is the stream was never displayed.

**Fix**: Resolved by fixing bug #1. No separate change needed.

### 3. AI Photo Processing Not Working

**Root cause**: Two issues in the edge function:
- **Wrong model name**: `google/gemini-2.5-flash-image` is not a valid model. Should be `google/gemini-3.1-flash-image-preview` (an image generation/editing model from the supported list).
- **Wrong response parsing**: Line 64 looks for `data.choices[0].message.images[0].image_url.url` — the actual response format returns image data in the `content` array as `{ type: "image_url", image_url: { url: "data:..." } }`.

**Fix**: Update model to `google/gemini-3.1-flash-image-preview` and fix response parsing to extract from `choices[0].message.content`.

---

### Files Changed

| File | Change |
|---|---|
| `src/components/apply/PhotoUpload.tsx` | Fix webcam: always render `<video>` (hidden when inactive), use `useEffect` to attach stream when `showWebcam` becomes true |
| `supabase/functions/process-passport-photo/index.ts` | Switch model to `google/gemini-3.1-flash-image-preview`, fix response parsing for image content |

### Detailed Changes

**PhotoUpload.tsx**:
- Always render `<video>` element but hide with CSS (`display: none`) when `showWebcam` is false — ensures `videoRef.current` is never null
- In `startWebcam`: set `showWebcam(true)` first, then assign stream in a microtask or directly since video element is always mounted
- Alternative cleaner approach: add `useEffect` that watches `showWebcam` + `streamRef.current` and attaches srcObject

**process-passport-photo/index.ts**:
- Change model from `google/gemini-2.5-flash-image` to `google/gemini-3.1-flash-image-preview`
- Update response parsing to scan `data.choices[0].message.content` array for an item with `type: "image_url"` and extract its `image_url.url`

