import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";

const API_HOST = "visual.volcengineapi.com";
const REGION = "cn-north-1";
const SERVICE = "cv";
const ACTION = "CVProcess";
const VERSION = "2022-08-31";
const IMAGE_DIR = path.join(process.cwd(), "images");

function sign(method: string, query: Record<string, string>, body: string): Record<string, string> {
  const ak = process.env.VOLC_ACCESS_KEY;
  const sk = process.env.VOLC_SECRET_KEY;
  if (!ak || !sk) throw new Error("Missing VOLC_ACCESS_KEY or VOLC_SECRET_KEY env vars");

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = dateStamp + "T" + now.toISOString().slice(11, 19).replace(/:/g, "") + "Z";

  const allQuery: Record<string, string> = { ...query, Action: ACTION, Version: VERSION };
  const sortedKeys = Object.keys(allQuery).sort();
  const canonicalQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allQuery[k])}`).join("&");

  const headers: Record<string, string> = {
    "Host": API_HOST,
    "X-Date": amzDate,
    "Content-Type": "application/json",
  };
  const signedHeaders = Object.keys(headers).sort().map(k => k.toLowerCase()).join(";");
  const canonicalHeaders = Object.keys(headers).sort()
    .map(k => `${k.toLowerCase()}:${headers[k].trim()}`).join("\n");

  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  const canonicalRequest = [
    method,
    "/",
    canonicalQuery,
    canonicalHeaders + "\n",
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = crypto.createHmac("sha256", sk).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(REGION).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(SERVICE).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  headers["Authorization"] = `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers["X-Content-Sha256"] = payloadHash;

  return headers;
}

export interface GenerateOptions {
  prompt: string;
  width?: number;
  height?: number;
}

export async function generateImage(options: GenerateOptions): Promise<string[]> {
  const { prompt, width = 1024, height = 1024 } = options;

  const body = JSON.stringify({
    req_key: "jimeng_t2i_v40",
    prompt,
    width,
    height,
    use_sr: false,
    return_url: true,
    logo_info: { add_logo: true, position: 0, language: 0, opacity: 1 },
  });

  const query: Record<string, string> = {};
  const headers = sign("POST", query, body);

  const url = `https://${API_HOST}/?${Object.entries({ ...query, Action: ACTION, Version: VERSION })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;

  const resp = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  if (data.ResponseMetadata?.Error) {
    throw new Error(`API error: ${data.ResponseMetadata.Error.Message}`);
  }

  const imageUrls: string[] = data.data?.image_urls ?? [];
  if (imageUrls.length === 0) throw new Error("No images returned from API");

  return imageUrls;
}

export async function downloadImages(urls: string[]): Promise<string[]> {
  if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

  const paths: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const ext = ".png";
    const filePath = path.join(IMAGE_DIR, `img_${Date.now()}_${i}${ext}`);
    const resp = await fetch(urls[i]);
    if (!resp.ok || !resp.body) throw new Error(`Download failed: ${resp.status}`);
    await pipeline(resp.body as any, fs.createWriteStream(filePath));
    paths.push(filePath);
    console.log(`图片已下载: ${filePath}`);
  }
  return paths;
}
