import { createHash } from "node:crypto";

export function fakeR2(initial = {}, pageSize = 200) {
  const objects = new Map();
  const metadata = (key, value) => ({
    key, etag: value.etag, size: Buffer.byteLength(value.content),
    uploaded: value.uploaded, customMetadata: { ...value.customMetadata },
    httpMetadata: { ...value.httpMetadata }
  });
  const bucket = {
    objects, puts: [], beforePut: null,
    seed(key, content, customMetadata = {}) {
      objects.set(key, {
        content, customMetadata, uploaded: new Date(),
        etag: createHash("md5").update(content).digest("hex"), httpMetadata: {}
      });
    },
    async list(options = {}) {
      const keys = [...objects.keys()].filter(key => key.startsWith(options.prefix || "")).sort();
      const offset = Number(options.cursor || 0);
      const end = Math.min(keys.length, offset + Math.min(options.limit || 200, pageSize));
      return {
        objects: keys.slice(offset, end).map(key => metadata(key, objects.get(key))),
        truncated: end < keys.length, cursor: end < keys.length ? String(end) : undefined
      };
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      const copy = { ...object };
      return { ...metadata(key, copy), text: async () => copy.content };
    },
    async put(key, content, options = {}) {
      if (bucket.beforePut) await bucket.beforePut(key, content, options);
      bucket.puts.push({ key, content, options });
      const current = objects.get(key);
      if (options.onlyIf instanceof Headers) {
        if (options.onlyIf.get("If-None-Match") === "*" && current) return null;
      } else if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
      bucket.seed(key, content, options.customMetadata);
      objects.get(key).httpMetadata = options.httpMetadata;
      return metadata(key, objects.get(key));
    }
  };
  for (const [key, content] of Object.entries(initial)) bucket.seed(key, content);
  return bucket;
}
