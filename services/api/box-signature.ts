import { createHmac, timingSafeEqual } from 'node:crypto';

export type BoxSignatureConfig = {primaryKey:string; secondaryKey?:string; now?:number; maxAgeMs?:number; futureSkewMs?:number};
/** Verify the original bytes before JSON parsing. Never interchange primary/secondary keys. */
export function verifyBoxSignature(rawBody: Buffer|string, headers: Record<string,string|undefined>, config: BoxSignatureConfig): boolean {
  const normalized = Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
  if (normalized['box-signature-version'] !== '1' || normalized['box-signature-algorithm'] !== 'HmacSHA256') return false;
  const timestamp=normalized['box-delivery-timestamp'];
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) return false;
  const delivered=Date.parse(timestamp), now=config.now??Date.now();
  if (!Number.isFinite(delivered) || now-delivered >= (config.maxAgeMs??600_000) || delivered-now > (config.futureSkewMs??60_000)) return false;
  const check=(key:string|undefined, signature:string|undefined):boolean=>{
    if (!key || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
    const actual=Buffer.from(signature,'base64');
    const expected=createHmac('sha256',key).update(rawBody).update(timestamp).digest();
    return actual.length===expected.length && timingSafeEqual(actual,expected);
  };
  return check(config.primaryKey,normalized['box-signature-primary']) || check(config.secondaryKey,normalized['box-signature-secondary']);
}

export type BoxUploadEvent={eventId:string;fileId:string;fileVersionId?:string};
/** Authenticity must already be checked. Folder membership is rechecked against Box metadata by INGEST. */
export function parseBoxUploadEvent(rawBody:Buffer|string, config:{webhookId:string;folderId:string;fileId?:string}):BoxUploadEvent|null {
  let input:unknown;
  try {input=JSON.parse(rawBody.toString());} catch {return null;}
  if (!input || typeof input!=='object') return null;
  const v=input as Record<string,unknown>, source=v.source as Record<string,unknown>|undefined, webhook=v.webhook as Record<string,unknown>|undefined;
  if (v.type!=='webhook_event' || typeof v.id!=='string' || !v.id || v.trigger!=='FILE.UPLOADED' || webhook?.id!==config.webhookId || source?.type!=='file' || typeof source.id!=='string' || !/^\d+$/.test(source.id)) return null;
  if (config.fileId && source.id!==config.fileId) return null;
  const parent=source.parent as Record<string,unknown>|undefined;
  if (parent?.id!==undefined && parent.id!==config.folderId) return null;
  const version=source.file_version as Record<string,unknown>|undefined;
  return {eventId:v.id,fileId:source.id,...(typeof version?.id==='string'?{fileVersionId:version.id}:{})};
}
