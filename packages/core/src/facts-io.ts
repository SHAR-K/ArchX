// 事实文件的落盘与读取。
//
// 一个中等规模工程扫出来的 partition.json 是 14 MB 上下，其中 4.48 MB 纯粹是缩进——
// 没有人会用眼睛读 14 MB 的 JSON，那 32% 是白花的。剩下的内容重复度极高（15.9 万个
// 字符串出现，去重后只剩 9628 个，路径在同一条记录里往往出现两次），gzip 之后 0.51 MB。
//
// 读得也更快：读 14 MB 明文要 61 ms，读 0.51 MB 再解压只要 36 ms——磁盘 IO 省下来的
// 比解压花掉的多。
//
// 旧快照和自建样例的夹具都是明文，所以读取一律嗅探 gzip magic，不看文件名。
// 夹具保持明文提交：它只有一百来 KB，diff 能看，值这个体积。

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const FACTS_NAME = "partition.json";
export const FACTS_GZ_NAME = "partition.json.gz";

const GZIP_MAGIC = 0x1f8b;

/** 目录里那份事实在哪：优先压缩版，其次明文；都没有就返回压缩版的路径（「应该在哪」） */
export function factsFile(directory: string): string {
  const gz = path.join(directory, FACTS_GZ_NAME);
  if (fs.existsSync(gz)) return gz;
  const plain = path.join(directory, FACTS_NAME);
  if (fs.existsSync(plain)) return plain;
  return gz;
}

/** 读一份事实。压缩与否由内容决定，不由后缀决定——旧快照的名字不带 .gz */
export function readFacts<T = unknown>(file: string): T {
  const raw = fs.readFileSync(file);
  const text = raw.length >= 2 && raw.readUInt16BE(0) === GZIP_MAGIC
    ? zlib.gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
  return JSON.parse(text) as T;
}

/**
 * 写一份事实，压缩、不缩进。返回写到哪儿了。
 * 同名的明文旧文件要删掉，否则读的时候两份并存，谁也说不清用的是哪份。
 */
export function writeFacts(directory: string, value: unknown, name = FACTS_NAME): string {
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${name}.gz`);
  fs.writeFileSync(target, zlib.gzipSync(Buffer.from(JSON.stringify(value), "utf8")));
  const stale = path.join(directory, name);
  if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  return target;
}
