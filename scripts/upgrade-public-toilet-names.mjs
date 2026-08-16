import { readFile, writeFile } from "node:fs/promises";

const dataUrl = new URL("../public/data/public-toilets.json", import.meta.url);
const dataset = JSON.parse(await readFile(dataUrl, "utf8"));
const genericNames = new Set(["公共厕所", "公厕", "厕所", "卫生间", "洗手间", "Toilette", "Toilet"]);

dataset.normalizationVersion = 2;
dataset.normalizationNote = "无具体来源名称的点使用唯一、透明的 OSM 占位名；完整原始标签将在下次抓取时保留。";
dataset.records = dataset.records.map((record) => {
  const generatedDistrictName = record.name === `${record.district}公共厕所`;
  const sourceGeneric = genericNames.has(record.name);
  const needsName = generatedDistrictName || sourceGeneric;
  const shortRef = String(record.sourceRef || record.id).split("/").at(-1).slice(-6);
  return {
    ...record,
    name: needsName ? `无名公共厕所 · OSM ${shortRef}` : record.name,
    nameStatus: generatedDistrictName ? "generated" : sourceGeneric ? "source_generic" : "source_specific",
    tags: needsName && !record.tags.includes("名称待补充") ? [...record.tags, "名称待补充"] : record.tags,
    sourceMetadata: record.sourceMetadata ?? null,
  };
});

await writeFile(dataUrl, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Upgraded ${dataset.records.length} public toilet records.`);
