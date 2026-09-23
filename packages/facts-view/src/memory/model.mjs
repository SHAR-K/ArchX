// 内存占用主题的派生层。
//
// 尺寸这一类数字推不出来：结构体的实际占用取决于目标的布局规则，一个对象落在哪个段取决于
// 链接器怎么处理它，代码尺寸在 AST 层根本不存在。它们精确地存在于链接器已经写好的 map 里，
// 所以引擎把链接产物当作**另一个证据源**读进来（imageFacts），和 AST 事实分开标注。
//
// 这一层做的是归并与对照：目标文件按模块归并、数据符号按大小排、把并发事实贴到符号上，
// 再把产物与源码的新旧差异摆出来。尺寸来自产物，归属来自源码，两者的来源必须在界面上分得清。

import { t } from "../i18n.mjs";
import { buildIndex, idOf } from "../graph.mjs";

const bytes = (n) => Number(n ?? 0);

export function buildMemory(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const image = view.imageFacts ?? null;
  if (!image) {
    return {
      theme: "memory",
      available: false,
      reason: "no-image-facts",
      hint: t("The facts have no imageFacts. The project needs a link artifact (an armlink / Keil .map) and the scan must have read it."),
      modules: [], symbols: [], totals: null, scoped: null, staleness: null, artifact: null,
    };
  }

  const shared = new Map((index.ast.sharedResources ?? []).map((r) => [r.name, r]));

  // 目标文件按模块归并。归属靠源文件反查——目标文件里定义了哪些函数，那些函数在哪个源文件里。
  const byModule = new Map();
  for (const object of image.objects ?? []) {
    const key = index.fileById.get(object.sourcePath)?.module ?? String(object.sourcePath ?? "").split("/").slice(0, 2).join("/") ?? "?";
    const row = byModule.get(key) ?? { id: idOf.memoryModule(key), module: key, files: 0, code: 0, ro: 0, rw: 0, zi: 0, objects: [] };
    row.files += 1;
    row.code += bytes(object.codeBytes);
    row.ro += bytes(object.roDataBytes);
    row.rw += bytes(object.rwDataBytes);
    row.zi += bytes(object.ziDataBytes);
    row.objects.push({ path: object.path, sourcePath: object.sourcePath ?? null, match: object.match ?? null, code: bytes(object.codeBytes), ro: bytes(object.roDataBytes), rw: bytes(object.rwDataBytes), zi: bytes(object.ziDataBytes) });
    byModule.set(key, row);
  }
  const modules = [...byModule.values()].map((r) => ({ ...r, rom: r.code + r.ro + r.rw, ram: r.rw + r.zi }));
  modules.sort((a, b) => b.ram - a.ram || b.rom - a.rom);

  // 数据符号：只看占空间的那些，代码符号的归属已经在模块表里了
  const symbols = (image.symbols ?? []).filter((s) => s.kind !== "code").map((s) => {
    const resource = shared.get(s.name);
    return {
      id: idOf.memorySymbol(s.sourcePath ?? "", s.name),
      name: s.name,
      section: s.section ?? null,
      size: bytes(s.sizeBytes),
      scope: s.scope ?? null,
      file: s.sourcePath ?? null,
      line: index.varAt(s.symbolId).line,
      module: index.fileById.get(s.sourcePath)?.module ?? null,
      // 并发是另一层事实，贴上来是为了看「大块的数据是不是也被多方碰」，不是尺寸的一部分
      sharedUnits: resource ? (resource.units ?? []).map((u) => ({ unit: u.unit, kind: u.unitKind })) : [],
      touchedByIsr: Boolean(resource?.units?.some((u) => u.unitKind === "isr")),
    };
  });
  symbols.sort((a, b) => b.size - a.size);

  const sharedSymbols = symbols.filter((s) => s.sharedUnits.length > 0);
  const artifact = image.artifact ?? null;
  return {
    theme: "memory",
    available: true,
    basis: t("Sizes come from the link artifact; module attribution comes from source facts: each object file is traced back to its source file by the functions it defines"),
    artifact: artifact ? { path: artifact.path, kind: artifact.kind ?? null, modified: artifact.modified ?? null } : null,
    totals: image.totals ?? null,
    scoped: image.scopedTotals ?? null,
    staleness: image.staleness ?? null,
    approximations: image.approximations ?? [],
    matchedByFunctions: (image.objects ?? []).filter((o) => o.match === "functions").length,
    objectCount: (image.objects ?? []).length,
    modules,
    symbols,
    sharedBytes: sharedSymbols.reduce((n, s) => n + s.size, 0),
    sharedCount: sharedSymbols.length,
  };
}
