import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const endpoint = "https://open.bigmodel.cn/api/paas/v4/images/generations";
const apiKey = process.env.BIGMODEL_API_KEY;
const model = process.env.BIGMODEL_IMAGE_MODEL ?? "cogview-3-flash";
const force = process.argv.includes("--force");
const selectedCase = readArgument("--case");
const outputRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "real",
  "generated",
);

const prompts = [
  {
    id: "rw-white-grid",
    size: "1024x1024",
    prompt:
      "A clean 4 by 4 sprite sheet of the exact same small fantasy knight performing a walk cycle, full body in every cell, pure white background, evenly spaced cells, no grid lines, no text, no labels, orthographic 2D game art, consistent scale and camera.",
  },
  {
    id: "rw-uneven-spacing",
    size: "1024x1024",
    prompt:
      "A 2D game character animation sheet with eight full-body frames of the exact same fox adventurer, transparent-looking plain bright green background, deliberately uneven gaps between frames and slightly off-center placement, consistent character scale, no text, no borders.",
  },
  {
    id: "rw-touching-frames",
    size: "1024x1024",
    prompt:
      "A six-frame 2D sprite sheet of the same spear fighter, plain bright green background, two neighboring frames accidentally touch only at the spear tips while all other frames are separated, consistent full-body scale, no text, no grid lines.",
  },
  {
    id: "rw-detached-parts",
    size: "1024x1024",
    prompt:
      "A six-frame sprite sheet of the same wizard casting a spell, plain bright green background, in each frame the floating hat or wand is visibly detached by a very small gap from the body but belongs to that frame, full body, consistent scale, no text.",
  },
  {
    id: "rw-duplicate-pose",
    size: "1024x1024",
    prompt:
      "An eight-frame 2D run-cycle sprite sheet of the exact same robot, plain bright green background, intentionally repeat the third pose again as the seventh pose, evenly separated frames, consistent scale and lighting, no text.",
  },
  {
    id: "rw-size-outlier",
    size: "1024x1024",
    prompt:
      "A seven-frame 2D sprite sheet of the same pirate, plain bright green background, six frames at consistent full-body scale and one obvious hallucinated frame about sixty percent larger with a different aspect ratio, separated frames, no text.",
  },
  {
    id: "rw-single-strip",
    size: "1344x768",
    prompt:
      "A single horizontal row of eight animation frames of the exact same blue slime jumping, pure white background, generous transparent-looking gaps, consistent camera and scale, no second row, no captions, no border, production game sprite sheet.",
  },
];

if (!apiKey) {
  console.error("BIGMODEL_API_KEY is not set; no API request was made.");
  console.error(
    "Set it in the environment, then run `pnpm --filter @spriteflow/golden run gen:real`.",
  );
  process.exitCode = 2;
} else {
  await mkdir(outputRoot, { recursive: true });
  const selected = prompts.filter((item) => !selectedCase || item.id === selectedCase);
  if (selected.length === 0) throw new Error(`Unknown --case ${selectedCase}`);

  for (const item of selected) {
    const metadataPath = path.join(outputRoot, `${item.id}.json`);
    if (!force && (await exists(metadataPath))) {
      console.log(`SKIP ${item.id}: metadata already exists (use --force to regenerate)`);
      continue;
    }

    console.log(`GENERATE ${item.id} with ${model}`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: item.prompt,
        size: item.size,
        quality: "standard",
        watermark_enabled: true,
        user_id: "spriteflow-qa",
      }),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`BigModel ${response.status}: ${responseText.slice(0, 500)}`);
    const payload = JSON.parse(responseText);
    const imageUrl = payload.data?.[0]?.url;
    if (typeof imageUrl !== "string")
      throw new Error(`BigModel response for ${item.id} has no image URL`);

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error(`Image download ${imageResponse.status} for ${item.id}`);
    const contentType =
      imageResponse.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream";
    const extension = extensionFor(contentType);
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    const imageFile = `${item.id}.${extension}`;
    await writeFile(path.join(outputRoot, imageFile), imageBytes);
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: "spriteflow-real-generation/1",
          caseId: item.id,
          model,
          endpoint,
          prompt: item.prompt,
          size: item.size,
          quality: "standard",
          watermarkEnabled: true,
          created: payload.created ?? null,
          generatedAt: new Date().toISOString(),
          imageFile,
          contentType,
          sha256: createHash("sha256").update(imageBytes).digest("hex"),
          contentFilter: payload.content_filter ?? [],
          sourceUrlExpires: true,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`SAVED ${imageFile}`);
  }
}

function extensionFor(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/jpeg") return "jpg";
  throw new Error(`Unsupported generated image content type: ${contentType}`);
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
